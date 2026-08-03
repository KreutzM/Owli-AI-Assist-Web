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
const prettierFixGenerator = await read('tools/generate-prettier-fix.mjs');
const prettierFixTest = await read('tools/generate-prettier-fix.test.mjs');

const coreCommands = [
  'pnpm lint',
  'pnpm typecheck',
  'pnpm guardrails',
  'pnpm workflow:check',
  'pnpm atomic:publish:test',
  'pnpm test',
  'pnpm prettier:fix:test',
];
for (const command of coreCommands) {
  requireText(packageJson.scripts['check:core'], command, `check:core must include ${command}`);
}
requireText(
  packageJson.scripts['check:fast'],
  'pnpm format:check',
  'check:fast must retain the authoritative format check',
);
requireText(
  packageJson.scripts['check:fast'],
  'pnpm check:core',
  'check:fast must retain the local core-check convenience chain',
);
requireText(
  packageJson.scripts['prettier:fix:test'],
  'generate-prettier-fix.test.mjs',
  'The Prettier patch helper test must remain wired into package scripts',
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

const formatJob = extractJob(ci, 'format');
const coreJob = extractJob(ci, 'core');
const quickBuildJob = extractJob(ci, 'quick-build');
const quickAggregateJob = extractJob(ci, 'quick');
const prettierFixJob = extractJob(ci, 'prettier-fix');
const fullLinuxJob = extractJob(ci, 'full-linux');
const fullWindowsJob = extractJob(ci, 'full-windows');

requireText(formatJob, 'name: Format check', 'Web CI must define the independent format job');
requireText(formatJob, 'run: pnpm format:check', 'The format job must run only format:check');
for (const command of coreCommands)
  forbidText(formatJob, command, `The format job must not run ${command}`);
forbidText(formatJob, 'needs:', 'The format job must not depend on another validation job');

requireText(
  coreJob,
  'name: Core lint, type, policy, and unit checks',
  'Web CI must define the independent core job',
);
for (const command of coreCommands)
  requireText(coreJob, `run: ${command}`, `The core job must run ${command}`);
forbidText(coreJob, 'needs:', 'Core checks must run even when formatting fails');
forbidText(coreJob, 'pnpm format:check', 'Core checks must not repeat the format check');

requireText(quickBuildJob, 'name: Quick mock PWA build', 'Web CI must define the quick mock build');
requireText(quickBuildJob, 'run: pnpm build', 'The quick mock build must run pnpm build');
forbidText(quickBuildJob, 'needs:', 'The quick mock build must not depend on formatting');

requireText(
  quickAggregateJob,
  'name: Quick format, type, unit, and build checks',
  'Web CI must preserve the stable quick aggregate name',
);
for (const dependency of ['format', 'core', 'quick-build']) {
  requireText(quickAggregateJob, `- ${dependency}`, `Quick aggregate must require ${dependency}`);
}
for (const [dependency, expression] of [
  ['format', 'needs.format.result'],
  ['core', 'needs.core.result'],
  ['quick-build', "needs['quick-build'].result"],
]) {
  requireText(
    quickAggregateJob,
    expression,
    `Quick aggregate must inspect the ${dependency} conclusion`,
  );
}
requireText(
  quickAggregateJob,
  'always() &&',
  'Quick aggregate must evaluate all dependency outcomes',
);
forbidText(
  quickAggregateJob,
  'actions/checkout',
  'Quick aggregate must not check out the repository',
);
forbidText(quickAggregateJob, 'pnpm install', 'Quick aggregate must not reinstall dependencies');
forbidText(quickAggregateJob, 'pnpm test', 'Quick aggregate must not rerun tests');

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
forbidText(
  ci,
  'pull_request_target',
  'Web CI must never execute PR code through pull_request_target',
);
forbidText(ci, 'contents: write', 'Web CI must remain read-only');
requireText(ci, 'contents: read', 'Web CI must retain contents: read permissions');

requireText(
  prettierFixJob,
  'name: Generate exact-head Prettier fix artifact',
  'Web CI must define the exact-head Prettier artifact job',
);
for (const required of [
  "github.event_name == 'pull_request'",
  'github.event.pull_request.head.repo.full_name == github.repository',
  'ref: ${{ github.event.pull_request.head.sha }}',
  'fetch-depth: 0',
  'persist-credentials: false',
  'git rev-parse HEAD',
  'github.event.pull_request.base.sha',
  'github.event.pull_request.head.sha',
  'version: 10.12.1',
  'node-version: 22',
  'pnpm install --frozen-lockfile',
  'node tools/generate-prettier-fix.mjs',
  'name: prettier-fix-${{ github.event.pull_request.head.sha }}',
  'retention-days: 1',
]) {
  requireText(prettierFixJob, required, `Exact-head Prettier job is missing ${required}`);
}
forbidText(prettierFixJob, 'needs:', 'Exact-head patch generation must run independently');
forbidText(prettierFixJob, 'secrets.', 'Exact-head patch generation must not use secrets');

requireText(
  fullLinuxJob,
  'name: Full Linux aggregate and browser validation',
  'Web CI must define the full Linux tier',
);
requireText(
  fullWindowsJob,
  'name: Full Windows mock, staging, and production builds',
  'Web CI must define the full Windows tier',
);
for (const fullJob of [fullLinuxJob, fullWindowsJob]) {
  requireText(fullJob, '- format', 'Full CI must wait for the format job');
  requireText(fullJob, '- core', 'Full CI must wait for the core job');
}
for (const command of ['pnpm build', 'pnpm test:ports', 'pnpm test:e2e', 'pnpm test:e2e:staging']) {
  requireText(fullLinuxJob, command, `Full Linux validation must run ${command}`);
}
forbidText(ci, 'pnpm check:all', 'CI must not rerun format and core checks through check:all');
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

for (const required of [
  "prettierVersion: '3.9.5'",
  "pnpmVersion: '10.12.1'",
  "'--name-status'",
  "'-z'",
  "'--diff-filter=ACMR'",
  'getFileInfo',
  'resolveConfig',
  'prettier.format',
  'git apply',
  'sha256',
  'Working tree must be clean',
  'Exact-head mismatch',
  'Binary candidate rejected',
]) {
  requireText(prettierFixGenerator, required, `Prettier patch helper is missing ${required}`);
}
forbidText(
  prettierFixGenerator,
  "'--cached'",
  'Prettier patch generation must not use the staging area',
);
for (const required of [
  'added, copied, modified, and renamed',
  'traversal, absolute, empty, and control-character',
  'Binary candidate rejected',
  'Changed-file limit exceeded',
  'Total input byte limit exceeded',
  'CRLF',
  'divergent head',
  'Exact-head mismatch',
]) {
  requireText(
    prettierFixTest,
    required,
    `Prettier patch helper test coverage is missing ${required}`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  'Workflow, exact-head patch, bundle, atomic-publication, and agent-index policies are consistent.',
);

async function read(filePath) {
  return await readFile(filePath, 'utf8');
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function extractJob(workflow, jobName) {
  const jobsStart = workflow.indexOf('\njobs:\n');
  if (jobsStart < 0) {
    failures.push('Web CI must contain a jobs section.');
    return '';
  }
  const jobsText = workflow.slice(jobsStart + 1);
  const matches = [...jobsText.matchAll(/^ {2}([A-Za-z0-9_-]+):\n/gmu)];
  const currentIndex = matches.findIndex((match) => match[1] === jobName);
  if (currentIndex < 0) {
    failures.push(`Web CI is missing job ${jobName}.`);
    return '';
  }
  const start = matches[currentIndex].index;
  const end = matches[currentIndex + 1]?.index ?? jobsText.length;
  return jobsText.slice(start, end);
}

function requireText(value, expected, message) {
  if (!String(value || '').includes(expected)) failures.push(message);
}

function forbidText(value, forbidden, message) {
  if (String(value || '').includes(forbidden)) failures.push(message);
}
