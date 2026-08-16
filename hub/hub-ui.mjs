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

const DAY = 86400e3;

/**
 * Decorate the registry for display, and sort each project into one of two
 * tiers. Tiering is derived from use rather than curated: anything live or
 * touched inside `recentDays` floats to the top and everything else sinks, so
 * the list maintains itself as the zoo grows. `pin` / `archive` override.
 *
 * `discovered.children` attaches servers found running inside a project's
 * worktrees — real places work happens that the registry can't know about.
 */
export function computeProjects(reg, state = {}, livePorts = new Set(), discovered = {}) {
  const lastSeen = state.lastSeen || {};
  const recentDays = reg.recentDays ?? 14;
  const cutoff = Date.now() - recentDays * DAY;
  const kids = discovered.children || {};
  const occupancy = discovered.occupancy || {};

  // Which ports are claimed by more than one project? Surfaced as a warning badge.
  const portUsers = new Map();
  for (const p of reg.projects) {
    if (!p.port) continue;
    if (!portUsers.has(p.port)) portUsers.set(p.port, []);
    portUsers.get(p.port).push(p.name);
  }

  const projects = reg.projects.map((p) => {
    const seen = lastSeen[p.name] || null;
    // Something answering on its port right now is the most relevant thing on
    // the page, whatever its history says — so liveness alone earns tier 1.
    // Children carry `label`; rows render `name`.
    const children = (kids[p.name] || []).map((c) => ({
      ...c, name: c.label || `:${c.port}`, live: true, parent: p.name,
    }));

    // Who is actually behind this port? A registered port can be occupied by a
    // different project entirely (5173 is every vite's default), and crediting
    // the wrong one is worse than showing nothing.
    const occ = p.port ? occupancy[p.port] : null;
    const taken = !!occ?.mismatch;
    const live = !!p.port && livePorts.has(p.port) && !taken;

    return {
      ...p,
      lastSeen: seen,
      live,
      occupiedBy: taken ? occ.actual : null,
      children,
      url: p.port ? `http://localhost:${p.port}/` : null,
      fileUrl: p.file ? `file:///${(reg.root + '/' + p.file).replace(/\\/g, '/')}` : null,
      clash: p.port && portUsers.get(p.port).length > 1
        ? portUsers.get(p.port).filter((n) => n !== p.name)
        : null,
      // A running child pulls its parent up too — otherwise the thing you're
      // actually working in hides under a fold.
      tier: live || children.length ? 1
          : p.archive ? 2
          : (p.pin || (seen && seen >= cutoff)) ? 1 : 2,
    };
  });

  // Running first, then most recently used; never-used entries keep registry
  // order at the back.
  projects.sort((a, b) =>
    ((b.live || b.children.length ? 1 : 0) - (a.live || a.children.length ? 1 : 0)) ||
    ((b.lastSeen || 0) - (a.lastSeen || 0)));
  return projects;
}

const STYLE = String.raw`
  :root {
    --bg: #f7f6f3; --panel: #fff; --ink: #1a1a1a; --muted: #6b6b6b; --faint: #9b9b9b;
    --line: #e2e0da; --accent: #3b5bdb; --up: #2f9e44; --down: #c92a2a;
    --unknown: #adb5bd; --busy: #f08c00; --hover: #00000008;
    --warn-bg: #fff4e6; --warn-ink: #b35309; --warn-line: #ffd8a8;
    --btn: #f1efea; --btn-ink: #444;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #17181a; --panel: #1c1e21; --ink: #ececec; --muted: #9a9a9a; --faint: #6f7478;
      --line: #2a2d31; --accent: #7d97f4; --up: #51cf66; --down: #ff6b6b;
      --unknown: #4a4f55; --busy: #ffa94d; --hover: #ffffff08;
      --warn-bg: #2c2113; --warn-ink: #ffc078; --warn-line: #4a3a1e;
      --btn: #2b2e32; --btn-ink: #ddd;
    }
  }
  :root[data-theme="dark"] {
    --bg: #17181a; --panel: #1c1e21; --ink: #ececec; --muted: #9a9a9a; --faint: #6f7478;
    --line: #2a2d31; --accent: #7d97f4; --up: #51cf66; --down: #ff6b6b;
    --unknown: #4a4f55; --busy: #ffa94d; --hover: #ffffff08;
    --warn-bg: #2c2113; --warn-ink: #ffc078; --warn-line: #4a3a1e;
    --btn: #2b2e32; --btn-ink: #ddd;
  }
  * { box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--ink); margin: 0;
    font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 1.5rem 1.25rem 4rem;
  }
  .wrap { max-width: 1250px; margin: 0 auto; }
  header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.6rem 1rem; }
  h1 { font-size: 1.25rem; margin: 0; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 0.8rem; }
  #q {
    width: 100%; margin: 0.85rem 0 1.25rem; padding: 0.5rem 0.75rem;
    background: var(--panel); color: var(--ink);
    border: 1px solid var(--line); border-radius: 7px; font: inherit;
  }
  #q:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  h2 {
    font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.09em;
    color: var(--faint); margin: 1.5rem 0 0.4rem; font-weight: 600;
  }

  /* One thin row per thing. A shared grid template across every row is what
     makes the columns line up like a table without being one. */
  .rows { border-top: 1px solid var(--line); }
  .row {
    display: grid; align-items: center; gap: 0.75rem;
    grid-template-columns: minmax(140px, 1.1fr) minmax(0, 1.5fr) 62px minmax(0, 1.2fr) auto;
    padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--line);
    min-height: 32px;
  }
  .row:hover { background: var(--hover); }
  .row.hidden { display: none; }
  .row.child { color: var(--muted); }
  .row.child .namecell { padding-left: 1.1rem; }
  .row.child .namecell::before {
    content: '└'; position: absolute; margin-left: -0.85rem; color: var(--line);
  }

  .namecell { display: flex; align-items: center; gap: 0.45rem; min-width: 0; position: relative; }
  .dot {
    width: 7px; height: 7px; border-radius: 50%; background: var(--unknown);
    flex: none; transition: background 0.2s;
  }
  .dot.up { background: var(--up); box-shadow: 0 0 0 2.5px color-mix(in srgb, var(--up) 22%, transparent); }
  .dot.down { background: var(--unknown); }
  .dot.busy { background: var(--busy); animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.3; } }
  a.name {
    color: var(--ink); font-weight: 600; text-decoration: none;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row.child a.name { font-weight: 500; font-size: 0.86rem; }
  a.name:hover { color: var(--accent); text-decoration: underline; }

  .what, .cmd {
    color: var(--muted); font-size: 0.83rem;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cmd { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 0.76rem; color: var(--faint); }
  .port {
    font: 0.78rem ui-monospace, Consolas, monospace; color: var(--accent);
    text-align: right; white-space: nowrap;
  }
  .right { display: flex; align-items: center; gap: 0.4rem; justify-content: flex-end; white-space: nowrap; }
  .seen { color: var(--faint); font-size: 0.72rem; min-width: 74px; text-align: right; }
  .badge {
    font-size: 0.68rem; padding: 0.05rem 0.35rem; border-radius: 4px;
    border: 1px solid var(--line); color: var(--faint);
  }
  .badge.warn { background: var(--warn-bg); color: var(--warn-ink); border-color: var(--warn-line); }

  button {
    font: inherit; font-size: 0.72rem; padding: 0.1rem 0.45rem;
    background: var(--btn); color: var(--btn-ink);
    border: 1px solid var(--line); border-radius: 5px; cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  button:disabled { opacity: 0.3; cursor: default; }
  .actions { display: flex; gap: 0.25rem; opacity: 0; transition: opacity 0.12s; }
  .row:hover .actions, .row:focus-within .actions { opacity: 1; }

  pre.log {
    display: none; grid-column: 1 / -1; margin: 0.25rem 0 0.4rem; padding: 0.5rem 0.6rem;
    max-height: 200px; overflow: auto; background: color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: 6px; font: 0.72rem/1.45 ui-monospace, Consolas, monospace;
    color: var(--muted); white-space: pre-wrap; word-break: break-word;
  }
  pre.log.open { display: block; }

  details#rest { margin-top: 1.5rem; }
  details#rest > summary {
    cursor: pointer; list-style: none; padding: 0.4rem 0;
    font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.09em;
    color: var(--faint); font-weight: 600; user-select: none;
  }
  details#rest > summary::-webkit-details-marker { display: none; }
  details#rest > summary::before { content: '▸ '; display: inline-block; transition: transform 0.15s; }
  details#rest[open] > summary::before { transform: rotate(90deg); }
  details#rest > summary:hover { color: var(--accent); }

  footer { color: var(--faint); font-size: 0.75rem; margin-top: 2.5rem; border-top: 1px solid var(--line); padding-top: 0.85rem; }
  footer code { font-size: 0.72rem; }
  #probe-msg { color: var(--muted); font-size: 0.8rem; }

  @media (max-width: 860px) {
    .row { grid-template-columns: minmax(120px, 1fr) 58px auto; }
    .what, .cmd { display: none; }
  }
`;

const CLIENT = String.raw`
const GROUPS = [
  ['web', 'Servers'],
  ['static', 'Static — just open them'],
  ['service', 'Background services'],
];
const out = document.getElementById('out');

// Declared before the render pass: row() calls ago(), and a const referenced
// before its initialiser is a TDZ error, not a hoisted undefined.
const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS = [['year', 31536e6], ['month', 2592e6], ['week', 6048e5], ['day', 864e5], ['hour', 36e5], ['minute', 6e4]];
function ago(ts) {
  if (!ts) return '';
  const diff = ts - Date.now();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return RTF.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function heading(text, count) {
  return el('h2', null, count == null ? text : text + ' (' + count + ')');
}

function rowsOf(items) {
  const box = el('div', 'rows');
  for (const p of items) {
    box.appendChild(row(p));
    for (const c of p.children || []) box.appendChild(row(c, true));
  }
  return box;
}

function row(p, isChild) {
  const r = el('div', 'row' + (isChild ? ' child' : ''));
  r.dataset.name = p.name;
  r.dataset.search = [p.name, p.what, p.dir, p.port, p.note, p.branch, p.cmd]
    .filter(Boolean).join(' ').toLowerCase();

  // name + liveness
  const cell = el('div', 'namecell');
  if (p.port) {
    const dot = el('span', 'dot');
    dot.dataset.port = p.port;
    // The port is up but somebody else's process is behind it, so a green dot
    // here would be a lie.
    if (p.occupiedBy) dot.dataset.taken = p.occupiedBy;
    dot.title = 'checking…';
    cell.appendChild(dot);
  }
  const a = el('a', 'name', p.name);
  a.href = p.url || p.fileUrl || ('http://localhost:' + p.port + '/');
  a.target = '_blank';
  a.rel = 'noopener';
  a.title = p.path || p.dir || '';
  // Opening it counts as using it — and a click names the project, the only way
  // to attribute usage when several share a port.
  a.addEventListener('click', () => touch(isChild ? p.parent : p.name));
  cell.appendChild(a);
  r.appendChild(cell);

  // description
  const what = el('div', 'what', p.what || (isChild ? describeChild(p) : ''));
  if (p.note) what.title = p.note;
  r.appendChild(what);

  // port
  r.appendChild(el('div', 'port', p.port ? ':' + p.port : ''));

  // start command / discovered command
  r.appendChild(el('div', 'cmd', p.start || (p.cmd ? shorten(p.cmd) : '')));

  // badges, last-seen, actions
  const right = el('div', 'right');
  if (p.autostart) {
    const b = el('span', 'badge', '⏻ logon');
    b.title = 'Started automatically when the daemon boots';
    right.appendChild(b);
  }
  if (p.clash) {
    const b = el('span', 'badge warn', '⚠ ' + (p.clash.length + 1) + ' share :' + p.port);
    b.title = 'Also claimed by: ' + p.clash.join(', ');
    right.appendChild(b);
  }
  if (p.occupiedBy) {
    const b = el('span', 'badge warn', '⚠ port taken by ' + p.occupiedBy);
    b.title = ':' + p.port + ' is listening, but the process behind it belongs to ' +
              p.occupiedBy + ' — this project is not what is running.';
    right.appendChild(b);
  }
  if (isChild) {
    const b = el('span', 'badge', p.kind === 'worktree' ? 'worktree' : 'found');
    b.title = p.path || p.cmd || '';
    right.appendChild(b);
  }

  const seen = el('span', 'seen', isChild ? 'running' : ago(p.lastSeen));
  seen.dataset.seenFor = p.name;
  if (p.lastSeen) seen.title = new Date(p.lastSeen).toLocaleString();
  right.appendChild(seen);

  if (INTERACTIVE && !isChild && p.start && p.port) {
    const actions = el('span', 'actions');
    const mk = (label, fn) => { const b = el('button', null, label); b.onclick = fn; return b; };
    const start = mk('Start', () => act('start', p.name, start));
    const stop = mk('Stop', () => act('stop', p.name, stop));
    const log = mk('Log', () => toggleLog(p.name, log));
    actions.append(start, stop, log);
    right.appendChild(actions);
  }
  r.appendChild(right);

  const pre = el('pre', 'log');
  r.appendChild(pre);
  return r;
}

function describeChild(p) {
  if (p.kind === 'worktree') return 'worktree · ' + (p.branch || 'detached');
  return p.proc ? 'discovered · ' + p.proc : 'discovered';
}

function shorten(cmd) {
  // Command lines are mostly absolute paths; the tail is the informative part.
  const s = String(cmd).replace(/"/g, '');
  return s.length > 64 ? '…' + s.slice(-63) : s;
}

// --- sections ---------------------------------------------------------------

const recent = PROJECTS.filter((p) => p.tier === 1);
if (recent.length) out.append(heading('Running / recent', recent.length), rowsOf(recent));

if (ORPHANS.length) {
  out.append(heading('Unregistered — running but not in the registry', ORPHANS.length));
  out.appendChild(rowsOf(ORPHANS.map((o) => ({
    ...o, name: o.label || (':' + o.port), what: describeChild(o), kind: 'orphan',
  }))));
}

const tail = PROJECTS.filter((p) => p.tier !== 1);
if (tail.length) {
  const det = el('details');
  det.id = 'rest';
  det.open = !recent.length;
  det.appendChild(el('summary', null, 'Everything else (' + tail.length + ')'));
  for (const [kind, label] of GROUPS) {
    const items = tail.filter((p) => p.kind === kind);
    if (!items.length) continue;
    det.append(heading(label, items.length), rowsOf(items));
  }
  out.appendChild(det);
  det.addEventListener('toggle', () => localStorage.setItem('hub.rest', det.open ? '1' : '0'));
  const saved = localStorage.getItem('hub.rest');
  if (saved !== null) det.open = saved === '1';
}

// --- actions ----------------------------------------------------------------

function rowEl(name) { return document.querySelector('.row[data-name="' + CSS.escape(name) + '"]'); }

// sendBeacon survives the navigation the click is about to cause.
function touch(name) {
  const span = document.querySelector('[data-seen-for="' + CSS.escape(name) + '"]');
  if (span) { span.textContent = 'just now'; span.title = new Date().toLocaleString(); }
  if (!INTERACTIVE) return;
  navigator.sendBeacon('/api/touch', new Blob([JSON.stringify({ name })], { type: 'application/json' }));
}

async function act(what, name, btn) {
  btn.disabled = true;
  const dot = rowEl(name).querySelector('.dot');
  if (dot) dot.className = 'dot busy';
  try {
    const r = await fetch('/api/' + what, {
      method: 'POST', headers: { 'content-type': 'application/json' },
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
  const pre = rowEl(name).querySelector('.log');
  pre.textContent = text;
  pre.classList.add('open');
}

const openLogs = new Set();
async function toggleLog(name, btn) {
  const pre = rowEl(name).querySelector('.log');
  if (openLogs.has(name)) {
    openLogs.delete(name); pre.classList.remove('open'); btn.textContent = 'Log';
  } else {
    openLogs.add(name); btn.textContent = 'Hide'; await pumpLogs();
  }
}

async function pumpLogs() {
  for (const name of openLogs) {
    try {
      const r = await fetch('/api/logs?name=' + encodeURIComponent(name));
      const { lines } = await r.json();
      const pre = rowEl(name).querySelector('.log');
      const stuck = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 12;
      pre.textContent = lines.length ? lines.join('') : '(no output yet)';
      pre.classList.add('open');
      if (stuck) pre.scrollTop = pre.scrollHeight;
    } catch {}
  }
}

// --- filter -----------------------------------------------------------------

const q = document.getElementById('q');
const restEl = document.getElementById('rest');
let restWasOpen = null;
q.addEventListener('input', () => {
  const term = q.value.trim().toLowerCase();
  for (const r of document.querySelectorAll('.row')) {
    r.classList.toggle('hidden', !!term && !r.dataset.search.includes(term));
  }
  for (const h of document.querySelectorAll('h2')) {
    const box = h.nextElementSibling;
    if (!box || !box.classList.contains('rows')) continue;
    const any = [...box.children].some((r) => !r.classList.contains('hidden'));
    h.style.display = box.style.display = any ? '' : 'none';
  }
  // A search should reach into the folded tier, then leave it as it was.
  if (restEl) {
    if (term && restWasOpen === null) restWasOpen = restEl.open;
    if (term) restEl.open = true;
    else if (restWasOpen !== null) { restEl.open = restWasOpen; restWasOpen = null; }
    const hits = [...restEl.querySelectorAll('.row')].filter((r) => !r.classList.contains('hidden')).length;
    restEl.style.display = term && !hits ? 'none' : '';
    restEl.querySelector('summary').textContent =
      term ? 'Everything else — ' + hits + ' match' + (hits === 1 ? '' : 'es')
           : 'Everything else (' + restEl.querySelectorAll('.row').length + ')';
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); q.select(); }
});

// --- liveness ---------------------------------------------------------------

// With the daemon we get real TCP connect results. Without it we fall back to a
// no-cors fetch, where resolve-vs-reject is the only signal available.
async function probeStatic(port) {
  try {
    await fetch('http://localhost:' + port + '/', {
      mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(2000),
    });
    return true;
  } catch { return false; }
}

async function getStatus() {
  if (INTERACTIVE) {
    const r = await fetch('/api/state', { cache: 'no-store' });
    return r.json();
  }
  const ports = [...new Set([...document.querySelectorAll('.dot')].map((d) => d.dataset.port))];
  const pairs = await Promise.all(ports.map(async (p) => [p, { listening: await probeStatic(p) }]));
  return { status: Object.fromEntries(pairs), lastSeen: {} };
}

async function refresh() {
  let status, lastSeen;
  try { ({ status, lastSeen } = await getStatus()); }
  catch {
    document.getElementById('probe-msg').textContent = 'daemon unreachable';
    for (const d of document.querySelectorAll('.dot')) { d.className = 'dot'; d.title = 'unknown'; }
    return;
  }
  const dots = [...document.querySelectorAll('.dot')];
  for (const d of dots) {
    const s = status[d.dataset.port] || {};
    const taken = d.dataset.taken;
    if (taken) {
      d.className = 'dot down';
      d.title = 'not running — :' + d.dataset.port + ' is held by ' + taken;
      continue;
    }
    d.className = 'dot ' + (s.listening ? 'up' : 'down');
    d.title = s.listening
      ? (s.managed ? 'running — started by the hub (pid ' + s.pid + ')' : 'listening — started elsewhere')
      : 'not running';
  }
  for (const [name, ts] of Object.entries(lastSeen || {})) {
    const span = document.querySelector('[data-seen-for="' + CSS.escape(name) + '"]');
    if (span && span.textContent !== 'running') { span.textContent = ago(ts); span.title = new Date(ts).toLocaleString(); }
  }
  const live = Object.values(status).filter((s) => s.listening).length;
  const total = new Set(dots.map((d) => d.dataset.port)).size;
  document.getElementById('probe-msg').textContent = live + ' of ' + total + ' live';
  await pumpLogs();
}
refresh();
setInterval(refresh, INTERACTIVE ? 3000 : 10000);
`;

// The client script is a string, so nothing type-checks it and a syntax error
// ships as a blank page with a dead "checking…" header. Parse it once at import
// (new Function compiles without running, so undefined globals are fine) and
// fail loudly here instead. Runtime faults need check-hub.mjs, which renders it.
try {
  new Function(CLIENT);
} catch (e) {
  throw new Error(`hub client script does not parse: ${e.message}`);
}

export function page({ projects, interactive, footer, orphans = [] }) {
  const things = projects.length
    + projects.reduce((n, p) => n + (p.children?.length || 0), 0)
    + orphans.length;
  return `<title>Experiments Hub</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${STYLE}</style>

<div class="wrap">
  <header>
    <h1>Experiments</h1>
    <span class="sub">${things} things · <span id="probe-msg">checking…</span></span>
  </header>

  <input id="q" type="search" placeholder="Filter by name, port, or description…  (press / to focus)" autofocus>

  <div id="out"></div>

  <footer>${footer}</footer>
</div>

<script>
const PROJECTS = ${JSON.stringify(projects, null, 2)};
const ORPHANS = ${JSON.stringify(orphans, null, 2)};
const INTERACTIVE = ${interactive ? 'true' : 'false'};
${CLIENT}
</script>
`;
}
