import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outputDirectory = readOption('--output-dir') || 'artifacts/agent-index';
const excludedDirs = new Set([
  '.git',
  '__pycache__',
  'node_modules',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
  'artifacts',
  'tmp',
]);
const excludedFiles = new Set(['.git', 'pnpm-lock.yaml', 'typecheck.log']);
const files = (await walk(root))
  .map((file) => slash(path.relative(root, file)))
  .filter((file) => !excludedFiles.has(file))
  .sort();

const records = await Promise.all(
  files.map(async (file) => {
    const info = await stat(path.join(root, file));
    return { path: file, bytes: info.size, area: file.split('/')[0] || 'root' };
  }),
);

const index = `${JSON.stringify(
  {
    schemaVersion: 1,
    generatedBy: 'tools/generate-repo-index.mjs',
    files: records,
  },
  null,
  2,
)}\n`;

const grouped = Map.groupBy(records, (record) => record.area);
let treeSource = '# Generated Web Repository File Tree\n\n';
treeSource += 'Generated on demand by `tools/generate-repo-index.mjs`.\n\n';
for (const [area, areaFiles] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  treeSource += `## \`${area}/\`\n\n`;
  for (const file of areaFiles) treeSource += `- \`${file.path}\` (${file.bytes} B)\n`;
  treeSource += '\n';
}
const tree = treeSource;

const outputRoot = path.resolve(root, outputDirectory);
await mkdir(outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, 'repo-index.json'), index, 'utf8');
await writeFile(path.join(outputRoot, 'file-tree.md'), tree, 'utf8');
console.log(`AI repository index generated in ${slash(path.relative(root, outputRoot))}.`);

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirs.has(entry.name)) continue;
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(resolved)));
    else result.push(resolved);
  }
  return result;
}

function slash(value) {
  return value.split(path.sep).join('/');
}
