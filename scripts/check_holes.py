#!/usr/bin/env python3
"""Check that Lane P files differ from the import commit only in their blanked lines.

Usage: scripts/check_holes.py [--wave N] [--rev <rev>] [path ...]

Lane P files were imported in waves. Wave 1 is docs/provenance/holes.tsv against the first line of
docs/provenance/import.txt; wave 2 is docs/provenance/holes-wave2.tsv against the second line. Each
hole file lists every line (path, 1-based line number) that was blanked at that import. For each
listed file, this compares the import commit with the working tree, or with <rev> when --rev is
given. A file passes when it has the same number of lines as at import and every line that differs
is listed in the hole file, was empty at import, and is now exactly one line.

--wave defaults to 1. With no paths it checks every file in the wave's hole file; otherwise only
the given paths (each must be in that hole file). Files listed in docs/provenance/dropped.tsv
(Lane P files deleted with a dropped feature) are skipped. Prints `path:line: reason` for each
violation and exits 1, or exits 0 when clean.
Later tasks may change Lane P files as the Lane P rules allow, so run it with --rev <commit> to
check the commit that filled the blanks.
"""

import argparse
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PROV = REPO / "docs" / "provenance"


HOLE_FILES = {1: "holes.tsv", 2: "holes-wave2.tsv"}
DROPPED_FILE = "dropped.tsv"


def read_holes(wave: int) -> dict[str, set[int]]:
    holes: dict[str, set[int]] = defaultdict(set)
    for row in (PROV / HOLE_FILES[wave]).read_text().splitlines():
        if row:
            path, line = row.split("\t")
            holes[path].add(int(line))
    return holes


def read_dropped() -> set[str]:
    file = PROV / DROPPED_FILE
    if not file.is_file():
        return set()
    return {row.split("\t")[0] for row in file.read_text().splitlines() if row}


def git_show(rev: str, path: str) -> str | None:
    result = subprocess.run(["git", "-C", str(REPO), "show", f"{rev}:{path}"], capture_output=True)
    return result.stdout.decode("utf-8") if result.returncode == 0 else None


def current_text(rev: str | None, path: str) -> str | None:
    if rev is not None:
        return git_show(rev, path)
    file = REPO / path
    return file.read_bytes().decode("utf-8") if file.is_file() else None


def import_commit(wave: int) -> str:
    rows = [row for row in (PROV / "import.txt").read_text().splitlines() if row.strip()]
    if len(rows) < wave:
        sys.exit(f"check_holes: docs/provenance/import.txt has no line for wave {wave}")
    return rows[wave - 1].split()[0]


def violations(path: str, holes: set[int], before: str | None, after: str | None) -> list[str]:
    if before is None:
        return [f"{path}:0: missing from the import commit"]
    if after is None:
        return [f"{path}:0: file is missing"]
    old, new = before.split("\n"), after.split("\n")
    if len(old) != len(new):
        first = next((i for i, (a, b) in enumerate(zip(old, new)) if a != b), min(len(old), len(new)))
        return [f"{path}:{first + 1}: line count changed from {len(old)} to {len(new)} (lines added or removed)"]
    found = []
    for index, (old_line, new_line) in enumerate(zip(old, new)):
        if old_line == new_line:
            continue
        number = index + 1
        if number not in holes:
            found.append(f"{path}:{number}: changed a line that was not blanked")
        elif old_line != "":
            found.append(f"{path}:{number}: blanked line was not empty at import")
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--wave", type=int, choices=sorted(HOLE_FILES), default=1, help="import wave to check (default 1)")
    parser.add_argument("--rev", help="check this revision instead of the working tree")
    parser.add_argument("paths", nargs="*", help="limit the check to these hole-file paths")
    args = parser.parse_args()

    commit = import_commit(args.wave)
    holes = read_holes(args.wave)
    paths = args.paths or sorted(holes)
    unknown = [p for p in paths if p not in holes]
    if unknown:
        for path in unknown:
            print(f"{path}:0: not listed in docs/provenance/{HOLE_FILES[args.wave]}")
        return 1

    dropped_paths = read_dropped()
    dropped = [p for p in paths if p in dropped_paths]
    paths = [p for p in paths if p not in dropped_paths]

    found = []
    for path in paths:
        found += violations(path, holes[path], git_show(commit, path), current_text(args.rev, path))
    for line in found:
        print(line)
    target = f"wave {args.wave}, {args.rev or 'working tree'}"
    if found:
        print(f"check_holes: {len(found)} violation(s) in {target}", file=sys.stderr)
        return 1
    skipped = f", {len(dropped)} dropped files skipped" if dropped else ""
    print(
        f"check_holes: {len(paths)} files match {commit[:7]} outside their blanked lines"
        f" ({target}{skipped})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
