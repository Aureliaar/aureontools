#!/usr/bin/env node
// Renders the hub in headless Chrome and asserts it actually drew something.
//
//   node check-hub.mjs [--port 7777]
//
// The client script lives in a template string, so nothing type-checks it. A
// parse guard in hub-ui.mjs catches syntax errors, but the failure that reached
// production was a temporal-dead-zone ReferenceError — valid syntax, dead page.
// Only running it in a browser catches that class, so this does.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const i = process.argv.indexOf('--port');
const port = i !== -1 ? process.argv[i + 1] : '7777';
const url = `http://localhost:${port}/`;

const BROWSERS = [
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const browser = BROWSERS.find((b) => b && existsSync(b));
if (!browser) {
  console.error('No Chromium browser found — cannot render-check.');
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'hub-check-'));
let dom = '', log = '';
try {
  const r = spawnSync(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--virtual-time-budget=6000',
    `--user-data-dir=${profile}`,
    '--enable-logging=stderr', '--v=1',
    '--dump-dom', url,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  dom = r.stdout || '';
  log = r.stderr || '';
} finally {
  rmSync(profile, { recursive: true, force: true });
}

const consoleErrors = log
  .split('\n')
  .filter((l) => /INFO:CONSOLE/.test(l) && /Uncaught|Error/.test(l))
  .map((l) => l.replace(/^.*INFO:CONSOLE[^\]]*\]\s*/, '').trim());

const cards = (dom.match(/class="card"/g) || []).length;
const stillChecking = /<span id="probe-msg">checking…<\/span>/.test(dom);

const problems = [];
if (!dom) problems.push('browser produced no DOM (is the hub running on ' + url + '?)');
if (consoleErrors.length) problems.push('console errors:\n    ' + consoleErrors.join('\n    '));
if (cards === 0) problems.push('no project cards rendered');
if (stillChecking) problems.push('liveness never resolved — probe-msg still reads "checking…"');

if (problems.length) {
  console.error('hub render check FAILED');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

const live = (dom.match(/class="dot up"/g) || []).length;
const recent = (dom.match(/Recent \((\d+)\)/) || [])[1] ?? '0';
const tail = (dom.match(/Everything else \((\d+)\)/) || [])[1] ?? '0';
console.log(`hub render check OK — ${cards} cards (${recent} recent, ${tail} folded), ${live} live`);
