import { access, readFile } from 'node:fs/promises';

const failures = [];
const packageJson = JSON.parse(await read('package.json'));
const ci = await read('.github/workflows/ci.yml');
const apple = await read('.github/workflows/apple-smoke.yml');
const bundle = await read('.github/workflows/repository-bundle.yml');
const materializer = await read('scripts/materialize-repository-bundle.sh');
const generator = await read('tools/generate-repo-index.mjs');
const atomicPublisher = await read('tools/publish-atomic-git-data.mjs');
const atomicPublisherTest = await read('tools/publish-atomic-git-data.test.mjs');

requireText(
  packageJson.scripts['check:fast'],
  'workflow:check',
  'check:fast must include workflow:check',
);
requireText(
  packageJson.scripts['check:fast'],
  'atomic:publish:test',
  'check:fast must include the lightweight atomic publisher API test',
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
  "github.event_name == 'pull_request' && github.event.pull_request.draft == true",
  'Quick CI must cover draft PR events',
);
requireText(
  ci,
  "github.event_name == 'pull_request' && github.event.pull_request.draft == false",
  'Full CI must cover non-draft PR events',
);
forbidText(
  ci,
  "github.event.action != 'synchronize'",
  'Full CI must not run merely because a draft PR was opened or reopened',
);
requireText(ci, 'pnpm check:all', 'Full CI must run the aggregate check once');
if ((ci.match(/pnpm check:all/gu) || []).length !== 1) {
  failures.push('Web CI must invoke check:all exactly once.');
}
forbidText(
  ci,
  'git diff --exit-code -- .ai/',
  'Committed agent-index verification must be removed',
);

forbidText(apple, '- tests/**', 'Apple CI must not trigger for every test-only change');
requireText(apple, 'github.event.pull_request.draft == false', 'Apple CI must skip draft PR heads');
requireText(
  apple,
  'Full Linux aggregate and browser validation',
  'Apple CI must wait for the exact-head Full Linux job',
);
requireText(
  apple,
  'Full Windows mock, staging, and production builds',
  'Apple CI must wait for the exact-head Full Windows job',
);
requireText(
  apple,
  'actions/runs/${run_id}/jobs?per_page=100',
  'Apple CI must inspect job conclusions instead of accepting any successful Web CI run',
);
requireText(
  apple,
  'src/platform/speech/**',
  'Apple CI must run for browser speech adapter changes',
);
requireText(
  apple,
  'MANUAL_WEB_CI_RUN_ID',
  'Manual Apple CI must require an explicit Full Web CI run ID',
);
requireText(
  apple,
  'Manual Apple CI head mismatch',
  'Manual Apple CI must verify the selected run against the exact checkout SHA',
);
requireText(
  apple,
  'Manual Apple CI requires successful',
  'Manual Apple CI must verify both required Full jobs',
);
forbidText(apple, "web_ci_run_id='manual'", 'Manual Apple CI must not bypass the Full Web CI gate');

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
const materializerRequirements = [
  'bundle list-heads',
  'Manifest base mismatch',
  'Manifest repository mismatch',
  'Bundle base ref mismatch',
];
for (const text of materializerRequirements) {
  requireText(materializer, text, `Bundle materializer is missing ${text}`);
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
  'expectedParentTree',
  'sourceTree',
  'Remote tree mismatch',
];
for (const text of publisherRequirements) {
  requireText(atomicPublisher, text, `Atomic publisher is missing ${text}`);
}
for (const text of ['Remote tree mismatch', 'GITHUB_API_URL', 'PATCH']) {
  requireText(atomicPublisherTest, text, `Atomic publisher test is missing ${text}`);
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
