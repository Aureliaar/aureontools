// Shared bits for the live daemon (hubd.mjs) and the static fallback page
// (build-hub.mjs): registry lookup plus the markup, kept in one place so the
// two front ends can't drift apart.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Where's the registry? Explicit --registry wins, then $HUB_REGISTRY, then a
 * ports.json in the given search dirs. The code can therefore live in a repo
 * while the registry stays with the projects it describes.
 */
export function resolveRegistry(argv, searchDirs = []) {
  const i = argv.indexOf('--registry');
  const explicit = i !== -1 ? argv[i + 1] : process.env.HUB_REGISTRY;
  if (explicit) return resolve(explicit);
  const found = searchDirs.map((d) => resolve(d, 'ports.json')).find(existsSync);
  if (!found) {
    throw new Error(
      'No ports.json found. Pass --registry <path> or set HUB_REGISTRY.\n' +
      'Looked in: ' + searchDirs.join(', ')
    );
  }
  return found;
}

export function computeProjects(reg) {
  // Which ports are claimed by more than one project? Surfaced as a warning badge.
  const portUsers = new Map();
  for (const p of reg.projects) {
    if (!p.port) continue;
    if (!portUsers.has(p.port)) portUsers.set(p.port, []);
    portUsers.get(p.port).push(p.name);
  }
  return reg.projects.map((p) => ({
    ...p,
    url: p.port ? `http://localhost:${p.port}/` : null,
    fileUrl: p.file ? `file:///${(reg.root + '/' + p.file).replace(/\\/g, '/')}` : null,
    clash: p.port && portUsers.get(p.port).length > 1
      ? portUsers.get(p.port).filter((n) => n !== p.name)
      : null,
  }));
}

const STYLE = String.raw`
  :root {
    --bg: #f7f6f3; --panel: #fff; --ink: #1a1a1a; --muted: #6b6b6b;
    --line: #e2e0da; --accent: #3b5bdb; --up: #2f9e44; --down: #c92a2a;
    --unknown: #adb5bd; --busy: #f08c00;
    --warn-bg: #fff4e6; --warn-ink: #b35309; --warn-line: #ffd8a8;
    --btn: #f1efea; --btn-ink: #333;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #17181a; --panel: #1f2124; --ink: #ececec; --muted: #9a9a9a;
      --line: #2e3135; --accent: #7d97f4; --up: #51cf66; --down: #ff6b6b;
      --unknown: #5c6166; --busy: #ffa94d;
      --warn-bg: #2c2113; --warn-ink: #ffc078; --warn-line: #4a3a1e;
      --btn: #2b2e32; --btn-ink: #ddd;
    }
  }
  :root[data-theme="dark"] {
    --bg: #17181a; --panel: #1f2124; --ink: #ececec; --muted: #9a9a9a;
    --line: #2e3135; --accent: #7d97f4; --up: #51cf66; --down: #ff6b6b;
    --unknown: #5c6166; --busy: #ffa94d;
    --warn-bg: #2c2113; --warn-ink: #ffc078; --warn-line: #4a3a1e;
    --btn: #2b2e32; --btn-ink: #ddd;
  }
  * { box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--ink); margin: 0;
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 2rem 1.5rem 4rem;
  }
  .wrap { max-width: 1100px; margin: 0 auto; }
  header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.75rem 1rem; }
  h1 { font-size: 1.4rem; margin: 0; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 0.85rem; }
  #q {
    width: 100%; margin: 1rem 0 1.5rem; padding: 0.6rem 0.85rem;
    background: var(--panel); color: var(--ink);
    border: 1px solid var(--line); border-radius: 8px; font: inherit;
  }
  #q:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  h2 {
    font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--muted); margin: 2rem 0 0.75rem; font-weight: 600;
  }
  .grid { display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  .card {
    background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    padding: 0.8rem 0.9rem; display: flex; flex-direction: column; gap: 0.35rem;
  }
  .card.hidden { display: none; }
  .row { display: flex; align-items: center; gap: 0.5rem; }
  .dot {
    width: 8px; height: 8px; border-radius: 50%; background: var(--unknown);
    flex: none; transition: background 0.2s;
  }
  .dot.up { background: var(--up); box-shadow: 0 0 0 3px color-mix(in srgb, var(--up) 22%, transparent); }
  .dot.down { background: var(--down); opacity: 0.5; }
  .dot.busy { background: var(--busy); animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.35; } }
  a.name { color: var(--ink); font-weight: 600; text-decoration: none; }
  a.name:hover { color: var(--accent); text-decoration: underline; }
  .spacer { flex: 1; }
  .what { color: var(--muted); font-size: 0.85rem; }
  .meta { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; margin-top: 0.15rem; }
  code {
    font: 0.78rem ui-monospace, "Cascadia Code", Consolas, monospace;
    background: color-mix(in srgb, var(--ink) 7%, transparent);
    padding: 0.1rem 0.4rem; border-radius: 4px; color: var(--muted);
  }
  .port { color: var(--accent); }
  .clash {
    background: var(--warn-bg); color: var(--warn-ink); border: 1px solid var(--warn-line);
    font-size: 0.72rem; padding: 0.1rem 0.4rem; border-radius: 4px;
  }
  .auto {
    border: 1px solid var(--line); color: var(--muted);
    font-size: 0.72rem; padding: 0.1rem 0.4rem; border-radius: 4px;
  }
  .note { color: var(--muted); font-size: 0.78rem; font-style: italic; }
  button {
    font: inherit; font-size: 0.78rem; padding: 0.15rem 0.55rem;
    background: var(--btn); color: var(--btn-ink);
    border: 1px solid var(--line); border-radius: 5px; cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  button:disabled { opacity: 0.35; cursor: default; }
  pre.log {
    display: none; margin: 0.4rem 0 0; padding: 0.5rem 0.6rem; max-height: 190px;
    overflow: auto; background: color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: 6px; font: 0.72rem/1.45 ui-monospace, Consolas, monospace;
    color: var(--muted); white-space: pre-wrap; word-break: break-word;
  }
  pre.log.open { display: block; }
  footer { color: var(--muted); font-size: 0.78rem; margin-top: 3rem; border-top: 1px solid var(--line); padding-top: 1rem; }
  #probe-msg { color: var(--muted); font-size: 0.78rem; }
`;

const CLIENT = String.raw`
const GROUPS = [
  ['web', 'Servers'],
  ['static', 'Static — just open them'],
  ['service', 'Background services'],
];
const byName = new Map(PROJECTS.map((p) => [p.name, p]));
const out = document.getElementById('out');

for (const [kind, label] of GROUPS) {
  const items = PROJECTS.filter((p) => p.kind === kind);
  if (!items.length) continue;
  const h = document.createElement('h2');
  h.textContent = label + ' (' + items.length + ')';
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const p of items) grid.appendChild(card(p));
  out.append(h, grid);
}

function card(p) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.name = p.name;
  el.dataset.search = [p.name, p.what, p.dir, p.port, p.note].filter(Boolean).join(' ').toLowerCase();

  const row = document.createElement('div');
  row.className = 'row';
  if (p.port) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.dataset.port = p.port;
    dot.title = 'checking…';
    row.appendChild(dot);
  }
  const a = document.createElement('a');
  a.className = 'name';
  a.textContent = p.name;
  a.href = p.url || p.fileUrl || '#';
  row.appendChild(a);
  row.appendChild(Object.assign(document.createElement('span'), { className: 'spacer' }));

  if (INTERACTIVE && p.start && p.port) {
    const start = document.createElement('button');
    start.textContent = 'Start';
    start.onclick = () => act('start', p.name, start);
    const stop = document.createElement('button');
    stop.textContent = 'Stop';
    stop.onclick = () => act('stop', p.name, stop);
    const log = document.createElement('button');
    log.textContent = 'Log';
    log.onclick = () => toggleLog(p.name, log);
    row.append(start, stop, log);
  }
  el.appendChild(row);

  el.appendChild(Object.assign(document.createElement('div'), { className: 'what', textContent: p.what || '' }));

  const meta = document.createElement('div');
  meta.className = 'meta';
  if (p.port) meta.appendChild(Object.assign(document.createElement('code'), { className: 'port', textContent: ':' + p.port }));
  if (p.start) {
    const c = Object.assign(document.createElement('code'), { textContent: p.start });
    c.title = p.dir;
    meta.appendChild(c);
  }
  if (p.fileUrl && p.kind === 'static') {
    meta.appendChild(Object.assign(document.createElement('code'), { textContent: p.file.split('/').pop() }));
  }
  if (p.autostart) {
    const b = Object.assign(document.createElement('span'), { className: 'auto', textContent: '⏻ at logon' });
    b.title = 'Started automatically when the daemon boots';
    meta.appendChild(b);
  }
  if (p.clash) {
    const w = Object.assign(document.createElement('span'), { className: 'clash', textContent: '⚠ port shared with ' + p.clash.length });
    w.title = 'Also claimed by: ' + p.clash.join(', ');
    meta.appendChild(w);
  }
  el.appendChild(meta);

  if (p.note) el.appendChild(Object.assign(document.createElement('div'), { className: 'note', textContent: p.note }));

  const log = document.createElement('pre');
  log.className = 'log';
  el.appendChild(log);
  return el;
}

function cardEl(name) { return document.querySelector('.card[data-name="' + CSS.escape(name) + '"]'); }

async function act(what, name, btn) {
  btn.disabled = true;
  const dot = cardEl(name).querySelector('.dot');
  if (dot) dot.className = 'dot busy';
  try {
    const r = await fetch('/api/' + what, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const body = await r.json();
    if (!r.ok) showLog(name, 'ERROR: ' + (body.error || r.status));
  } catch (e) {
    showLog(name, 'ERROR: ' + e.message);
  } finally {
    btn.disabled = false;
    refresh();
  }
}

function showLog(name, text) {
  const pre = cardEl(name).querySelector('.log');
  pre.textContent = text;
  pre.classList.add('open');
  pre.scrollTop = pre.scrollHeight;
}

const openLogs = new Set();
async function toggleLog(name, btn) {
  const pre = cardEl(name).querySelector('.log');
  if (openLogs.has(name)) {
    openLogs.delete(name);
    pre.classList.remove('open');
    btn.textContent = 'Log';
  } else {
    openLogs.add(name);
    btn.textContent = 'Hide';
    await pumpLogs();
  }
}

async function pumpLogs() {
  for (const name of openLogs) {
    try {
      const r = await fetch('/api/logs?name=' + encodeURIComponent(name));
      const { lines } = await r.json();
      const pre = cardEl(name).querySelector('.log');
      const stuck = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 12;
      pre.textContent = lines.length ? lines.join('') : '(no output yet)';
      pre.classList.add('open');
      if (stuck) pre.scrollTop = pre.scrollHeight;
    } catch {}
  }
}

// --- filter ---
const q = document.getElementById('q');
q.addEventListener('input', () => {
  const term = q.value.trim().toLowerCase();
  for (const c of document.querySelectorAll('.card')) {
    c.classList.toggle('hidden', !!term && !c.dataset.search.includes(term));
  }
  for (const h of document.querySelectorAll('h2')) {
    const grid = h.nextElementSibling;
    const any = [...grid.children].some((c) => !c.classList.contains('hidden'));
    h.style.display = grid.style.display = any ? '' : 'none';
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); q.select(); }
});

// --- liveness ---
// With the daemon we get real TCP connect results. Without it we fall back to a
// no-cors fetch, where resolve-vs-reject is the only signal available.
async function probeStatic(port) {
  try {
    await fetch('http://127.0.0.1:' + port + '/', {
      mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(2000),
    });
    return true;
  } catch { return false; }
}

async function getStatus() {
  if (INTERACTIVE) {
    const r = await fetch('/api/state', { cache: 'no-store' });
    const { status } = await r.json();
    return status; // { port: {listening, managed, pid} }
  }
  const ports = [...new Set([...document.querySelectorAll('.dot')].map((d) => d.dataset.port))];
  const pairs = await Promise.all(ports.map(async (p) => [p, { listening: await probeStatic(p) }]));
  return Object.fromEntries(pairs);
}

async function refresh() {
  let status;
  try { status = await getStatus(); }
  catch {
    document.getElementById('probe-msg').textContent = 'daemon unreachable';
    for (const d of document.querySelectorAll('.dot')) { d.className = 'dot'; d.title = 'unknown'; }
    return;
  }
  const dots = [...document.querySelectorAll('.dot')];
  for (const d of dots) {
    const s = status[d.dataset.port] || {};
    d.className = 'dot ' + (s.listening ? 'up' : 'down');
    d.title = s.listening
      ? (s.managed ? 'running — started by the hub (pid ' + s.pid + ')' : 'listening — started elsewhere')
      : 'not running';
  }
  const live = Object.values(status).filter((s) => s.listening).length;
  const total = new Set(dots.map((d) => d.dataset.port)).size;
  document.getElementById('probe-msg').textContent = live + ' of ' + total + ' ports live';
  await pumpLogs();
}
refresh();
setInterval(refresh, INTERACTIVE ? 3000 : 10000);
`;

export function page({ projects, interactive, footer }) {
  return `<title>Experiments Hub</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${STYLE}</style>

<div class="wrap">
  <header>
    <h1>Experiments</h1>
    <span class="sub">${projects.length} things · <span id="probe-msg">checking…</span></span>
  </header>

  <input id="q" type="search" placeholder="Filter by name, port, or description…  (press / to focus)" autofocus>

  <div id="out"></div>

  <footer>${footer}</footer>
</div>

<script>
const PROJECTS = ${JSON.stringify(projects, null, 2)};
const INTERACTIVE = ${interactive ? 'true' : 'false'};
${CLIENT}
</script>
`;
}
