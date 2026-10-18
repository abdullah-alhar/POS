/**
 * Optional off-site copy of backups in the shop owner's Google Drive.
 *
 * Uses the owner's own Google Cloud "Desktop app" OAuth client and the drive.file scope, so the
 * POS can only see the files it created itself. Sign-in uses Google's loopback flow: a one-time
 * listener on 127.0.0.1 receives the answer, which works on the shop laptop without a public URL.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

export interface DriveSecrets {
  clientId: string;
  clientSecret: string;
  refreshToken: string | null;
  email: string | null;
  folderId: string | null;
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_FOLDER_NAME = 'ShopPOS Backups';

const b64url = (b: Buffer) =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function json<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      const body = JSON.parse(text) as {
        error?: { message?: string } | string;
        error_description?: string;
      };
      msg =
        body.error_description ??
        (typeof body.error === 'string' ? body.error : body.error?.message) ??
        msg;
    } catch {
      /* not JSON */
    }
    throw new Error(`${what}: ${msg}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Starts sign-in. Returns the Google URL to open; `onDone` gets the refresh token and e-mail
 * once the owner allows access (or an error). The listener closes itself after 10 minutes.
 */
export async function startDriveSignIn(
  clientId: string,
  clientSecret: string,
  onDone: (result: { refreshToken: string; email: string | null } | Error) => void,
): Promise<string> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));
  let redirectUri = '';

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/oauth') {
      res.writeHead(404).end();
      return;
    }
    const finish = (ok: boolean, text: string) => {
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>ShopPOS</title><body style="font-family:system-ui;padding:40px;text-align:center">` +
          `<h2>${ok ? 'Google Drive is connected' : 'Google Drive was not connected'}</h2><p>${text}</p><p>You can close this tab.</p>`,
      );
      clearTimeout(timer);
      server.close();
    };
    const error = url.searchParams.get('error');
    if (error || url.searchParams.get('state') !== state) {
      finish(
        false,
        error === 'access_denied'
          ? 'Access was not allowed.'
          : 'Something went wrong. Try again from the Backups page.',
      );
      onDone(new Error(error ?? 'The sign-in answer did not match'));
      return;
    }
    const code = url.searchParams.get('code') ?? '';
    exchange(code)
      .then((r) => {
        finish(
          true,
          r.email
            ? `Backups will be copied to ${r.email}.`
            : 'Backups will be copied to Google Drive.',
        );
        onDone(r);
      })
      .catch((err: Error) => {
        finish(false, err.message);
        onDone(err);
      });
  });

  async function exchange(code: string) {
    const tokens = await json<{ access_token: string; refresh_token?: string }>(
      await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }),
      }),
      'Google sign-in failed',
    );
    if (!tokens.refresh_token)
      throw new Error(
        'Google did not give a refresh token. Remove the app from your Google account and try again.',
      );
    const about = await json<{ user?: { emailAddress?: string } }>(
      await fetch(`${API}/about?fields=user(emailAddress)`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }),
      'Reading the Google account failed',
    ).catch(() => ({ user: undefined }));
    return { refreshToken: tokens.refresh_token, email: about.user?.emailAddress ?? null };
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const timer = setTimeout(() => server.close(), 10 * 60_000);
  timer.unref();
  redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/oauth`;
  return `${AUTH_URL}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })}`;
}

export class DriveClient {
  constructor(private readonly secrets: DriveSecrets) {}

  private async token(): Promise<string> {
    if (!this.secrets.refreshToken) throw new Error('Google Drive is not connected');
    const r = await json<{ access_token: string }>(
      await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.secrets.clientId,
          client_secret: this.secrets.clientSecret,
          refresh_token: this.secrets.refreshToken,
          grant_type: 'refresh_token',
        }),
        signal: AbortSignal.timeout(20_000),
      }),
      'Google Drive sign-in failed',
    );
    return r.access_token;
  }

  /** The backup folder, created on first use. Returns its id (save it in the secrets). */
  async folder(token: string): Promise<string> {
    if (this.secrets.folderId) {
      const res = await fetch(`${API}/files/${this.secrets.folderId}?fields=id,trashed`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok && !((await res.json()) as { trashed?: boolean }).trashed)
        return this.secrets.folderId;
    }
    const q = `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`;
    const found = await json<{ files: { id: string }[] }>(
      await fetch(
        `${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
      'Google Drive',
    );
    if (found.files[0]) return (this.secrets.folderId = found.files[0].id);
    const created = await json<{ id: string }>(
      await fetch(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: DRIVE_FOLDER_NAME,
          mimeType: 'application/vnd.google-apps.folder',
        }),
      }),
      'Creating the Google Drive folder failed',
    );
    return (this.secrets.folderId = created.id);
  }

  private async list(token: string, folderId: string) {
    const q = `'${folderId}' in parents and trashed=false`;
    const r = await json<{ files: { id: string; name: string; createdTime: string }[] }>(
      await fetch(
        `${API}/files?${new URLSearchParams({ q, fields: 'files(id,name,createdTime)', orderBy: 'createdTime desc', pageSize: '1000' })}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
      'Listing Google Drive backups failed',
    );
    return r.files;
  }

  /** Uploads the file unless a file with the same name is already there; removes old copies beyond `keep`. */
  async upload(file: string, keep: number): Promise<void> {
    const token = await this.token();
    const folderId = await this.folder(token);
    const name = path.basename(file);
    const existing = await this.list(token, folderId);
    if (!existing.some((f) => f.name === name)) {
      const body = await readFile(file);
      const start = await fetch(`${UPLOAD}?uploadType=resumable`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'application/octet-stream',
          'X-Upload-Content-Length': String(body.length),
        },
        body: JSON.stringify({ name, parents: [folderId] }),
      });
      if (!start.ok) await json(start, 'Starting the Google Drive upload failed');
      const location = start.headers.get('location');
      if (!location) throw new Error('Google Drive did not accept the upload');
      await json(
        await fetch(location, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body,
          signal: AbortSignal.timeout(30 * 60_000),
        }),
        'Uploading to Google Drive failed',
      );
    }
    const files = (await this.list(token, folderId)).filter((f) => f.name.endsWith('.dump'));
    for (const old of files.slice(keep)) {
      await fetch(`${API}/files/${old.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
  }
}
