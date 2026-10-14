#!/usr/bin/env node
/**
 * Builds the Windows release: release/marina-pos-<version>/ and a .zip of it.
 *
 *   pnpm release:win             app + install scripts (the laptop downloads Node.js/PostgreSQL once)
 *   pnpm release:win --offline   also puts Node.js, PostgreSQL, WinSW and the VC++ runtime in /vendor,
 *                                so the laptop needs no internet at all (~420 MB zip)
 *
 * Works on macOS, Linux and Windows: the app has no native add-ons, so the same files run on Windows.
 */
import { execSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { build } from 'esbuild';
import { pipeline } from 'node:stream/promises';

const root = path.resolve(import.meta.dirname, '..');
const args = new Set(process.argv.slice(2));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const name = `marina-pos-${version}${args.has('--offline') || args.has('--with-vendor') ? '-offline' : ''}`;
const out = path.join(root, 'release', name);

// Everything the laptop would otherwise download during install (used with --offline).
const VENDOR = [
  ['node-v22.23.3-win-x64.zip', 'https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip'],
  ['node-v22.23.3-win-arm64.zip', 'https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-arm64.zip'],
  [
    'WinSW-x64-v2.12.0.exe',
    'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe',
  ],
  ['vc_redist.x64.exe', 'https://aka.ms/vs/17/release/vc_redist.x64.exe'],
  [
    'postgresql-17.11-1-windows-x64-binaries.zip',
    'https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip',
  ],
];

const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
const step = (text) => console.log(`\n▸ ${text}`);

step(`Version ${version}`);
await writeFile(
  path.join(root, 'apps/api/src/version.ts'),
  `// Kept in sync with package.json by the release script.\nexport const APP_VERSION = '${version}';\n`,
);

step('Building');
run('pnpm build');

step(`Assembling ${path.relative(root, out)}`);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
// The server is bundled into a few plain JavaScript files: no node_modules folder, no native
// add-ons, quick to copy and quick to start. Decorator metadata is already in the compiled output.
await build({
  absWorkingDir: path.join(root, 'apps/api'),
  entryPoints: {
    main: 'dist/main.js',
    'cli/migrate': 'dist/cli/migrate.js',
    'cli/seed': 'dist/cli/seed.js',
    'cli/tls': 'dist/cli/tls.js',
    'cli/backup': 'dist/cli/backup.js',
  },
  outdir: path.join(out, 'app/api/dist'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  keepNames: true,
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'warning',
  // Optional packages that NestJS and pg only load when they are installed.
  external: [
    '@nestjs/microservices',
    '@nestjs/microservices/*',
    '@nestjs/websockets',
    '@nestjs/websockets/*',
    '@fastify/static',
    'class-transformer',
    'class-transformer/*',
    'class-validator',
    'pg-native',
  ],
});
await cp(
  path.join(root, 'apps/api/prisma/migrations'),
  path.join(out, 'app/api/prisma/migrations'),
  { recursive: true },
);
await writeFile(
  path.join(out, 'app/api/package.json'),
  JSON.stringify({ name: '@marina/api', version, private: true, main: 'dist/main.js' }, null, 2),
);
await cp(path.join(root, 'apps/web/dist'), path.join(out, 'app/web/dist'), { recursive: true });

// Windows scripts: CRLF line endings, and a BOM so Windows PowerShell 5.1 reads them as UTF-8.
for (const file of await readdir(path.join(root, 'deploy/windows'))) {
  const text = (await readFile(path.join(root, 'deploy/windows', file), 'utf8')).replace(
    /\r?\n/g,
    '\r\n',
  );
  await writeFile(path.join(out, file), file.endsWith('.ps1') ? '\ufeff' + text : text);
}
await cp(path.join(root, 'docs/WINDOWS-TEST.md'), path.join(out, 'WINDOWS-TEST.md'));
await cp(path.join(root, 'docs/OWNER-GUIDE.md'), path.join(out, 'OWNER-GUIDE.md'));
await writeFile(path.join(out, 'VERSION'), `${version}\n`);

// The app must not depend on native add-ons built for this computer.
const natives = execSync(`find "${path.join(out, 'app')}" -name "*.node" -type f`, {
  encoding: 'utf8',
}).trim();
if (natives) {
  console.error(`Native add-ons found; the release would not run on Windows:\n${natives}`);
  process.exit(1);
}
for (const required of [
  'app/api/dist/main.js',
  'app/api/dist/cli/migrate.js',
  'app/api/dist/cli/seed.js',
  'app/api/dist/cli/tls.js',
  'app/api/dist/cli/backup.js',
  'app/web/dist/index.html',
]) {
  if (!existsSync(path.join(out, required))) {
    console.error(`Missing ${required}`);
    process.exit(1);
  }
}
const migrations = await readdir(path.join(out, 'app/api/prisma/migrations')).catch(() => []);
if (!migrations.length) {
  console.error('Missing database migrations');
  process.exit(1);
}

const offline = args.has('--offline') || args.has('--with-vendor');
if (offline) {
  step('Adding Node.js, PostgreSQL, WinSW and the VC++ runtime for an offline install');
  const cache = path.join(root, 'release/vendor-cache');
  await mkdir(cache, { recursive: true });
  await mkdir(path.join(out, 'vendor'), { recursive: true });
  for (const [file, url] of VENDOR) {
    const cached = path.join(cache, file);
    if (!existsSync(cached)) {
      console.log(`  ${file}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(`${cached}.part`));
      await cp(`${cached}.part`, cached);
      await rm(`${cached}.part`);
    }
    await cp(cached, path.join(out, 'vendor', file));
  }
}

if (!args.has('--no-zip')) {
  step('Zipping');
  const zip = path.join(root, 'release', `${name}.zip`);
  await rm(zip, { force: true });
  if (process.platform === 'win32') {
    run(
      `powershell -NoProfile -Command "Compress-Archive -Path '${out}' -DestinationPath '${zip}'"`,
    );
  } else {
    execSync(`zip -qr "${name}.zip" "${name}"`, {
      cwd: path.join(root, 'release'),
      stdio: 'inherit',
    });
  }
  console.log(`  ${path.relative(root, zip)} (${((await stat(zip)).size / 1e6).toFixed(1)} MB)`);
}

console.log(`\n✔ Release ready: ${path.relative(root, out)}`);
console.log('  Copy the folder (or the zip) to the shop laptop and double-click INSTALL.cmd.');
