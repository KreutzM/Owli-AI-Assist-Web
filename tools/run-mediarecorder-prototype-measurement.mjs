import { execFileSync, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const OUTPUT_DIR = readArg('--outdir') ?? path.join(tmpdir(), 'owli-mediarecorder-prototype');
const PORT = Number(readArg('--port') ?? '5185');
const BUILD_DIR = path.join(OUTPUT_DIR, 'build');
const EVIDENCE_DIR = path.join(OUTPUT_DIR, 'evidence');
const CANDIDATES = ['mp4-h264-aac', 'webm-vp8-opus', 'webm-default', 'webm-vp9-opus'];

assertCleanWorkingTree();
await mkdir(EVIDENCE_DIR, { recursive: true });

execFileSync('pnpm', ['build:staging:mediarecorder-prototype'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    OWLI_WEB_OUT_DIR: BUILD_DIR,
  },
  shell: process.platform === 'win32',
});

const server = spawn(
  process.execPath,
  ['tools/serve-built-web.mjs', '--root', BUILD_DIR, '--port', String(PORT)],
  {
    stdio: 'inherit',
  },
);

try {
  await waitForServer(PORT);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const candidateId of CANDIDATES) {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${PORT}/lab/mediarecorder-prototype`);
      await page.selectOption('#mediarecorder-candidate', candidateId);
      await page.getByRole('button', { name: 'Ausgewaehltes Szenario ausfuehren' }).click();
      const handle = await page.waitForFunction(
        () => {
          const host = globalThis.document?.querySelector(
            '[data-testid="mediarecorder-prototype-evidence"]',
          );
          if (!host) return undefined;
          const raw = host.textContent ?? '';
          const start = raw.indexOf('{');
          if (start < 0) return undefined;
          const parsed = JSON.parse(raw.slice(start));
          return parsed.results?.length === 1 && parsed.run?.completedAt ? parsed : undefined;
        },
        null,
        { timeout: 60_000 },
      );
      const evidence = await handle.jsonValue();
      const file = path.join(
        EVIDENCE_DIR,
        `${candidateId}-${new Date().toISOString().slice(0, 10)}-scenario-01.json`,
      );
      await writeFile(file, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
      await page.close();
      console.log(`Wrote ${file}`);
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}

function assertCleanWorkingTree() {
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    encoding: 'utf8',
  }).trim();
  if (status.length > 0) {
    throw new Error('MediaRecorder prototype measurement requires a clean working tree.');
  }
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function waitForServer(port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/lab/mediarecorder-prototype`, {
        cache: 'no-store',
      });
      if (response.ok) return;
    } catch {
      // Retry until the server is reachable.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out while waiting for http://127.0.0.1:${port}`);
}
