// Finds Playwright whether it is installed locally or globally (dev tools only).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
let pw;
try { pw = createRequire(import.meta.url)('playwright'); }
catch (e) { pw = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright'); }
export const { chromium } = pw;
