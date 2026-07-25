import { access, readFile } from 'node:fs/promises';

const failures = [];
const packageJson = JSON.parse(await read('package.json'));
const ci = await read('.github/workflows/ci.yml');
const apple = await read('.github/workflows/apple-smoke.yml');
const bundle = await read('.github/workflows/repository-bundle.yml');
const generator = await read('tools/generate-repo-index.mjs');
const atomicPublisher = await read('tools/publish-atomic-git-data.mjs');

requireText(
  packageJson.scripts['check:fast'],
  'workflow:check',
  'check:fast must include workflow:check',
);
forbidText(
  packageJson.scripts['check:all'],
  'ai:index',
  'check:all must not require the optional agent index',
);
if (packageJson.scripts['ai:index:check']) failures.push('ai:index:check must be removed.');

for (const committedIndex of ['.ai/file-tree.md', '.ai/repo-index.json']) {
  if (await exists(committedIndex)) failures.push(`${committedIndex} must not remain committed.`);
}

requireText(ci, 'Quick format, type, unit, and build checks', 'Web CI must define quick CI');
requireText(
  ci,
  'Full Linux aggregate and browser validation',
  'Web CI must define the full Linux tier',
);
requireText(
  ci,
  'github.event.pull_request.draft == true',
  'Quick CI must be limited to draft synchronization',
);
requireText(
  ci,
  'github.event.pull_request.draft == false',
  'Full CI must cover synchronized ready PRs',
);
requireText(ci, 'run: pnpm check:all', 'Full CI must run the aggregate check once');
if ((ci.match(/run: pnpm check:all/gu) || []).length !== 1) {
  failures.push('Web CI must invoke check:all exactly once.');
}
forbidText(
  ci,
  'git diff --exit-code -- .ai/',
  'Committed agent-index verification must be removed',
);

forbidText(apple, '- tests/**', 'Apple CI must not trigger for every test-only change');
requireText(
  apple,
  "github.event.pull_request.draft == false",
  'Apple CI must skip draft PR heads',
);

const bundleRequirements = [
  'workflow_dispatch:',
  'workflow_call:',
  'fetch-depth: 0',
  'git bundle verify',
  'retention-days: 1',
];
for (const text of bundleRequirements) {
  requireText(bundle, text, `Repository bundle workflow is missing ${text}`);
}
requireText(
  generator,
  "'artifacts/agent-index'",
  'Agent index must default to an ignored artifact directory',
);
const publisherRequirements = [
  '--expected-parent',
  'force: false',
  'Branch moved',
  'git/trees',
  'git/commits',
];
for (const text of publisherRequirements) {
  requireText(atomicPublisher, text, `Atomic publisher is missing ${text}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Workflow, bundle, atomic-publication, and agent-index policies are consistent.');

async function read(path) {
  return await readFile(path, 'utf8');
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function requireText(value, expected, message) {
  if (!String(value || '').includes(expected)) failures.push(message);
}

function forbidText(value, forbidden, message) {
  if (String(value || '').includes(forbidden)) failures.push(message);
}
