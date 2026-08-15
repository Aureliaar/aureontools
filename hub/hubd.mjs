#!/usr/bin/env node
// hubd — a small supervisor for the local project zoo.
//
//   node hubd.mjs [--registry <ports.json>] [--port 7777] [--no-autostart]
//
// Serves the hub UI at http://localhost:<port>, reports real TCP liveness for
// every registered port, and starts/stops the servers on request. Projects
// flagged "autostart": true in the registry are booted when the daemon starts.
//
// Binds loopback only, and rejects cross-origin requests: this endpoint can run
// arbitrary commands from the registry, so it must not be reachable from a page
// you happen to have open.

import { createServer } from 'node:http';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { page, computeProjects, resolveRegistry } from './hub-ui.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- args

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg('--port', process.env.HUB_PORT || 7777));
const NO_AUTOSTART = process.argv.includes('--no-autostart');
const REGISTRY = resolveRegistry(process.argv, [here, process.cwd(), 'E:/experiments']);

const LOG_LINES = 400;

// ---------------------------------------------------------------- registry

// Re-read on every use so edits to ports.json land without a restart.
function loadRegistry() {
  const reg = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  reg.root = reg.root || dirname(REGISTRY);
  return reg;
}

function projectDir(reg, p) {
  return isAbsolute(p.dir) ? p.dir : resolve(reg.root, p.dir);
}

// ---------------------------------------------------------------- usage store
//
// Kept beside the registry but in its own file: ports.json is hand-edited, this
// is machine-written, and mixing the two would mean fighting over the same file.

const STATE_FILE = resolve(dirname(REGISTRY), 'hub-state.json');

const state = (() => {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); }
  catch { return { lastSeen: {}, starts: {} }; }
})();
state.lastSeen ||= {};
state.starts ||= {};

let flushTimer = null;
function saveState() {
  if (flushTimer) return; // coalesce the 3s-poll churn into one write
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try { writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n'); }
    catch (e) { console.error(`[hubd] could not write ${STATE_FILE}: ${e.message}`); }
  }, 2000);
  flushTimer.unref?.();
}

function touch(name, { counts = false } = {}) {
  state.lastSeen[name] = Date.now();
  if (counts) state.starts[name] = (state.starts[name] || 0) + 1;
  saveState();
}

// ---------------------------------------------------------------- process table

/** name -> { child, pid, logs: string[], startedAt } */
const managed = new Map();

function log(name, chunk) {
  const entry = managed.get(name);
  if (!entry) return;
  entry.logs.push(chunk);
  if (entry.logs.length > LOG_LINES) entry.logs.splice(0, entry.logs.length - LOG_LINES);
}

function start(name) {
  const reg = loadRegistry();
  const p = reg.projects.find((x) => x.name === name);
  if (!p) throw new Error(`unknown project: ${name}`);
  if (!p.start) throw new Error(`${name} has no start command`);
  if (managed.get(name)?.child) throw new Error(`${name} is already running here`);

  const cwd = projectDir(reg, p);
  if (!existsSync(cwd)) throw new Error(`missing directory: ${cwd}`);

  // shell:true so registry entries can be ordinary command lines
  // ("npm start", "python serve.py") rather than argv arrays.
  const child = spawn(p.start, { cwd, shell: true, windowsHide: true });
  const entry = { child, pid: child.pid, logs: [], startedAt: Date.now() };
  managed.set(name, entry);

  log(name, `$ ${p.start}\n  in ${cwd}\n\n`);
  child.stdout.on('data', (b) => log(name, b.toString()));
  child.stderr.on('data', (b) => log(name, b.toString()));
  child.on('error', (e) => log(name, `\n[spawn error] ${e.message}\n`));
  child.on('exit', (code, signal) => {
    log(name, `\n[exited ${signal ? 'via ' + signal : 'with code ' + code}]\n`);
    const cur = managed.get(name);
    if (cur) cur.child = null; // keep the logs around for inspection
  });

  touch(name, { counts: true });
  console.log(`[hubd] started ${name} (pid ${child.pid}) in ${cwd}`);
  return entry;
}

function stop(name) {
  const entry = managed.get(name);
  if (!entry?.child) throw new Error(`${name} is not running under the hub`);
  const pid = entry.child.pid;

  if (process.platform === 'win32') {
    // child.kill() only reaches the shell; npm/python grandchildren survive it.
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  } else {
    entry.child.kill('SIGTERM');
  }
  console.log(`[hubd] stopped ${name} (pid ${pid})`);
}

// ---------------------------------------------------------------- liveness

function isListening(port, timeout = 400) {
  return new Promise((done) => {
    const sock = connect({ host: '127.0.0.1', port, timeout });
    const finish = (v) => { sock.destroy(); done(v); };
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

/** port -> was it up last poll? Used to spot the moment something comes up. */
const prevLive = new Map();

async function status() {
  const reg = loadRegistry();
  const ports = [...new Set(reg.projects.filter((p) => p.port).map((p) => p.port))];
  const live = Object.fromEntries(
    await Promise.all(ports.map(async (port) => [port, await isListening(port)]))
  );

  // Count a port coming up as usage, so servers you start from a terminal still
  // register. Only the transition counts — something parked on a port for weeks
  // isn't "recently used", and would otherwise squat in the recent tier forever.
  // Shared ports are skipped: with seven forks on 4173 there's no telling which.
  for (const port of ports) {
    const wasLive = prevLive.get(port);
    prevLive.set(port, live[port]);
    if (!live[port] || wasLive !== false) continue;
    const owners = reg.projects.filter((p) => p.port === port);
    if (owners.length === 1) touch(owners[0].name);
  }

  // A port can be up because we started it, or because it was already there.
  const out = {};
  for (const port of ports) out[port] = { listening: live[port], managed: false, pid: null };
  for (const [name, entry] of managed) {
    if (!entry.child) continue;
    const p = reg.projects.find((x) => x.name === name);
    if (p?.port && out[p.port]) {
      out[p.port].managed = true;
      out[p.port].pid = entry.pid;
    }
  }
  return out;
}

// ---------------------------------------------------------------- http

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(data);
}

// Guard against a random page in the browser POSTing to this daemon.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // plain navigation / curl
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  } catch { return false; }
}

function readBody(req) {
  return new Promise((done, fail) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 1e5) { fail(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => { try { done(s ? JSON.parse(s) : {}); } catch (e) { fail(e); } });
  });
}

const server = createServer(async (req, res) => {
  if (!sameOrigin(req)) return json(res, 403, { error: 'cross-origin request refused' });
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const reg = loadRegistry();
      const html = page({
        projects: computeProjects(reg, state),
        interactive: true,
        footer: `Served by <code>hubd.mjs</code> from <code>${REGISTRY}</code>, usage in ` +
                `<code>hub-state.json</code>. Add a project to the registry — no restart needed. ` +
                `Tiers are by recency (last ${reg.recentDays ?? 14} days); ` +
                `<code>"pin"</code> and <code>"archive"</code> override. Reload to re-tier.`,
      });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html);
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(res, 200, { status: await status(), lastSeen: state.lastSeen });
    }

    // Fired by sendBeacon when a project link is clicked — the one signal that
    // can attribute usage when several projects share a port.
    if (req.method === 'POST' && url.pathname === '/api/touch') {
      const { name } = await readBody(req);
      const reg = loadRegistry();
      if (!reg.projects.some((p) => p.name === name)) throw new Error(`unknown project: ${name}`);
      touch(name);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/logs') {
      const name = url.searchParams.get('name');
      return json(res, 200, { lines: managed.get(name)?.logs ?? [] });
    }

    if (req.method === 'POST' && (url.pathname === '/api/start' || url.pathname === '/api/stop')) {
      const { name } = await readBody(req);
      if (url.pathname === '/api/start') start(name); else stop(name);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[hubd] port ${PORT} is already taken — is hubd already running?`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[hubd] http://localhost:${PORT}  ·  registry: ${REGISTRY}`);

  if (NO_AUTOSTART) return;
  const reg = loadRegistry();
  const boot = reg.projects.filter((p) => p.autostart && p.start);
  if (!boot.length) return console.log('[hubd] nothing flagged "autostart" in the registry');
  console.log(`[hubd] autostarting ${boot.length}: ${boot.map((p) => p.name).join(', ')}`);
  for (const p of boot) {
    try { start(p.name); } catch (e) { console.error(`[hubd] ${p.name}: ${e.message}`); }
  }
});

// Don't leave orphaned servers behind when the daemon goes down.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const name of managed.keys()) { try { stop(name); } catch {} }
    process.exit(0);
  });
}
