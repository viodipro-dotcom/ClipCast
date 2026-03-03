#!/usr/bin/env node
/** Cross-platform runner for guide screenshot generation. Sets GENERATE_GUIDE=1 and runs Playwright. */
import { spawnSync } from 'child_process';

const env = { ...process.env, GENERATE_GUIDE: '1' };
const r = spawnSync('npx', ['playwright', 'test', 'e2e/guide-screenshots.spec.ts'], {
  stdio: 'inherit',
  env,
  shell: true,
});
process.exit(r.status ?? 1);
