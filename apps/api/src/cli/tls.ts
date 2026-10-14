/**
 * HTTPS for an offline shop. Each computer gets its own small certificate authority (CA); the
 * installer adds that CA to Windows' trusted certificates, and the CA signs a certificate for
 * pos.shop. Browsers then show the padlock, with no internet and no warnings.
 *
 *   node dist/cli/tls.js <folder> [host]     → creates (or renews) the files, prints the CA path
 *
 * The server certificate is renewed automatically when it gets close to expiry; the CA stays the
 * same, so Windows keeps trusting it.
 */
import { generateKeyPairSync, randomBytes, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import forge from 'node-forge';

export const CA_NAME = 'Marina POS Local CA';
const DAY = 86_400_000;
/** Server certificates last 825 days (the most macOS/iOS accept; harmless for Windows). */
const SERVER_DAYS = 825;
const RENEW_WITHIN_DAYS = 30;

export interface TlsFiles {
  dir: string;
  caCert: string;
  caKey: string;
  cert: string;
  key: string;
}

export interface EnsureResult extends TlsFiles {
  createdCa: boolean;
  createdCert: boolean;
  expiresAt: Date;
}

export function tlsFiles(dir: string): TlsFiles {
  return {
    dir,
    caCert: path.join(dir, 'ca.crt'),
    caKey: path.join(dir, 'ca.key'),
    cert: path.join(dir, 'server.crt'),
    key: path.join(dir, 'server.key'),
  };
}

function newKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  return {
    privatePem: privateKey,
    publicKey: forge.pki.publicKeyFromPem(publicKey),
    privateKey: forge.pki.privateKeyFromPem(privateKey),
  };
}

/** A random positive serial number. */
function serial() {
  return `01${randomBytes(15).toString('hex')}`;
}

function createCa(files: TlsFiles) {
  const keys = newKeyPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - DAY);
  cert.validity.notAfter = new Date(Date.now() + 20 * 365 * DAY);
  const name = [
    { name: 'commonName', value: CA_NAME },
    { name: 'organizationName', value: 'Marina POS' },
  ];
  cert.setSubject(name);
  cert.setIssuer(name);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  writeFileSync(files.caKey, keys.privatePem, { mode: 0o600 });
  writeFileSync(files.caCert, forge.pki.certificateToPem(cert));
}

function createServerCert(files: TlsFiles, host: string) {
  const caCert = forge.pki.certificateFromPem(readFileSync(files.caCert, 'utf8'));
  const caKey = forge.pki.privateKeyFromPem(readFileSync(files.caKey, 'utf8'));
  const keys = newKeyPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - DAY);
  cert.validity.notAfter = new Date(Date.now() + SERVER_DAYS * DAY);
  cert.setSubject([{ name: 'commonName', value: host }]);
  cert.setIssuer(caCert.subject.attributes);
  const names = [...new Set([host, 'localhost'])];
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: [...names.map((value) => ({ type: 2, value })), { type: 7, ip: '127.0.0.1' }],
    },
    { name: 'subjectKeyIdentifier' },
    {
      name: 'authorityKeyIdentifier',
      keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes(),
    },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  writeFileSync(files.key, keys.privatePem, { mode: 0o600 });
  // Send the CA too, so the browser always has the full chain.
  writeFileSync(files.cert, forge.pki.certificateToPem(cert) + readFileSync(files.caCert, 'utf8'));
}

/** Does the server certificate exist, cover this host, and stay valid for a while yet? */
function serverCertOk(files: TlsFiles, host: string, now = Date.now()) {
  if (!existsSync(files.cert) || !existsSync(files.key)) return false;
  try {
    const cert = new X509Certificate(readFileSync(files.cert));
    const ca = new X509Certificate(readFileSync(files.caCert));
    return (
      cert.verify(ca.publicKey) &&
      !!cert.checkHost(host) &&
      new Date(cert.validTo).getTime() - now > RENEW_WITHIN_DAYS * DAY
    );
  } catch {
    return false;
  }
}

/** Creates whatever is missing, and renews the server certificate when needed. */
export function ensureTls(dir: string, host: string, now = Date.now()): EnsureResult {
  mkdirSync(dir, { recursive: true });
  const files = tlsFiles(dir);
  let createdCa = false;
  if (!existsSync(files.caCert) || !existsSync(files.caKey)) {
    createCa(files);
    createdCa = true;
  }
  let createdCert = false;
  if (createdCa || !serverCertOk(files, host, now)) {
    createServerCert(files, host);
    createdCert = true;
  }
  const expiresAt = new Date(new X509Certificate(readFileSync(files.cert)).validTo);
  return { ...files, createdCa, createdCert, expiresAt };
}

if (require.main === module) {
  const [dir, host = 'pos.shop'] = process.argv.slice(2);
  if (!dir) {
    console.error('Usage: node tls.js <folder> [host]');
    process.exit(1);
  }
  try {
    const r = ensureTls(path.resolve(dir), host);
    console.log(
      r.createdCa
        ? `Created a new local certificate authority: ${r.caCert}`
        : `Certificate authority: ${r.caCert}`,
    );
    console.log(
      `${r.createdCert ? 'Created' : 'Kept'} the certificate for ${host} (valid until ${r.expiresAt.toISOString().slice(0, 10)})`,
    );
  } catch (err) {
    console.error(`Could not create the HTTPS certificates: ${(err as Error).message}`);
    process.exit(1);
  }
}
