#!/usr/bin/env python3
"""Send a message from the spawning session to a forked Claude's inbox.

The fork's Stop hook (fork-inbox-wait.sh) parks on this inbox file and delivers
whatever is written here as the fork's next instruction.

Usage:
    python fork_send.py --by-name "Fork Title" "do X next"
    echo "do X next" | python fork_send.py --by-name "Fork Title" --stdin
    python fork_send.py --by-name "Fork Title" --detach   # stop the fork parking
    python fork_send.py --by-name "Fork Title" --status    # heartbeat ping

Control verbs (--detach / --status) map to the ::detach / ::status messages the
wait script understands.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
from pathlib import Path


if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


def native_path(path: str) -> str:
    """Convert an MSYS/Git-Bash path (/e/foo, /c/Users) to a native form Python
    can open on Windows. Leaves already-native or POSIX paths untouched."""
    if os.name == "nt" and len(path) >= 3 and path[0] == "/" and path[2] == "/" and path[1].isalpha():
        return f"{path[1].upper()}:/{path[3:]}"
    return path


def resolve_project_dir(explicit: str | None) -> Path:
    if explicit:
        return Path(os.path.expanduser(explicit))
    # Mirror fork-claude.sh: git toplevel, else cwd.
    try:
        import subprocess

        top = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=False,
        ).stdout.strip()
        if top:
            return Path(top)
    except Exception:
        pass
    return Path.cwd()


def find_fork_meta(name: str, forks_dir: Path) -> dict | None:
    """Find the most recently launched fork metadata whose title matches name."""
    if not forks_dir.is_dir():
        return None

    name_lower = name.lower()
    exact: list[tuple[str, dict, Path]] = []
    partial: list[tuple[str, dict, Path]] = []

    for meta_path in forks_dir.glob("*.json"):
        try:
            with meta_path.open("r", encoding="utf-8", errors="replace") as f:
                meta = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(meta, dict):
            continue
        title = str(meta.get("title", ""))
        launched = str(meta.get("launched_at", ""))
        if title.lower() == name_lower:
            exact.append((launched, meta, meta_path))
        elif name_lower in title.lower():
            partial.append((launched, meta, meta_path))

    pool = exact or partial
    if not pool:
        return None
    # Most recent launch wins (launched_at is ISO8601, lexically sortable).
    launched, meta, meta_path = max(pool, key=lambda t: t[0])
    meta["_meta_path"] = str(meta_path)
    return meta


def inbox_for(meta: dict) -> Path:
    inbox = meta.get("inbox_file")
    if inbox:
        return Path(native_path(inbox))
    # Fallback for forks launched before inbox_file was recorded.
    meta_path = Path(meta["_meta_path"])
    return meta_path.with_suffix(".inbox")


def main() -> None:
    parser = argparse.ArgumentParser(description="Send a message to a forked Claude's inbox")
    parser.add_argument("name", nargs="?", help="Fork title (or use --by-name)")
    parser.add_argument("message", nargs="*", help="Message text (joined with spaces)")
    parser.add_argument("--by-name", metavar="NAME", help="Fork title to send to")
    parser.add_argument("--project-dir", help="Project dir holding tmp/forks (default: git root / cwd)")
    parser.add_argument("--stdin", action="store_true", help="Read the message from stdin")
    parser.add_argument("--detach", action="store_true", help="Tell the fork to stop parking (::detach)")
    parser.add_argument("--status", action="store_true", help="Send a heartbeat ping (::status)")
    args = parser.parse_args()

    # When --by-name is given, every positional is part of the message;
    # otherwise the first positional is the fork name.
    if args.by_name:
        name = args.by_name
        message_parts = ([args.name] if args.name else []) + args.message
    else:
        name = args.name
        message_parts = args.message
    if not name:
        parser.error("a fork name is required (positional or --by-name)")

    if args.detach:
        message = "::detach"
    elif args.status:
        message = "::status"
    elif args.stdin:
        message = sys.stdin.read().rstrip("\n")
    else:
        message = " ".join(message_parts).rstrip("\n")

    if not message.strip():
        parser.error("empty message (provide text, --stdin, --detach, or --status)")

    project_dir = resolve_project_dir(args.project_dir)
    forks_dir = project_dir / "tmp" / "forks"

    meta = find_fork_meta(name, forks_dir)
    if meta is None:
        print(f"Error: no fork found with title '{name}' under {forks_dir}", file=sys.stderr)
        sys.exit(1)

    provider = str(meta.get("provider", ""))
    if provider not in ("claude", "claude-glm"):
        print(
            f"Error: fork '{meta.get('title')}' uses provider '{provider}', which has no mailbox "
            f"(only claude/claude-glm forks listen for messages).",
            file=sys.stderr,
        )
        sys.exit(1)

    inbox = inbox_for(meta)
    inbox.parent.mkdir(parents=True, exist_ok=True)

    # A fresh ::detach should re-arm parking, so clear any detach marker first.
    detach_marker = Path(str(inbox) + ".detached")
    if message != "::detach" and detach_marker.exists():
        try:
            detach_marker.unlink()
        except OSError:
            pass

    with inbox.open("a", encoding="utf-8", newline="\n") as f:
        f.write(message + "\n")

    label = {"::detach": "detach signal", "::status": "heartbeat ping"}.get(message, "message")
    print(f"Sent {label} to fork '{meta.get('title')}' -> {inbox}")


if __name__ == "__main__":
    main()
