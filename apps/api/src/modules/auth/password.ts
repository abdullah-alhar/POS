import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password and PIN hashing with Node's built-in scrypt (no native add-ons to build on Windows).
 * Stored format: scrypt$N$r$p$saltBase64$hashBase64
 */

const KEY_LENGTH = 64;
const DEFAULT = { N: 16384, r: 8, p: 1 };

function scrypt(secret: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(secret, salt, KEY_LENGTH, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(secret, salt, DEFAULT);
  return [
    'scrypt',
    DEFAULT.N,
    DEFAULT.r,
    DEFAULT.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(secret, Buffer.from(saltB64, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
