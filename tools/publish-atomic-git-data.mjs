#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}

for (const name of ['repo', 'branch', 'expectedParent']) {
  if (!options[name]) fail(`Missing required option --${toKebab(name)}.`);
}

const sourceRef = options.sourceRef || 'HEAD';
const token = process.env.GITHUB_TOKEN;
const status = git(['status', '--porcelain']);
if (status) {
  fail('Working tree must be clean; commit the complete logical patch before publication.');
}

git(['cat-file', '-e', `${options.expectedParent}^{commit}`]);
git(['cat-file', '-e', `${sourceRef}^{commit}`]);
if (!isAncestor(options.expectedParent, sourceRef)) {
  fail(`${options.expectedParent} is not an ancestor of ${sourceRef}.`);
}

const changes = readChanges(options.expectedParent, sourceRef);
if (changes.length === 0) fail('No committed changes found to publish.');

const plan = {
  repository: options.repo,
  branch: options.branch,
  expectedParent: options.expectedParent,
  sourceRef,
  sourceCommit: git(['rev-parse', sourceRef]),
  commitMessage: options.message || git(['log', '-1', '--format=%B', sourceRef]).trim(),
  changes,
};

if (options.dryRun) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

if (!token) fail('GITHUB_TOKEN is required unless --dry-run is used.');

const api = createGitHubClient(options.repo, token);
const initialRef = await api.getBranch(options.branch);
if (initialRef && initialRef.sha !== options.expectedParent) {
  fail(`Branch moved: expected ${options.expectedParent}, found ${initialRef.sha}.`);
}

const parentCommit = await api.request('GET', `/git/commits/${options.expectedParent}`);
const treeEntries = [];
for (const change of changes) {
  if (change.status === 'D') {
    const oldEntry = readTreeEntry(options.expectedParent, change.path);
    treeEntries.push({
      path: change.path,
      mode: oldEntry.mode,
      type: oldEntry.type,
      sha: null,
    });
    continue;
  }

  const entry = readTreeEntry(sourceRef, change.path);
  if (entry.type === 'commit') {
    treeEntries.push({
      path: change.path,
      mode: entry.mode,
      type: entry.type,
      sha: entry.sha,
    });
    continue;
  }

  const content = gitBuffer(['cat-file', 'blob', entry.sha]).toString('base64');
  const blob = await api.request('POST', '/git/blobs', {
    content,
    encoding: 'base64',
  });
  treeEntries.push({
    path: change.path,
    mode: entry.mode,
    type: entry.type,
    sha: blob.sha,
  });
}

const tree = await api.request('POST', '/git/trees', {
  base_tree: parentCommit.tree.sha,
  tree: treeEntries,
});
const commit = await api.request('POST', '/git/commits', {
  message: plan.commitMessage,
  tree: tree.sha,
  parents: [options.expectedParent],
});

const currentRef = await api.getBranch(options.branch);
if (initialRef) {
  if (!currentRef || currentRef.sha !== options.expectedParent) {
    fail(
      `Branch moved before ref update; expected ${options.expectedParent}. ` +
        `Commit ${commit.sha} remains unattached.`,
    );
  }
  await api.request('PATCH', `/git/refs/heads/${encodeRef(options.branch)}`, {
    sha: commit.sha,
    force: false,
  });
} else {
  if (currentRef) {
    fail(
      `Branch ${options.branch} was created concurrently. ` +
        `Commit ${commit.sha} remains unattached.`,
    );
  }
  await api.request('POST', '/git/refs', {
    ref: `refs/heads/${options.branch}`,
    sha: commit.sha,
  });
}

console.log(
  JSON.stringify(
    {
      ...plan,
      publishedCommit: commit.sha,
      tree: tree.sha,
    },
    null,
    2,
  ),
);

function parseArguments(args) {
  const result = { dryRun: false, help: false };
  const names = new Map([
    ['--repo', 'repo'],
    ['--branch', 'branch'],
    ['--expected-parent', 'expectedParent'],
    ['--source-ref', 'sourceRef'],
    ['--message', 'message'],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') result.dryRun = true;
    else if (argument === '--help' || argument === '-h') result.help = true;
    else if (names.has(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) fail(`Option ${argument} requires a value.`);
      result[names.get(argument)] = value;
      index += 1;
    } else fail(`Unknown option: ${argument}`);
  }
  return result;
}

function printUsage() {
  console.log(`Usage: node tools/publish-atomic-git-data.mjs \\
  --repo owner/name \\
  --branch feature/name \\
  --expected-parent <sha> [options]

Options:
  --source-ref <ref>  Local committed source tree (default: HEAD)
  --message <text>    Remote commit message (default: source commit message)
  --dry-run           Validate and print the publication plan without GitHub writes
  --help              Show this help`);
}

function readChanges(base, source) {
  const output = gitBuffer(['diff', '--name-status', '-z', '--no-renames', base, source]);
  const fields = output.toString('utf8').split('\0').filter(Boolean);
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!path || !['A', 'M', 'D', 'T'].includes(status[0])) {
      fail(`Unsupported git diff status: ${status}`);
    }
    changes.push({ status: status[0], path });
  }
  return changes;
}

function readTreeEntry(ref, path) {
  const output = gitBuffer(['ls-tree', '-z', ref, '--', path]).toString('utf8');
  if (!output) fail(`Could not resolve ${path} in ${ref}.`);
  const match = /^(\d+) (\w+) ([0-9a-f]+)\t([^\0]+)\0$/u.exec(output);
  if (!match) fail(`Unexpected git ls-tree output for ${path}.`);
  return {
    mode: match[1],
    type: match[2],
    sha: match[3],
    path: match[4],
  };
}

function isAncestor(base, source) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', base, source], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function git(args) {
  return gitBuffer(args).toString('utf8').trim();
}

function gitBuffer(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const message = error.stderr?.toString('utf8').trim() || error.message;
    fail(`git ${args.join(' ')} failed: ${message}`);
  }
}

function createGitHubClient(repo, authToken) {
  const base = `https://api.github.com/repos/${repo}`;
  return {
    async getBranch(branch) {
      const response = await fetch(`${base}/git/ref/heads/${encodeRef(branch)}`, {
        headers: headers(authToken),
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        fail(`GitHub GET ref failed (${response.status}): ${await response.text()}`);
      }
      const payload = await response.json();
      return { sha: payload.object.sha };
    },
    async request(method, path, body) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: headers(authToken),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        fail(`GitHub ${method} ${path} failed (${response.status}): ${await response.text()}`);
      }
      return await response.json();
    },
  };
}

function headers(authToken) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'owli-atomic-publisher',
  };
}

function encodeRef(ref) {
  return ref.split('/').map(encodeURIComponent).join('/');
}

function toKebab(value) {
  return value.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
