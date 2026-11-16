/**
 * Builds the offline demo: ONE html file with the whole app inside, running against a built-in mock database.
 *
 *   pnpm demo:build        ->  demo/PT-Planner-Demo.html
 *
 * Open the file in Chrome, Edge or Firefox: no internet, account or server needed. Copy it to a USB stick to demo
 * on another computer. Changes are kept in that browser's local storage; the "Reset demo" button starts over.
 */
/* global console */
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execSync('pnpm --filter @pt/web build:demo', { cwd: root, stdio: 'inherit' });
mkdirSync(join(root, 'demo'), { recursive: true });
const out = join(root, 'demo', 'PT-Planner-Demo.html');
copyFileSync(join(root, 'apps', 'web', 'dist-demo', 'index.html'), out);
console.log(`
Demo ready: ${out} (${(statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
