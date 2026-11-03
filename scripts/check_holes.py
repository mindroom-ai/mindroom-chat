#!/usr/bin/env python3
"""Check that Lane P files differ from the import commit only in their blanked lines.

Usage: scripts/check_holes.py [--rev <rev>] [path ...]

docs/provenance/holes.tsv lists every line (path, 1-based line number) that was blanked when the
Lane P files were imported (docs/provenance/import.txt, first field). For each listed file, this
compares the import commit with the working tree, or with <rev> when --rev is given. A file passes
when it has the same number of lines as at import and every line that differs is listed in
holes.tsv, was empty at import, and is now exactly one line.

With no paths it checks every file in holes.tsv; otherwise only the given paths (each must be in
holes.tsv). Prints `path:line: reason` for each violation and exits 1, or exits 0 when clean.
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


def read_holes() -> dict[str, set[int]]:
    holes: dict[str, set[int]] = defaultdict(set)
    for row in (PROV / "holes.tsv").read_text().splitlines():
        if row:
            path, line = row.split("\t")
            holes[path].add(int(line))
    return holes


def git_show(rev: str, path: str) -> str | None:
    result = subprocess.run(["git", "-C", str(REPO), "show", f"{rev}:{path}"], capture_output=True)
    return result.stdout.decode("utf-8") if result.returncode == 0 else None


def current_text(rev: str | None, path: str) -> str | None:
    if rev is not None:
        return git_show(rev, path)
    file = REPO / path
    return file.read_bytes().decode("utf-8") if file.is_file() else None


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
    parser.add_argument("--rev", help="check this revision instead of the working tree")
    parser.add_argument("paths", nargs="*", help="limit the check to these holes.tsv paths")
    args = parser.parse_args()

    import_commit = (PROV / "import.txt").read_text().split()[0]
    holes = read_holes()
    paths = args.paths or sorted(holes)
    unknown = [p for p in paths if p not in holes]
    if unknown:
        for path in unknown:
            print(f"{path}:0: not listed in docs/provenance/holes.tsv")
        return 1

    found = []
    for path in paths:
        found += violations(path, holes[path], git_show(import_commit, path), current_text(args.rev, path))
    for line in found:
        print(line)
    target = args.rev or "working tree"
    if found:
        print(f"check_holes: {len(found)} violation(s) in {target}", file=sys.stderr)
        return 1
    print(f"check_holes: {len(paths)} files match {import_commit[:7]} outside their blanked lines ({target})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
