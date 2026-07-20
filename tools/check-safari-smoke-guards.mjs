import { readFileSync } from 'node:fs';

const smoke = readFileSync(new URL('./safari-smoke.py', import.meta.url), 'utf8');
const workflow = readFileSync(
  new URL('../.github/workflows/apple-smoke.yml', import.meta.url),
  'utf8',
);
const errors = [];

function requireText(source, text, description) {
  if (!source.includes(text)) errors.push(`missing ${description}`);
}

function forbidText(source, text, description) {
  if (source.includes(text)) errors.push(`forbidden ${description}`);
}

function stepBody(name) {
  const marker = `- name: ${name}`;
  const start = workflow.indexOf(marker);
  if (start < 0) {
    errors.push(`missing workflow step ${name}`);
    return '';
  }
  const end = workflow.indexOf('\n      - name:', start + marker.length);
  return workflow.slice(start, end < 0 ? workflow.length : end);
}

forbidText(smoke, 'def send_file', 'SafariDriver native file upload method');
forbidText(smoke, 'send_file(', 'SafariDriver native file upload call');
forbidText(smoke, 'Normalisiertes JPEG:', 'JPEG assertion in readiness smoke');
forbidText(smoke, 'Abmessungsgrenzen', 'JPEG boundary assertion in readiness smoke');
forbidText(smoke, 'create_jpeg_fixture', 'JPEG fixture generation in readiness smoke');

const readiness = stepBody('Run live readiness/privacy Safari smoke');
requireText(readiness, 'tools/safari-smoke.py', 'readiness smoke command');
forbidText(readiness, 'safari-jpeg-diagnostic.py', 'JPEG diagnostic in readiness smoke');

const liveJpeg = stepBody('Run live Safari JPEG gate');
requireText(
  liveJpeg,
  'tools/safari-jpeg-diagnostic.py',
  'canonical remote JPEG diagnostic command',
);
requireText(
  liveJpeg,
  'TESTED_REVISION: ${{ needs.prepare.outputs.checkout_ref }}',
  'exact revision for remote JPEG diagnostic',
);
forbidText(liveJpeg, 'continue-on-error', 'non-blocking remote JPEG diagnostic');
forbidText(workflow, 'send_file', 'native Safari file transport in Apple workflow');
requireText(workflow, 'name: apple-safari-local-jpeg-${{ github.run_id }}', 'local JPEG artifact');
requireText(
  workflow,
  'name: apple-safari-live-readiness-${{ github.run_id }}',
  'live readiness artifact',
);
requireText(workflow, 'name: apple-safari-live-jpeg-${{ github.run_id }}', 'live JPEG artifact');
forbidText(
  workflow,
  'apple-safari/local-jpeg/local-https-server.log',
  'server log in local JPEG artifact',
);
forbidText(
  workflow,
  'apple-safari/local-jpeg/safaridriver.log',
  'SafariDriver log in local JPEG artifact',
);

if (errors.length > 0) {
  console.error('Safari smoke guards failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Safari smoke guards passed.');
