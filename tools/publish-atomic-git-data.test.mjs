import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publisher = fileURLToPath(new URL('./publish-atomic-git-data.mjs', import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), 'owli-atomic-publisher-'));

try {
  const repository = path.join(root, 'repository');
  await mkdir(repository);
  git(repository, ['init', '-q']);
  git(repository, ['config', 'user.name', 'Atomic Publisher Test']);
  git(repository, ['config', 'user.email', 'atomic@example.invalid']);

  await writeFile(path.join(repository, 'keep.txt'), 'base\n');
  await writeFile(path.join(repository, 'delete.txt'), 'delete me\n');
  git(repository, ['add', '.']);
  git(repository, ['commit', '-qm', 'base']);
  const parent = git(repository, ['rev-parse', 'HEAD']);
  const parentTree = git(repository, ['rev-parse', 'HEAD^{tree}']);

  await writeFile(path.join(repository, 'keep.txt'), 'base\nupdated\n');
  await rm(path.join(repository, 'delete.txt'));
  await writeFile(path.join(repository, 'run.sh'), '#!/usr/bin/env bash\necho ok\n', {
    mode: 0o755,
  });
  await symlink('keep.txt', path.join(repository, 'keep-link'));
  git(repository, ['add', '-A']);
  git(repository, ['commit', '-qm', 'source']);
  const sourceTree = git(repository, ['rev-parse', 'HEAD^{tree}']);
  const expectedTreeEntries = readExpectedTreeEntries(repository, parent, 'HEAD');

  const success = await runScenario({ repository, parent, parentTree, sourceTree });
  assert.equal(success.result.code, 0, success.result.stderr);
  assert.equal(
    success.requests.filter(
      (item) => item.method === 'POST' && item.path.endsWith('/git/trees'),
    ).length,
    1,
  );
  assert.equal(
    success.requests.filter(
      (item) => item.method === 'POST' && item.path.endsWith('/git/commits'),
    ).length,
    1,
  );
  assert.equal(success.requests.filter((item) => item.method === 'PATCH').length, 1);
  const treeRequest = success.requests.find((item) => item.path.endsWith('/git/trees'));
  assert.equal(treeRequest.body.base_tree, parentTree);
  assert.deepEqual(sortEntries(treeRequest.body.tree), sortEntries(expectedTreeEntries));
  const commitRequest = success.requests.find((item) => item.path.endsWith('/git/commits'));
  assert.equal(commitRequest.body.tree, sourceTree);
  const refRequest = success.requests.find((item) => item.method === 'PATCH');
  assert.equal(refRequest.body.force, false);

  const mismatch = await runScenario({
    repository,
    parent,
    parentTree,
    sourceTree,
    returnedTree: '0'.repeat(40),
  });
  assert.notEqual(mismatch.result.code, 0);
  assert.match(mismatch.result.stderr, /Remote tree mismatch/u);
  assert.equal(mismatch.requests.some((item) => item.path.endsWith('/git/commits')), false);
  assert.equal(mismatch.requests.some((item) => item.method === 'PATCH'), false);

  const stale = await runScenario({
    repository,
    parent,
    parentTree,
    sourceTree,
    movedRef: '1'.repeat(40),
  });
  assert.notEqual(stale.result.code, 0);
  assert.match(stale.result.stderr, /Branch moved before ref update/u);
  assert.equal(stale.requests.some((item) => item.method === 'PATCH'), false);

  console.log('Atomic publisher API and exact-tree guards passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}

async function runScenario({
  repository,
  parent,
  parentTree,
  sourceTree,
  returnedTree = sourceTree,
  movedRef,
}) {
  const requests = [];
  let refReads = 0;
  const publishedCommit = 'f'.repeat(40);
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({ method: request.method, path: request.url, body });

    if (request.method === 'GET' && request.url.includes('/git/ref/heads/feature/test')) {
      refReads += 1;
      return json(response, 200, { object: { sha: refReads > 1 && movedRef ? movedRef : parent } });
    }
    if (request.method === 'GET' && request.url.endsWith(`/git/commits/${parent}`)) {
      return json(response, 200, { tree: { sha: parentTree } });
    }
    if (request.method === 'POST' && request.url.endsWith('/git/blobs')) {
      const bytes = Buffer.from(body.content, 'base64');
      return json(response, 201, { sha: gitObjectSha('blob', bytes) });
    }
    if (request.method === 'POST' && request.url.endsWith('/git/trees')) {
      return json(response, 201, { sha: returnedTree });
    }
    if (request.method === 'POST' && request.url.endsWith('/git/commits')) {
      return json(response, 201, { sha: publishedCommit });
    }
    if (request.method === 'PATCH' && request.url.includes('/git/refs/heads/feature/test')) {
      return json(response, 200, { object: { sha: publishedCommit } });
    }
    return json(response, 404, { error: 'unexpected request' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const result = await run(
      process.execPath,
      [
        publisher,
        '--repo',
        'KreutzM/Owli-AI-Assist-Web',
        '--branch',
        'feature/test',
        '--expected-parent',
        parent,
        '--source-ref',
        'HEAD',
      ],
      {
        cwd: repository,
        env: {
          ...process.env,
          GITHUB_TOKEN: 'test-token',
          GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
        },
      },
    );
    return { requests, result };
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function readExpectedTreeEntries(repository, base, source) {
  const fields = execFileSync(
    'git',
    ['diff', '--name-status', '-z', '--no-renames', base, source],
    { cwd: repository, encoding: 'buffer' },
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const entries = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index][0];
    const filePath = fields[index + 1];
    if (status === 'D') {
      const old = readTreeEntry(repository, base, filePath);
      entries.push({ path: filePath, mode: old.mode, type: old.type, sha: null });
    } else {
      const current = readTreeEntry(repository, source, filePath);
      entries.push({
        path: filePath,
        mode: current.mode,
        type: current.type,
        sha: current.sha,
      });
    }
  }
  return entries;
}

function readTreeEntry(repository, ref, filePath) {
  const output = execFileSync('git', ['ls-tree', '-z', ref, '--', filePath], {
    cwd: repository,
    encoding: 'utf8',
  });
  const match = /^(\d+) (\w+) ([0-9a-f]+)\t([^\0]+)\0$/u.exec(output);
  assert.ok(match, `Could not parse tree entry for ${filePath}`);
  return { mode: match[1], type: match[2], sha: match[3] };
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path));
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function gitObjectSha(type, bytes) {
  return createHash('sha1')
    .update(Buffer.from(`${type} ${bytes.length}\0`))
    .update(bytes)
    .digest('hex');
}
