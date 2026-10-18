import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { ensureTls } from './cli/tls';
import { config } from './config';

/** http://pos.shop/anything → https://pos.shop/anything */
export function startHttpRedirect(port: number, host: string, httpsPort: number) {
  const suffix = httpsPort === 443 ? '' : `:${httpsPort}`;
  return createServer((req, res) => {
    const name = (req.headers.host ?? 'pos.shop').replace(/:\d+$/, '');
    res.writeHead(308, { Location: `https://${name}${suffix}${req.url ?? '/'}` }).end();
  }).listen(port, host);
}

async function main() {
  const cfg = config();
  const log = new Logger('ShopPOS');

  let httpsOptions: { key: Buffer; cert: Buffer } | undefined;
  if (cfg.tlsDir) {
    const tls = ensureTls(cfg.tlsDir, cfg.tlsHost);
    if (tls.createdCert)
      log.log(
        `New HTTPS certificate for ${cfg.tlsHost}, valid until ${tls.expiresAt.toISOString().slice(0, 10)}`,
      );
    httpsOptions = { key: readFileSync(tls.key), cert: readFileSync(tls.cert) };
  }

  const app = await createApp({ httpsOptions });
  await app.listen(cfg.port, cfg.host);
  const scheme = httpsOptions ? 'https' : 'http';
  log.log(`Ready on ${scheme}://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}`);

  if (httpsOptions && cfg.httpRedirectPort) {
    startHttpRedirect(cfg.httpRedirectPort, cfg.host, cfg.port);
    log.log(`http on port ${cfg.httpRedirectPort} redirects to https`);
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
