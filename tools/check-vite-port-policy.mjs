import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

await withOccupiedPort(5173, () =>
  expectFastFailure(['exec', 'vite', '--host', '127.0.0.1'], 5173),
);
await withOccupiedPort(4173, () =>
  expectFastFailure(['exec', 'vite', 'preview', '--host', '127.0.0.1'], 4173),
);
console.log('Vite dev and preview ports fail fast when occupied.');

async function withOccupiedPort(port, operation) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  try {
    await operation();
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function expectFastFailure(args, port) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, {
      env: process.env,
      shell: process.platform === 'win32',
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Vite did not fail fast while port ${port} was occupied.`));
    }, 10_000);

    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        reject(new Error(`Vite exited successfully while port ${port} was occupied.`));
        return;
      }
      if (!output.includes(String(port))) {
        reject(new Error(`Vite failed without identifying occupied port ${port}: ${output}`));
        return;
      }
      resolve();
    });
  });
}
