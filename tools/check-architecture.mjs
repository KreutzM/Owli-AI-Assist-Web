import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const files = await walk(srcRoot);
const failures = [];

for (const file of files.filter((value) => /\.(ts|tsx)$/u.test(value))) {
  const relative = slash(path.relative(root, file));
  const source = await readFile(file, 'utf8');
  const lines = source.split(/\r?\n/u).length;
  const lineLimit = relative.includes('.test.') ? 450 : 360;

  if (lines > lineLimit) failures.push(`${relative}: ${lines} lines exceeds ${lineLimit}`);
  if (source.includes('dangerouslySetInnerHTML'))
    failures.push(`${relative}: dangerouslySetInnerHTML is forbidden`);
  if (/\bfetch\s*\(/u.test(source) && !relative.startsWith('src/core/api/')) {
    failures.push(`${relative}: direct fetch belongs in src/core/api`);
  }

  const browserApi = /navigator\.(mediaDevices|share|clipboard)|speechSynthesis/u;
  if (browserApi.test(source) && !relative.startsWith('src/platform/')) {
    failures.push(`${relative}: direct browser capability access belongs in src/platform`);
  }

  const imports = [...source.matchAll(/from\s+['"]@\/([^'"]+)['"]/gu)].map((match) => match[1]);
  if (
    relative.startsWith('src/core/') &&
    imports.some((value) => /^(app|features|platform|shared)\//u.test(value))
  ) {
    failures.push(`${relative}: core must not depend on app, features, platform, or shared`);
  }
  if (
    relative.startsWith('src/shared/') &&
    imports.some((value) => /^(app|features)\//u.test(value))
  ) {
    failures.push(`${relative}: shared must not depend on app or features`);
  }
  if (relative.startsWith('src/features/')) {
    const ownFeature = relative.split('/')[2];
    const crossFeature = imports.find(
      (value) => value.startsWith('features/') && value.split('/')[1] !== ownFeature,
    );
    if (crossFeature)
      failures.push(`${relative}: cross-feature import ${crossFeature} is forbidden`);
  }
}

if (failures.length) {
  console.error('Architecture guardrails failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Architecture guardrails passed for ${files.length} source files.`);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const resolved = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(resolved) : [resolved];
    }),
  );
  return nested.flat();
}

function slash(value) {
  return value.split(path.sep).join('/');
}
