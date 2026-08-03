import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const CONTRACT = Object.freeze({
  prettierVersion: '3.9.5',
  pnpmVersion: '10.12.1',
  minimumGitVersion: '2.39.0',
  maxFiles: 200,
  maxTotalBytes: 8 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
});

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const CONTROL_PATTERN = /[\p{Cc}\p{Cf}]/u;
const LOCKFILE_NAMES = new Set([
  'bun.lock',
  'bun.lockb',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

export async function generatePrettierFix(options, dependencies = {}) {
  const repository = validateRepository(options.repository);
  const baseSha = validateSha(options.baseSha, 'base SHA');
  const headSha = validateSha(options.headSha, 'head SHA');
  const limits = validateLimits(options);
  const generatedAt = validateTimestamp(options.generatedAt ?? new Date().toISOString());
  const commandRunner = dependencies.commandRunner ?? runCommand;
  const prettier = dependencies.prettier ?? (await import('prettier'));

  const gitVersion = verifyGitVersion(
    dependencies.gitVersion ?? commandRunner('git', ['--version'], { encoding: 'utf8' }).stdout,
  );
  const pnpmVersion = verifyPnpmVersion(
    dependencies.pnpmVersion ?? commandRunner('pnpm', ['--version'], { encoding: 'utf8' }).stdout,
  );
  verifyPrettierVersion(prettier.version);

  const repositoryRoot = await resolveRepositoryRoot(commandRunner);
  const output = await resolveOutputDirectory(repositoryRoot, options.outputDirectory);
  verifyExactHead(commandRunner, repositoryRoot, headSha);
  verifyCommitObject(commandRunner, repositoryRoot, baseSha, 'base SHA');
  verifyCommitObject(commandRunner, repositoryRoot, headSha, 'head SHA');
  verifyCleanWorkingTree(commandRunner, repositoryRoot);

  const mergeBaseSha = commandRunner('git', ['merge-base', baseSha, headSha], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).stdout.trim();
  validateSha(mergeBaseSha, 'merge-base SHA');

  const changed = parseNameStatus(
    commandRunner(
      'git',
      [
        'diff',
        '--name-status',
        '-z',
        '--diff-filter=ACMR',
        '--find-renames',
        '--find-copies',
        '--find-copies-harder',
        `${mergeBaseSha}..${headSha}`,
        '--',
      ],
      { cwd: repositoryRoot },
    ).stdout,
  );
  if (changed.length > limits.maxFiles) {
    throw new Error(`Changed-file limit exceeded: ${changed.length} > ${limits.maxFiles}.`);
  }

  const formattedFiles = [];
  let totalInputBytes = 0;
  for (const changedFile of changed.sort((left, right) => left.path.localeCompare(right.path))) {
    const safePath = validateRepositoryPath(changedFile.path);
    const absolutePath = await resolveSafeFile(repositoryRoot, safePath);
    verifyHeadBlob(commandRunner, repositoryRoot, headSha, safePath);

    const basename = path.posix.basename(safePath);
    if (LOCKFILE_NAMES.has(basename)) continue;

    const fileInfo = await prettier.getFileInfo(absolutePath, {
      ignorePath: path.join(repositoryRoot, '.prettierignore'),
      withNodeModules: false,
    });
    if (fileInfo.ignored || fileInfo.inferredParser === null) continue;

    const input = await readFile(absolutePath);
    if (input.byteLength > limits.maxFileBytes) {
      throw new Error(`Per-file byte limit exceeded for ${safePath}.`);
    }
    totalInputBytes += input.byteLength;
    if (totalInputBytes > limits.maxTotalBytes) {
      throw new Error('Total input byte limit exceeded.');
    }
    if (input.includes(0)) throw new Error(`Binary candidate rejected: ${safePath}.`);

    const source = decodeUtf8(input, safePath);
    const config = (await prettier.resolveConfig(absolutePath, { editorconfig: true })) ?? {};
    const formatted = await prettier.format(source, { ...config, filepath: absolutePath });
    if (formatted !== source) {
      await writeFile(absolutePath, formatted, 'utf8');
      formattedFiles.push(safePath);
    }
  }

  const patch = formattedFiles.length
    ? commandRunner(
        'git',
        [
          'diff',
          '--patch',
          '--no-ext-diff',
          '--no-color',
          '--full-index',
          '--src-prefix=a/',
          '--dst-prefix=b/',
          '--',
          ...formattedFiles,
        ],
        { cwd: repositoryRoot },
      ).stdout
    : Buffer.alloc(0);
  if (patch.includes(Buffer.from('GIT binary patch'))) {
    throw new Error('Generated patch unexpectedly contains binary data.');
  }
  commandRunner('git', ['diff', '--check', '--', ...formattedFiles], { cwd: repositoryRoot });

  await mkdir(output.absolutePath, { recursive: true });
  const patchPath = path.join(output.absolutePath, 'prettier-fix.patch');
  await writeFile(patchPath, patch);
  if (patch.byteLength > 0) {
    commandRunner('git', ['restore', '--worktree', '--source=HEAD', '--', ...formattedFiles], {
      cwd: repositoryRoot,
    });
    verifyCleanWorkingTree(commandRunner, repositoryRoot);
    commandRunner('git', ['apply', '--check', patchPath], { cwd: repositoryRoot });
  }

  const patchSha256 = createHash('sha256').update(patch).digest('hex');
  const manifest = {
    schemaVersion: 1,
    repository,
    baseSha,
    mergeBaseSha,
    headSha,
    prettierVersion: CONTRACT.prettierVersion,
    pnpmVersion,
    gitVersion,
    generatedAt,
    limits,
    changedFileCount: changed.length,
    formattedFiles,
    patchFile: 'prettier-fix.patch',
    patchBytes: patch.byteLength,
    patchSha256,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(output.absolutePath, 'manifest.json'), manifestText, 'utf8');
  await writeFile(path.join(output.absolutePath, 'README.txt'), createReadme(manifest), 'utf8');
  return { manifest, manifestText, patch };
}

export function parseNameStatus(rawOutput) {
  const raw = Buffer.isBuffer(rawOutput) ? rawOutput : Buffer.from(rawOutput);
  if (raw.byteLength === 0) return [];
  const payload = raw.subarray(0, raw.at(-1) === 0 ? -1 : undefined);
  const fields = [];
  let start = 0;
  for (let index = 0; index <= payload.byteLength; index += 1) {
    if (index === payload.byteLength || payload[index] === 0) {
      fields.push(decodeUtf8(payload.subarray(start, index), 'git diff field'));
      start = index + 1;
    }
  }
  const files = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!/^[ACMR](?:\d{1,3})?$/u.test(status)) {
      throw new Error(`Unexpected git diff status: ${JSON.stringify(status)}.`);
    }
    if (status.startsWith('R') || status.startsWith('C')) {
      if (index + 1 >= fields.length) throw new Error('Truncated rename/copy record.');
      index += 1;
      files.push({ status: status[0], path: fields[index++] });
    } else {
      if (index >= fields.length) throw new Error('Truncated changed-file record.');
      files.push({ status: status[0], path: fields[index++] });
    }
  }
  return files;
}

export function validateRepositoryPath(value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Empty path rejected.');
  if (CONTROL_PATTERN.test(value))
    throw new Error(`Control character rejected in path ${JSON.stringify(value)}.`);
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error(`Absolute path rejected: ${value}.`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe path segment rejected: ${value}.`);
  }
  if (path.posix.normalize(value) !== value)
    throw new Error(`Non-normalized path rejected: ${value}.`);
  return value;
}

function validateRepository(value) {
  if (typeof value !== 'string' || !REPOSITORY_PATTERN.test(value) || CONTROL_PATTERN.test(value)) {
    throw new Error('Repository must use the exact owner/name form.');
  }
  return value;
}

function validateSha(value, label) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase full 40-character SHA.`);
  }
  return value;
}

function validateTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('generatedAt must be an ISO-8601 timestamp.');
  }
  return new Date(value).toISOString();
}

function validateLimits(options) {
  const limits = {
    maxFiles: options.maxFiles ?? CONTRACT.maxFiles,
    maxTotalBytes: options.maxTotalBytes ?? CONTRACT.maxTotalBytes,
    maxFileBytes: options.maxFileBytes ?? CONTRACT.maxFileBytes,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`${name} must be a positive integer.`);
  }
  if (limits.maxFileBytes > limits.maxTotalBytes) {
    throw new Error('maxFileBytes must not exceed maxTotalBytes.');
  }
  return limits;
}

function verifyGitVersion(rawVersion) {
  const match = /^git version (\d+\.\d+\.\d+)/u.exec(String(rawVersion).trim());
  if (!match || compareVersions(match[1], CONTRACT.minimumGitVersion) < 0) {
    throw new Error(`Git ${CONTRACT.minimumGitVersion} or newer is required.`);
  }
  return match[1];
}

function verifyPnpmVersion(rawVersion) {
  const version = String(rawVersion).trim();
  if (version !== CONTRACT.pnpmVersion) {
    throw new Error(`Expected pnpm ${CONTRACT.pnpmVersion}, received ${version || 'unknown'}.`);
  }
  return version;
}

function verifyPrettierVersion(version) {
  if (version !== CONTRACT.prettierVersion) {
    throw new Error(
      `Expected Prettier ${CONTRACT.prettierVersion}, received ${version || 'unknown'}.`,
    );
  }
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

async function resolveRepositoryRoot(commandRunner) {
  const root = commandRunner('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).stdout.trim();
  return await realpath(root);
}

async function resolveOutputDirectory(repositoryRoot, value) {
  const relativePath = validateRepositoryPath(value);
  const absolutePath = path.resolve(repositoryRoot, ...relativePath.split('/'));
  assertInsideRoot(repositoryRoot, absolutePath, relativePath);
  await verifyNoSymlinkParents(repositoryRoot, absolutePath);
  return { relativePath, absolutePath };
}

function verifyExactHead(commandRunner, repositoryRoot, expectedHead) {
  const actualHead = commandRunner('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).stdout.trim();
  if (actualHead !== expectedHead) {
    throw new Error(`Exact-head mismatch: expected ${expectedHead}, received ${actualHead}.`);
  }
}

function verifyCommitObject(commandRunner, repositoryRoot, sha, label) {
  commandRunner('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: repositoryRoot });
  const type = commandRunner('git', ['cat-file', '-t', sha], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).stdout.trim();
  if (type !== 'commit') throw new Error(`${label} is not a commit object.`);
}

function verifyCleanWorkingTree(commandRunner, repositoryRoot) {
  const status = commandRunner('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: repositoryRoot,
  }).stdout;
  if (status.byteLength > 0) throw new Error('Working tree must be clean before formatting.');
}

async function resolveSafeFile(repositoryRoot, relativePath) {
  const absolutePath = path.resolve(repositoryRoot, ...relativePath.split('/'));
  assertInsideRoot(repositoryRoot, absolutePath, relativePath);
  await verifyNoSymlinkParents(repositoryRoot, absolutePath);
  const stats = await lstat(absolutePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Candidate is not a regular file: ${relativePath}.`);
  }
  return absolutePath;
}

function assertInsideRoot(repositoryRoot, absolutePath, relativePath) {
  const relative = path.relative(repositoryRoot, absolutePath);
  if (
    relative === '' ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Path escapes repository root: ${relativePath}.`);
  }
}

async function verifyNoSymlinkParents(repositoryRoot, targetPath) {
  const relative = path.relative(repositoryRoot, targetPath);
  let current = repositoryRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) throw new Error(`Symbolic-link path rejected: ${current}.`);
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
  }
}

function verifyHeadBlob(commandRunner, repositoryRoot, headSha, relativePath) {
  const output = commandRunner('git', ['ls-tree', '-z', headSha, '--', relativePath], {
    cwd: repositoryRoot,
  }).stdout;
  const record = output.subarray(0, output.at(-1) === 0 ? -1 : undefined).toString('utf8');
  const match = /^(\d{6}) blob [0-9a-f]{40}\t/u.exec(record);
  if (!match || match[1] === '120000')
    throw new Error(`Head path is not a regular blob: ${relativePath}.`);
}

function decodeUtf8(input, relativePath) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    throw new Error(`Candidate is not valid UTF-8 text: ${relativePath}.`);
  }
}

function createReadme(manifest) {
  const applyCommands = manifest.patchBytes
    ? `git apply --check prettier-fix.patch\ngit apply prettier-fix.patch\ngit diff --check`
    : '# The patch is empty; no formatting changes are required.';
  return `Authoritative Prettier ${manifest.prettierVersion} patch\n\nRepository: ${manifest.repository}\nBase SHA: ${manifest.baseSha}\nMerge-base SHA: ${manifest.mergeBaseSha}\nExact head SHA: ${manifest.headSha}\nPatch SHA-256: ${manifest.patchSha256}\n\nVerify and apply from the repository root:\n\ntest "$(git rev-parse HEAD)" = "${manifest.headSha}"\ngit cat-file -e "${manifest.baseSha}^{commit}"\nprintf '%s  %s\\n' '${manifest.patchSha256}' prettier-fix.patch | sha256sum -c -\n${applyCommands}\n\nOn macOS, replace the sha256sum line with:\nprintf '%s  %s\\n' '${manifest.patchSha256}' prettier-fix.patch | shasum -a 256 -c -\n\nReview manifest.json before applying. Reject the artifact if repository, base SHA, exact head SHA, Prettier version, pnpm version, or patch hash differs from the expected CI run.\n`;
}

function runCommand(command, args, options = {}) {
  const encoding = options.encoding === 'utf8' ? 'utf8' : null;
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    encoding,
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : String(result.stderr ?? '');
    throw new Error(`${command} ${args.join(' ')} failed: ${stderr.trim()}`);
  }
  return {
    stdout: encoding === 'utf8' ? result.stdout : Buffer.from(result.stdout ?? []),
    stderr: encoding === 'utf8' ? result.stderr : Buffer.from(result.stderr ?? []),
  };
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined)
      throw new Error(`Invalid argument near ${key ?? '<end>'}.`);
    if (values.has(key)) throw new Error(`Duplicate argument: ${key}.`);
    values.set(key, value);
  }
  const required = ['--repository', '--base', '--head', '--output'];
  for (const key of required)
    if (!values.has(key)) throw new Error(`Missing required argument: ${key}.`);
  return {
    repository: values.get('--repository'),
    baseSha: values.get('--base'),
    headSha: values.get('--head'),
    outputDirectory: values.get('--output'),
    generatedAt: values.get('--generated-at'),
    maxFiles: parseOptionalInteger(values, '--max-files'),
    maxTotalBytes: parseOptionalInteger(values, '--max-total-bytes'),
    maxFileBytes: parseOptionalInteger(values, '--max-file-bytes'),
  };
}

function parseOptionalInteger(values, key) {
  if (!values.has(key)) return undefined;
  const value = Number(values.get(key));
  if (!Number.isSafeInteger(value)) throw new Error(`${key} must be an integer.`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generatePrettierFix(parseArguments(process.argv.slice(2)))
    .then(({ manifest }) => {
      console.log(
        `Generated ${manifest.patchFile} for ${manifest.formattedFiles.length} file(s), SHA-256 ${manifest.patchSha256}.`,
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
