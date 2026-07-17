import { execFileSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DIST_ROOT = path.resolve('dist');
const port = readPort(process.argv);
const useHttps = process.argv.includes('--https');
const headerRules = parseHeaderRules(await readFile(path.join(DIST_ROOT, '_headers'), 'utf8'));
const listener = async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `${useHttps ? 'https' : 'http'}://127.0.0.1:${port}`);
    const pathname = decodeURIComponent(url.pathname);
    const file = await resolveFile(pathname);
    const body = await readFile(file);
    for (const [name, value] of headersFor(pathname, headerRules)) response.setHeader(name, value);
    response.setHeader('Content-Type', contentType(file));
    response.setHeader('Content-Length', String(body.byteLength));
    response.statusCode = 200;
    if (request.method === 'HEAD') response.end();
    else response.end(body);
  } catch (error) {
    response.statusCode = error instanceof NotFoundError ? 404 : 500;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end(error instanceof Error ? error.message : 'Built Web server failure');
  }
};

const server = useHttps
  ? createHttpsServer(await createLocalCertificate(), listener)
  : createHttpServer(listener);
server.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Built Web artifact available at ${useHttps ? 'https' : 'http'}://127.0.0.1:${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

async function resolveFile(pathname) {
  if (pathname.startsWith('/api/'))
    throw new NotFoundError('API routes are not served by the Web artifact.');
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const candidate = safeJoin(relative);
  if (await isFile(candidate)) return candidate;
  if (!path.extname(relative)) {
    const fallback = safeJoin('index.html');
    if (await isFile(fallback)) return fallback;
  }
  throw new NotFoundError(`No built asset for ${pathname}`);
}

function safeJoin(relative) {
  const candidate = path.resolve(DIST_ROOT, relative);
  if (candidate !== DIST_ROOT && !candidate.startsWith(`${DIST_ROOT}${path.sep}`)) {
    throw new NotFoundError('Invalid asset path.');
  }
  return candidate;
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function parseHeaderRules(source) {
  const rules = [];
  let current;
  for (const line of source.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    if (!/^\s/u.test(line)) {
      current = { pattern: line.trim(), headers: new Map() };
      rules.push(current);
      continue;
    }
    if (!current) throw new Error('Header line appeared before a path rule.');
    const separator = line.indexOf(':');
    if (separator < 0) throw new Error(`Malformed header rule: ${line.trim()}`);
    current.headers.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return rules;
}

function headersFor(pathname, rules) {
  const result = new Map();
  for (const rule of rules) {
    if (!matches(pathname, rule.pattern)) continue;
    for (const [name, value] of rule.headers) result.set(name, value);
  }
  return result;
}

function matches(pathname, pattern) {
  if (pattern === '/*') return true;
  if (pattern.endsWith('*')) return pathname.startsWith(pattern.slice(0, -1));
  return pathname === pattern;
}

async function createLocalCertificate() {
  const directory = await mkdtemp(path.join(tmpdir(), 'owli-built-web-'));
  const keyPath = path.join(directory, 'localhost-key.pem');
  const certificatePath = path.join(directory, 'localhost-cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      keyPath,
      '-out',
      certificatePath,
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1,DNS:localhost',
    ],
    { stdio: 'ignore' },
  );
  return { key: await readFile(keyPath), cert: await readFile(certificatePath) };
}

function readPort(args) {
  const index = args.indexOf('--port');
  const value = index >= 0 ? Number(args[index + 1]) : 4180;
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error('Invalid --port.');
  return value;
}

function contentType(file) {
  const extension = path.extname(file).toLowerCase();
  return (
    {
      '.css': 'text/css; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.ico': 'image/x-icon',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.webmanifest': 'application/manifest+json; charset=utf-8',
      '.woff2': 'font/woff2',
    }[extension] ?? 'application/octet-stream'
  );
}

class NotFoundError extends Error {}
