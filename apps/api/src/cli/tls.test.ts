import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:https';
import { afterAll, describe, expect, it } from 'vitest';
import { CA_NAME, ensureTls } from './tls';

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'shoppos-tls-'));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('local HTTPS certificates', () => {
  it('creates a CA and a pos.shop certificate signed by it', () => {
    const r = ensureTls(tempDir(), 'pos.shop');
    expect(r.createdCa).toBe(true);
    const ca = new X509Certificate(readFileSync(r.caCert));
    const cert = new X509Certificate(readFileSync(r.cert));
    expect(ca.ca).toBe(true);
    expect(ca.subject).toContain(CA_NAME);
    expect(cert.ca).toBe(false);
    expect(cert.verify(ca.publicKey)).toBe(true);
    expect(cert.checkHost('pos.shop')).toBe('pos.shop');
    expect(cert.checkHost('localhost')).toBe('localhost');
    expect(cert.checkIP('127.0.0.1')).toBe('127.0.0.1');
    expect(cert.checkHost('evil.example')).toBeUndefined();
  });

  it('keeps existing certificates, and renews only the server certificate near expiry', () => {
    const dir = tempDir();
    const first = ensureTls(dir, 'pos.shop');
    const caBefore = readFileSync(first.caCert, 'utf8');
    const certBefore = readFileSync(first.cert, 'utf8');

    const again = ensureTls(dir, 'pos.shop');
    expect(again.createdCa).toBe(false);
    expect(again.createdCert).toBe(false);
    expect(readFileSync(again.cert, 'utf8')).toBe(certBefore);

    // 820 days later the server certificate is about to expire: renewed, CA kept.
    const later = ensureTls(dir, 'pos.shop', Date.now() + 820 * 86_400_000);
    expect(later.createdCa).toBe(false);
    expect(later.createdCert).toBe(true);
    expect(readFileSync(later.caCert, 'utf8')).toBe(caBefore);
  });

  it('makes a new server certificate when the shop address changes', () => {
    const dir = tempDir();
    ensureTls(dir, 'pos.shop');
    const r = ensureTls(dir, 'till.shop');
    expect(r.createdCert).toBe(true);
    expect(new X509Certificate(readFileSync(r.cert)).checkHost('till.shop')).toBe('till.shop');
  });

  it('is accepted by a real TLS connection that trusts only the local CA', async () => {
    const r = ensureTls(tempDir(), 'pos.shop');
    const server = createServer(
      { key: readFileSync(r.key), cert: readFileSync(r.cert) },
      (_req, res) => res.end('ok'),
    ).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const body = await new Promise<string>((resolve, reject) => {
        request(
          {
            host: '127.0.0.1',
            port,
            path: '/',
            servername: 'pos.shop',
            ca: readFileSync(r.caCert),
          },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve(data));
          },
        )
          .on('error', reject)
          .end();
      });
      expect(body).toBe('ok');
    } finally {
      server.close();
    }
  });
});
