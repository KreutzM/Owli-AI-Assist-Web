import { execFileSync, spawn } from 'node:child_process';

const target = readArg('--target');
const root = readArg('--root');
const port = readArg('--port');
const allowDirty = process.argv.includes('--allow-dirty');

if (!target || !root || !port) {
  throw new Error('Usage: node tools/start-built-web-server.mjs --target <target> --root <dir> --port <port> [--allow-dirty]');
}

execFileSync('pnpm', [scriptForTarget(target)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    OWLI_WEB_OUT_DIR: root,
    ...(allowDirty ? { OWLI_ALLOW_DIRTY_PROTOTYPE_BUILD: '1' } : {}),
  },
  shell: process.platform === 'win32',
});

const child = spawn(process.execPath, ['tools/serve-built-web.mjs', '--root', root, '--port', port], {
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
    setTimeout(() => process.exit(0), 1_000).unref();
  });
}

child.once('exit', (code, signal) => {
  if (signal) process.exit(0);
  process.exit(code ?? 0);
});

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function scriptForTarget(value) {
  switch (value) {
    case 'mock':
      return 'build';
    case 'staging':
      return 'build:staging';
    case 'staging-mediarecorder-prototype':
      return 'build:staging:mediarecorder-prototype';
    default:
      throw new Error(`Unsupported build target ${value}.`);
  }
}
