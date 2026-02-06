/**
 * Convenience test runner.
 *
 * Why: makes it easy to run the unit suite + (optionally) the OpenAI-compatible
 * integration tests with your gateway.
 */

import { spawnSync } from 'node:child_process';

async function main() {
  const args = process.argv.slice(2);

  // By default, run *all* Vitest tests (unit + any integration tests that are
  // enabled by env vars).
  const vitestArgs = args.length > 0 ? args : ['run'];

  // Use local vitest binary via npx. Use spawnSync to avoid extra ESM/CJS
  // resolver edge-cases (notably under newer Node versions).
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const res = spawnSync(cmd, ['vitest', ...vitestArgs], {
    stdio: 'inherit',
    env: process.env,
  });
  if (typeof res.status === 'number' && res.status !== 0) process.exit(res.status);
  if (res.error) throw res.error;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
