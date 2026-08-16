// Finding things the registry doesn't know about.
//
// Two blind spots motivated this: a vite server running inside a git worktree of
// a registered project (its own port, no registry entry), and the fact that a
// worktree is a real place work happens but looks like nothing from outside.

import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, basename, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const norm = (p) => (p || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');

// ---------------------------------------------------------------- listeners

/**
 * Every listening TCP port with its owning pid. netstat is parsed rather than
 * shelling to PowerShell because this runs on every poll.
 */
export async function listeners() {
  let out = '';
  try {
    // No -p filter: `-p tcp` covers IPv4 only, so an IPv6-bound dev server
    // (vite's default in places) is invisible to it.
    ({ stdout: out } = await run('netstat', ['-ano'], { maxBuffer: 8e6 }));
  } catch { return []; }

  const seen = new Map();
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
    if (!m) continue;
    const [, addr, port, pid] = m;
    // Loopback and any-address only; a LAN-bound service isn't ours to list.
    if (!/^(127\.|0\.0\.0\.0|\[::\]|\[::1\]|::1|::)/.test(addr)) continue;
    const p = Number(port);
    if (!seen.has(p)) seen.set(p, { port: p, pid: Number(pid), addr });
  }
  return [...seen.values()];
}

/** Command lines for a set of pids, in one PowerShell round trip. */
export async function commandLines(pids) {
  if (!pids.length) return {};
  const filter = pids.map((p) => `ProcessId=${p}`).join(' or ');
  const script =
    `Get-CimInstance Win32_Process -Filter "${filter}" | ` +
    `Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress -Depth 2`;
  try {
    const { stdout } = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { maxBuffer: 8e6 });
    const parsed = JSON.parse(stdout || 'null');
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return Object.fromEntries(rows.map((r) => [r.ProcessId, { name: r.Name, cmd: r.CommandLine || '' }]));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------- worktrees

const wtCache = new Map(); // dir -> { at, list }
const WT_TTL = 60e3;

/**
 * Worktrees of a project, excluding the main checkout. Cached: worktrees change
 * rarely and this would otherwise be one git process per project per page load.
 */
export function worktrees(dir) {
  if (!existsSync(resolve(dir, '.git'))) return [];
  const hit = wtCache.get(dir);
  if (hit && Date.now() - hit.at < WT_TTL) return hit.list;

  let list = [];
  try {
    const out = execFileSync('git', ['-C', dir, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    let cur = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) {
        cur = { path: line.slice(9).trim(), branch: null, detached: false };
        list.push(cur);
      } else if (line.startsWith('branch ') && cur) {
        cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
      } else if (line.startsWith('detached') && cur) {
        cur.detached = true;
      }
    }
    // The first entry is the main checkout, which is the project itself.
    list = list.filter((w) => norm(w.path) !== norm(dir));
  } catch {
    list = [];
  }

  wtCache.set(dir, { at: Date.now(), list });
  return list;
}

// ---------------------------------------------------------------- attribution

// Loopback is crowded — Steam, Discord, plasticd, half a dozen svchosts. An
// unattributed listener is only worth showing if it plausibly belongs to you:
// a development runtime, or anything running out of the projects root.
const DEV_PROC = /^(node|python\d*|pythonw|deno|bun|ruby|php|dotnet|java|go|cargo|rustc|uvicorn|gunicorn|flask)(\.exe)?$/i;

function looksLikeDev(entry, root) {
  if (entry.cmd && norm(entry.cmd).includes(norm(root))) return true;
  return DEV_PROC.test(entry.proc || '');
}

/**
 * Tie live ports to places on disk.
 *
 * Returns { children, orphans }:
 *   children — discovered servers that belong to a registered project, keyed by
 *              project name (a worktree of it, or its directory but an
 *              unregistered port)
 *   orphans  — listeners we can place on disk but not under any project, plus
 *              anything unidentifiable
 */
export async function attribute(projects, root) {
  const live = await listeners();
  // Registry ports are resolved too, not just unknown ones: a port can be
  // claimed by one project and actually served by another, and saying "X is
  // running" when it isn't is worse than saying nothing.
  const claimed = new Map();
  for (const p of projects) {
    if (!p.port) continue;
    if (!claimed.has(p.port)) claimed.set(p.port, []);
    claimed.get(p.port).push(p.name);
  }
  if (!live.length) return { children: {}, orphans: [], occupancy: {} };

  const cmds = await commandLines([...new Set(live.map((l) => l.pid))]);

  // Longest path first, so a worktree inside a project wins over the project.
  const places = [];
  for (const p of projects) {
    const dir = resolve(root, p.dir);
    for (const w of worktrees(dir)) {
      places.push({ project: p.name, path: w.path, label: basename(w.path), branch: w.branch, kind: 'worktree' });
    }
    places.push({ project: p.name, path: dir, label: p.name, branch: null, kind: 'project' });
  }
  places.sort((a, b) => norm(b.path).length - norm(a.path).length);

  const children = {};
  const orphans = [];
  const occupancy = {};

  for (const l of live) {
    const info = cmds[l.pid] || {};
    const hay = norm(info.cmd);
    const place = hay ? places.find((pl) => hay.includes(norm(pl.path))) : null;

    const entry = {
      port: l.port,
      pid: l.pid,
      addr: l.addr,
      proc: info.name || null,
      cmd: info.cmd || null,
      path: place?.path || null,
      branch: place?.branch || null,
      label: place ? (place.kind === 'worktree' ? place.label : `:${l.port}`) : `:${l.port}`,
      kind: place?.kind ?? 'unknown',
    };

    const claimants = claimed.get(l.port);
    if (claimants) {
      // A registered port. Record who is really behind it so the hub can avoid
      // crediting the wrong project.
      occupancy[l.port] = {
        actual: place?.project ?? null,
        kind: place?.kind ?? 'unknown',
        path: place?.path ?? null,
        proc: info.name ?? null,
        // Only a confident mismatch counts: we placed it on disk, and the place
        // belongs to a project that doesn't claim this port.
        mismatch: !!place && !claimants.includes(place.project),
      };
      continue;
    }

    if (place) (children[place.project] ||= []).push(entry);
    else if (looksLikeDev(entry, root)) orphans.push(entry);
  }
  for (const list of Object.values(children)) list.sort((a, b) => a.port - b.port);
  orphans.sort((a, b) => a.port - b.port);
  return { children, orphans, occupancy };
}
