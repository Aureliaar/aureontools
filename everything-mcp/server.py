import json
import os
import subprocess
from typing import Any

from mcp.server.fastmcp import FastMCP

ES_PATH = os.environ.get("EVERYTHING_ES_PATH") or r"C:\Program Files\Everything\es.exe"

VALID_SORTS = {
    "name",
    "path",
    "size",
    "extension",
    "date-created",
    "date-modified",
    "date-accessed",
    "run-count",
    "date-run",
    "date-recently-changed",
}

mcp = FastMCP("everything")


@mcp.tool()
def search(
    query: str,
    max_results: int = 100,
    offset: int = 0,
    regex: bool = False,
    case_sensitive: bool = False,
    whole_words: bool = False,
    match_path: bool = False,
    sort_by: str = "name",
    descending: bool = False,
    path: str | None = None,
    details: bool = False,
) -> list[str] | list[dict[str, Any]]:
    """Search the filesystem with Everything (voidtools). Requires Everything.exe running.

    query: Everything syntax — wildcards (*, ?), space=AND, | =OR, ! =NOT, "quoted
           phrases", and operators like path:, ext:, size:, dm:, dc:. If regex=True,
           interpreted as a regular expression instead.
    max_results: cap on rows returned.
    offset: skip the first N matches (pagination; pairs with max_results).
    regex: treat query as regex.
    case_sensitive: match case.
    whole_words: match whole words only.
    match_path: match against the full path, not just the filename.
    sort_by: one of name, path, size, extension, date-created, date-modified,
             date-accessed, run-count, date-run, date-recently-changed.
    descending: reverse sort order.
    path: restrict to a subtree (absolute path).
    details: if True, return list of dicts with filename + size + date_modified +
             date_created (ISO-8601 UTC). Otherwise returns list of path strings.
    """
    if sort_by not in VALID_SORTS:
        raise ValueError(f"sort_by must be one of {sorted(VALID_SORTS)}")
    if max_results < 1:
        raise ValueError("max_results must be >= 1")
    if offset < 0:
        raise ValueError("offset must be >= 0")

    args: list[str] = [
        ES_PATH,
        "-sort",
        f"{sort_by}-{'descending' if descending else 'ascending'}",
        "-n",
        str(offset + max_results),
    ]
    if case_sensitive:
        args.append("-case")
    if whole_words:
        args.append("-whole-word")
    if match_path:
        args.append("-match-path")
    if offset > 0:
        args += ["-viewport-offset", str(offset), "-viewport-count", str(max_results)]
    if path:
        args += ["-path", path]
    if details:
        args += [
            "-json",
            "-size",
            "-date-modified",
            "-date-created",
            "-date-format",
            "3",
        ]
    if regex:
        args += ["-r", query]
    else:
        args.append(query)

    result = subprocess.run(
        args, capture_output=True, encoding="utf-8", errors="replace"
    )
    if result.returncode != 0:
        msg = result.stderr.strip() or result.stdout.strip() or "no output"
        raise RuntimeError(f"es.exe exited {result.returncode}: {msg}")

    out = result.stdout
    if details:
        return json.loads(out) if out.strip() else []
    return [line for line in out.splitlines() if line.strip()]


if __name__ == "__main__":
    mcp.run()
