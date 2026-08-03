import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  generatePrettierFix,
  parseNameStatus,
  validateRepositoryPath,
} from './generate-prettier-fix.mjs';

const GENERATED_AT = '2026-08-03T12:00:00.000Z';

function command(commandName, args, cwd, { allowFailure = false, input } = {}) {
  const result = spawnSync(commandName, args, {
    cwd,
    input,
    encoding: null,
    shell: false,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${commandName} ${args.join(' ')} failed: ${result.stderr.toString('utf8')}`);
  }
  return result;
}

function git(cwd, ...args) {
  return command('git', args, cwd).stdout.toString('utf8').trim();
}

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prettier-fix-test-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'ci@example.invalid');
  git(root, 'config', 'user.name', 'CI Test');
  await writeFile(path.join(root, '.gitignore'), 'artifacts/\n', 'utf8');
  await writeFile(path.join(root, '.prettierignore'), 'ignored/\npnpm-lock.yaml\n', 'utf8');
  return root;
}

async function write(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

function commitAll(root, message) {
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', message);
  return git(root, 'rev-parse', 'HEAD');
}

function fakePrettier({ calls = [], noOp = false } = {}) {
  return {
    version: '3.9.5',
    async getFileInfo(filePath) {
      const normalized = filePath.split(path.sep).join('/');
      calls.push(normalized);
      const ignored = normalized.includes('/ignored/') || normalized.endsWith('/pnpm-lock.yaml');
      const supported = /\.(?:js|json|md|mjs|ts|tsx|ya?ml)$/u.test(normalized);
      return { ignored, inferredParser: supported ? 'babel' : null };
    },
    async resolveConfig() {
      return { endOfLine: 'lf' };
    },
    async format(source) {
      if (noOp) return source;
      const normalized = source.replaceAll('\r\n', '\n').replaceAll('UNFORMATTED', 'FORMATTED');
      return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
    },
  };
}

async function runGenerator(root, baseSha, headSha, overrides = {}) {
  const previous = process.cwd();
  process.chdir(root);
  try {
    return await generatePrettierFix(
      {
        repository: 'KreutzM/Owli-AI-Assist-Web',
        baseSha,
        headSha,
        outputDirectory: 'artifacts/prettier-fix',
        generatedAt: GENERATED_AT,
        ...overrides.options,
      },
      {
        prettier: overrides.prettier ?? fakePrettier(overrides.fakeOptions),
        pnpmVersion: '10.12.1',
      },
    );
  } finally {
    process.chdir(previous);
  }
}

test('parses NUL-separated added, copied, modified, and renamed records safely', () => {
  const raw = Buffer.from(
    'A\0added file.js\0C100\0source.js\0copied ü.js\0M\0modified.js\0R090\0old.js\0new.js\0',
  );
  assert.deepEqual(parseNameStatus(raw), [
    { status: 'A', path: 'added file.js' },
    { status: 'C', path: 'copied ü.js' },
    { status: 'M', path: 'modified.js' },
    { status: 'R', path: 'new.js' },
  ]);
});

test('rejects traversal, absolute, empty, and control-character paths', () => {
  for (const unsafe of ['', '../escape.js', 'a/../escape.js', './a.js', '/tmp/a.js', 'C:\\a.js', 'a\u0007.js']) {
    assert.throws(() => validateRepositoryPath(unsafe));
  }
  assert.equal(validateRepositoryPath('space and ünicode/file.js'), 'space and ünicode/file.js');
});

test('formats only changed supported non-ignored files and produces an exact-head patch', async () => {
  const root = await createRepository();
  try {
    await write(root, 'modified.js', "const modified = 'FORMATTED';\n");
    await write(root, 'old name.js', "const renamed = 'FORMATTED';\n");
    await write(root, 'deleted.js', "const deleted = 'FORMATTED';\n");
    await write(root, 'source.js', "const copied = 'UNFORMATTED';\n");
    const baseSha = commitAll(root, 'base');

    await write(root, 'modified.js', "const modified = 'UNFORMATTED';");
    git(root, 'mv', 'old name.js', 'renamed ünicode.js');
    await write(root, 'renamed ünicode.js', "const renamed = 'UNFORMATTED';");
    await rm(path.join(root, 'deleted.js'));
    await write(root, 'added space.js', "const added = 'UNFORMATTED';");
    await write(root, 'copied file.js', "const copied = 'UNFORMATTED';\n");
    await write(root, 'ignored/skip.js', "const ignored = 'UNFORMATTED';");
    await write(root, 'asset.png', 'not actually an image');
    const headSha = commitAll(root, 'head');

    const calls = [];
    const result = await runGenerator(root, baseSha, headSha, {
      prettier: fakePrettier({ calls }),
    });
    assert.deepEqual(result.manifest.formattedFiles, [
      'added space.js',
      'copied file.js',
      'modified.js',
      'renamed ünicode.js',
    ]);
    assert.ok(calls.some((entry) => entry.endsWith('/ignored/skip.js')));
    assert.ok(calls.some((entry) => entry.endsWith('/asset.png')));
    assert.ok(!calls.some((entry) => entry.endsWith('/deleted.js')));
    assert.equal(result.manifest.baseSha, baseSha);
    assert.equal(result.manifest.headSha, headSha);
    assert.equal(result.manifest.prettierVersion, '3.9.5');
    assert.match(result.manifest.patchSha256, /^[0-9a-f]{64}$/u);

    git(root, 'reset', '--hard', headSha);
    const patchPath = path.join(root, 'artifacts/prettier-fix/prettier-fix.patch');
    git(root, 'apply', '--check', patchPath);
    git(root, 'apply', patchPath);
    git(root, 'diff', '--check');
    assert.match(await readFile(path.join(root, 'renamed ünicode.js'), 'utf8'), /FORMATTED/u);

    git(root, 'reset', '--hard', headSha);
    await write(root, 'modified.js', "const modified = 'DIVERGED';\n");
    commitAll(root, 'divergent head');
    const divergent = command('git', ['apply', '--check', patchPath], root, { allowFailure: true });
    assert.notEqual(divergent.status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects exact-head mismatches and dirty worktrees', async () => {
  const root = await createRepository();
  try {
    await write(root, 'file.js', "const value = 'FORMATTED';\n");
    const baseSha = commitAll(root, 'base');
    await write(root, 'file.js', "const value = 'UNFORMATTED';\n");
    const headSha = commitAll(root, 'head');
    await assert.rejects(runGenerator(root, baseSha, baseSha), /Exact-head mismatch/u);
    await write(root, 'dirty.js', 'dirty');
    await assert.rejects(runGenerator(root, baseSha, headSha), /Working tree must be clean/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects binary candidates and bounded file or byte limit violations', async () => {
  const binaryRoot = await createRepository();
  try {
    await write(binaryRoot, 'binary.js', Buffer.from('const x = 1;\0bad'));
    const baseSha = commitAll(binaryRoot, 'base');
    await write(binaryRoot, 'binary.js', Buffer.from('const x = 2;\0bad'));
    const headSha = commitAll(binaryRoot, 'head');
    await assert.rejects(runGenerator(binaryRoot, baseSha, headSha), /Binary candidate rejected/u);
  } finally {
    await rm(binaryRoot, { recursive: true, force: true });
  }

  const limitRoot = await createRepository();
  try {
    const baseSha = commitAll(limitRoot, 'base');
    await write(limitRoot, 'one.js', "const one = 'UNFORMATTED';\n");
    await write(limitRoot, 'two.js', "const two = 'UNFORMATTED';\n");
    const headSha = commitAll(limitRoot, 'head');
    await assert.rejects(
      runGenerator(limitRoot, baseSha, headSha, { options: { maxFiles: 1 } }),
      /Changed-file limit exceeded/u,
    );
    await assert.rejects(
      runGenerator(limitRoot, baseSha, headSha, {
        options: { maxFileBytes: 8, maxTotalBytes: 16 },
      }),
      /Per-file byte limit exceeded/u,
    );
    await assert.rejects(
      runGenerator(limitRoot, baseSha, headSha, {
        options: { maxFileBytes: 32, maxTotalBytes: 40 },
      }),
      /Total input byte limit exceeded/u,
    );
  } finally {
    await rm(limitRoot, { recursive: true, force: true });
  }
});

test('keeps no-op patches empty and makes CRLF patch content and manifests deterministic', async () => {
  const noOpRoot = await createRepository();
  try {
    const baseSha = commitAll(noOpRoot, 'base');
    await write(noOpRoot, 'already.js', "const already = 'FORMATTED';\n");
    const headSha = commitAll(noOpRoot, 'head');
    const result = await runGenerator(noOpRoot, baseSha, headSha, {
      prettier: fakePrettier({ noOp: true }),
    });
    assert.equal(result.patch.byteLength, 0);
    assert.deepEqual(result.manifest.formattedFiles, []);
  } finally {
    await rm(noOpRoot, { recursive: true, force: true });
  }

  const deterministicRoot = await createRepository();
  try {
    const baseSha = commitAll(deterministicRoot, 'base');
    await write(deterministicRoot, 'crlf.js', "const line = 'UNFORMATTED';\r\n");
    const headSha = commitAll(deterministicRoot, 'head');
    const first = await runGenerator(deterministicRoot, baseSha, headSha);
    git(deterministicRoot, 'reset', '--hard', headSha);
    const second = await runGenerator(deterministicRoot, baseSha, headSha);
    assert.deepEqual(first.patch, second.patch);
    assert.equal(first.manifestText, second.manifestText);
    git(deterministicRoot, 'reset', '--hard', headSha);
    git(deterministicRoot, 'apply', path.join(deterministicRoot, 'artifacts/prettier-fix/prettier-fix.patch'));
    const formatted = await readFile(path.join(deterministicRoot, 'crlf.js'));
    assert.ok(!formatted.includes(13));
  } finally {
    await rm(deterministicRoot, { recursive: true, force: true });
  }
});

test('enforces the pinned Prettier contract', async () => {
  const root = await createRepository();
  try {
    const baseSha = commitAll(root, 'base');
    await write(root, 'file.js', "const value = 'UNFORMATTED';\n");
    const headSha = commitAll(root, 'head');
    const wrongPrettier = { ...fakePrettier(), version: '3.9.4' };
    await assert.rejects(
      runGenerator(root, baseSha, headSha, { prettier: wrongPrettier }),
      /Expected Prettier 3\.9\.5/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
