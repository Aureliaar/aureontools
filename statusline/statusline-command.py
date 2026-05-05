#!/usr/bin/env python3
"""Claude Code status line: context summary + session cost + real usage windows"""
import sys, json, os, time, urllib.request
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding="utf-8")

try:
    d = json.loads(sys.stdin.read())
except Exception as e:
    print(f"[statusline parse error: {e}]")
    sys.exit(0)

try:
    cw    = d.get("context_window", {})
    cu    = cw.get("current_usage", {})
    sid   = d.get("session_id", "unknown")
    model_raw = d.get("model", "")
    if isinstance(model_raw, dict):
        model = model_raw.get("id", "") or model_raw.get("name", "") or ""
    else:
        model = model_raw or ""

    pct  = cw.get("used_percentage", 0)
    size = cw.get("context_window_size", 0)
    last_call = (
        cu.get("cache_read_input_tokens", 0)
        + cu.get("cache_creation_input_tokens", 0)
        + cu.get("input_tokens", 0)
        + cu.get("output_tokens", 0)
    )
    cost_obj = d.get("cost") or {}
    cost = cost_obj.get("total_cost_usd", 0.0) if isinstance(cost_obj, dict) else 0.0

    # sys-prompt baseline
    base_dir  = os.path.expanduser("~/.claude/statusline-baselines")
    os.makedirs(base_dir, exist_ok=True)
    base_file = os.path.join(base_dir, sid)
    if os.path.exists(base_file):
        with open(base_file) as f:
            try:    sys_est = int(f.read().strip())
            except: sys_est = last_call
    else:
        sys_est = last_call
        with open(base_file, "w") as f:
            f.write(str(sys_est))

    # usage windows
    def get_usage():
        """Return (pct_5h, resets_5h, pct_7d, resets_7d) or Nones. Cached 5 min."""
        cache_file = os.path.expanduser("~/.claude/statusline-usage-cache.json")
        now = time.time()
        if os.path.exists(cache_file):
            try:
                with open(cache_file) as f:
                    c = json.load(f)
                if now - c.get("ts", 0) < 300:
                    return c["5h"], c["5h_resets"], c["7d"], c["7d_resets"]
            except Exception:
                pass
        try:
            with open(os.path.expanduser("~/.claude/.credentials.json")) as f:
                token = json.load(f)["claudeAiOauth"]["accessToken"]
            req = urllib.request.Request(
                "https://api.anthropic.com/api/oauth/usage",
                headers={"Authorization": f"Bearer {token}",
                         "anthropic-beta": "oauth-2025-04-20"},
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
            r5  = data["five_hour"]
            r7  = data["seven_day"]
            entry = {"ts": now,
                     "5h": r5["utilization"], "5h_resets": r5["resets_at"],
                     "7d": r7["utilization"], "7d_resets": r7["resets_at"]}
            with open(cache_file, "w") as f:
                json.dump(entry, f)
            return entry["5h"], entry["5h_resets"], entry["7d"], entry["7d_resets"]
        except Exception:
            return None, None, None, None


    def time_left(resets_at_iso):
        resets = datetime.fromisoformat(resets_at_iso)
        if resets.tzinfo is None:
            resets = resets.replace(tzinfo=timezone.utc)
        secs = int((resets - datetime.now(timezone.utc)).total_seconds())
        if secs <= 0:
            return "now"
        d2, rem = divmod(secs, 86400)
        h, rem  = divmod(rem, 3600)
        m       = rem // 60
        return f"{d2}d{h}h" if d2 else f"{h}h{m}m"


    def secs_left(resets_at_iso):
        resets = datetime.fromisoformat(resets_at_iso)
        if resets.tzinfo is None:
            resets = resets.replace(tzinfo=timezone.utc)
        return max(0.0, (resets - datetime.now(timezone.utc)).total_seconds())


    def window_color(utilization, resets_at_iso, threshold_per_unit, unit_secs):
        remaining  = 100.0 - utilization
        units_left = secs_left(resets_at_iso) / unit_secs
        if units_left <= 0:
            return ""
        return YLW if remaining < threshold_per_unit * units_left else ""


    # helpers
    def fmt(n):
        if n >= 1_000_000: return f"{n/1_000_000:.1f}M"
        if n >= 1_000:     return f"{n/1_000:.1f}k"
        return str(n)

    RST = "\033[0m"
    YLW = "\033[0;33m"
    RED = "\033[0;31m"
    GRN = "\033[0;32m"

    if   pct >= 80: ctx_color = RED
    elif pct >= 50: ctx_color = YLW
    else:           ctx_color = GRN

    # peak time
    def is_peak():
        now = datetime.now(timezone.utc)
        return now.weekday() < 5 and 12 <= now.hour < 18

    # model label
    model_label = model[len("claude-"):] if model.startswith("claude-") else model

    # assemble line
    pct_5h, resets_5h, pct_7d, resets_7d = get_usage()

    right_parts = [f"${cost:.2f}"]
    if pct_5h is not None:
        c5 = window_color(pct_5h, resets_5h, 20, 3600)    # 20 %/h budget
        c7 = window_color(pct_7d, resets_7d, 13, 86400)   # 13 %/d budget
        right_parts.append(f"{c5}5h {pct_5h:.0f}%{RST} {time_left(resets_5h)}")
        right_parts.append(f"{c7}7d {pct_7d:.0f}%{RST} {time_left(resets_7d)}")

    separator = f" {RED}PEAK TIME{RST} " if is_peak() else "\t\t\t"
    model_prefix = f"{model_label} · " if model_label else ""
    print(
        f"{model_prefix}{ctx_color}{pct}%{RST}/{fmt(size)}"
        f" · last {fmt(last_call)}"
        f"{separator}"
        f"{' · '.join(right_parts)}"
    )

except Exception as e:
    print(f"[statusline error: {e}]")
