#!/usr/bin/env python3
"""Extract the last assistant text response from a forked session log.

Usage:
    python scripts/fork_last_response.py <session-id-or-path> [--max-chars N]
    python scripts/fork_last_response.py --by-name "Fork Title" [--project-dir DIR] [--max-chars N]
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
from pathlib import Path
from typing import Iterable


if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


HOME = Path.home()
CLAUDE_PROJECTS_DIR = HOME / ".claude" / "projects"
CODEX_SESSIONS_DIR = HOME / ".codex" / "sessions"


def normalize_path(path: str | None) -> str | None:
    if not path:
        return None
    return os.path.normcase(os.path.normpath(os.path.abspath(os.path.expanduser(path))))


def read_head(path: Path, max_bytes: int = 128 * 1024) -> str:
    with path.open("rb") as f:
        data = f.read(max_bytes)
    return data.decode("utf-8", errors="replace")


def read_tail(path: Path, chunk_size: int = 128 * 1024) -> list[str]:
    file_size = path.stat().st_size
    read_size = min(chunk_size, file_size)
    with path.open("r", encoding="utf-8", errors="replace") as f:
        if file_size > read_size:
            f.seek(file_size - read_size)
            f.readline()
        return f.readlines()


def iter_claude_logs() -> Iterable[Path]:
    if not CLAUDE_PROJECTS_DIR.is_dir():
        return []
    return sorted(CLAUDE_PROJECTS_DIR.rglob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)


def iter_codex_logs() -> Iterable[Path]:
    if not CODEX_SESSIONS_DIR.is_dir():
        return []
    return sorted(CODEX_SESSIONS_DIR.rglob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)


def get_jsonl_first_object(path: Path) -> dict | None:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            line = f.readline().strip()
        return json.loads(line) if line else None
    except (OSError, json.JSONDecodeError):
        return None


def match_project_dir(candidate: str | None, project_dir: str | None) -> bool:
    if project_dir is None:
        return True
    return normalize_path(candidate) == project_dir


def find_claude_by_name(name: str, project_dir: str | None) -> Path | None:
    name_lower = name.lower()
    for path in iter_claude_logs():
        first = get_jsonl_first_object(path)
        if isinstance(first, dict):
            title = str(first.get("customTitle", ""))
            cwd = first.get("cwd")
            if title.lower() == name_lower and match_project_dir(cwd, project_dir):
                return path

        head = read_head(path)
        if name_lower in head.lower():
            if project_dir is None or project_dir in head.lower():
                return path
    return None


def find_codex_by_name(name: str, project_dir: str | None) -> Path | None:
    name_lower = name.lower()
    for path in iter_codex_logs():
        first = get_jsonl_first_object(path)
        if isinstance(first, dict):
            payload = first.get("payload", {})
            cwd = payload.get("cwd") if isinstance(payload, dict) else None
            if not match_project_dir(cwd, project_dir):
                continue

        head = read_head(path)
        if name_lower in head.lower():
            return path
    return None


def find_by_name(name: str, project_dir: str | None) -> Path | None:
    normalized_project = normalize_path(project_dir)
    return find_claude_by_name(name, normalized_project) or find_codex_by_name(name, normalized_project)


def resolve_path(session_id_or_path: str) -> Path:
    expanded = Path(os.path.expanduser(session_id_or_path))
    if expanded.is_file():
        return expanded

    claude_matches = list(CLAUDE_PROJECTS_DIR.rglob(f"{session_id_or_path}.jsonl")) if CLAUDE_PROJECTS_DIR.is_dir() else []
    if claude_matches:
        return max(claude_matches, key=lambda p: p.stat().st_mtime)

    codex_matches = list(CODEX_SESSIONS_DIR.rglob(f"*{session_id_or_path}*.jsonl")) if CODEX_SESSIONS_DIR.is_dir() else []
    if codex_matches:
        return max(codex_matches, key=lambda p: p.stat().st_mtime)

    print(f"Error: Could not find conversation log for '{session_id_or_path}'", file=sys.stderr)
    sys.exit(1)


def extract_claude_text(obj: dict) -> tuple[str, bool] | None:
    if obj.get("type") != "assistant":
        return None

    message = obj.get("message", {})
    content = message.get("content", [])
    text_blocks = []
    has_tool_use = False

    for block in content:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "text":
            text = block.get("text", "")
            if text.strip():
                text_blocks.append(text)
        elif block_type == "tool_use":
            has_tool_use = True

    if text_blocks:
        return ("\n".join(text_blocks), has_tool_use)
    if has_tool_use:
        return ("", True)
    return None


def extract_codex_text(obj: dict) -> tuple[str, bool] | None:
    if obj.get("type") != "response_item":
        return None

    payload = obj.get("payload", {})
    if payload.get("type") != "message" or payload.get("role") != "assistant":
        return None

    content = payload.get("content", [])
    text_blocks = []
    has_tool_use = False

    for block in content:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type in {"output_text", "text"}:
            text = block.get("text", "")
            if text.strip():
                text_blocks.append(text)
        elif block_type in {"tool_call", "function_call"}:
            has_tool_use = True

    if text_blocks:
        return ("\n".join(text_blocks), has_tool_use)
    if has_tool_use:
        return ("", True)
    return None


def get_last_response(path: Path, max_chars: int) -> None:
    lines = read_tail(path)

    for raw_line in reversed(lines):
        line = raw_line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue

        extracted = extract_claude_text(obj) or extract_codex_text(obj)
        if extracted is None:
            continue

        text, has_tool_use = extracted
        if not text and has_tool_use:
            print("[still running — last assistant message is a tool call]")
            return

        if has_tool_use:
            print("[note: response also contained tool calls]")

        if len(text) > max_chars:
            text = text[:max_chars] + f"\n\n[...truncated at {max_chars} chars]"
        print(text)
        return

    print("[no assistant text response found in last 128KB of log]")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract the last assistant response from a Claude Code or Codex conversation log"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("session", nargs="?", help="Session ID or path to a .jsonl file")
    group.add_argument("--by-name", metavar="NAME", help="Find a fork session by title")
    parser.add_argument("--project-dir", help="Optional project directory filter when using --by-name")
    parser.add_argument("--max-chars", type=int, default=5000, help="Max characters to output")
    args = parser.parse_args()

    if args.by_name:
        path = find_by_name(args.by_name, args.project_dir)
        if path is None:
            print(f"Error: No conversation found with title '{args.by_name}'", file=sys.stderr)
            sys.exit(1)
    else:
        path = resolve_path(args.session)

    get_last_response(path, args.max_chars)


if __name__ == "__main__":
    main()
