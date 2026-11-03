#!/usr/bin/env python3
"""Copy Bas-authored files from a MindRoom Chat checkout into this repository (Lane P).

Usage: scripts/port_files.py <chat checkout> <commit> [--verify]

Reads docs/provenance/portable.tsv (path, Bas lines, other lines). For each path it runs
`git blame -w -M -C -C --line-porcelain <commit> -- <path>` in the checkout, copies the file as of
<commit>, and blanks every line not attributed to bas@nijho.lt. Blanked lines are listed in
docs/provenance/holes.tsv (path, 1-based line number). A file whose share of Bas lines is below
95% is refused.

With --verify it recomputes the same output in memory and compares it with the files and
holes.tsv as they were committed by the import commit recorded in docs/provenance/import.txt.
"""

import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BAS = "<bas@nijho.lt>"
THRESHOLD = 0.95
REPO = Path(__file__).resolve().parent.parent
PROV = REPO / "docs" / "provenance"


def blame_authors(chat: Path, commit: str, path: str) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(chat), "blame", "-w", "-M", "-C", "-C", "--line-porcelain", commit, "--", path],
        check=True, capture_output=True, text=True,
    ).stdout
    return [line.split(" ", 1)[1] for line in out.splitlines() if line.startswith("author-mail ")]


def source_lines(chat: Path, commit: str, path: str) -> list[str]:
    data = subprocess.run(["git", "-C", str(chat), "show", f"{commit}:{path}"], check=True, capture_output=True).stdout
    return data.decode("utf-8").split("\n")


def ported(chat: Path, commit: str, path: str) -> tuple[str, list[int]]:
    authors = blame_authors(chat, commit, path)
    lines = source_lines(chat, commit, path)
    bas = sum(1 for a in authors if a == BAS)
    if not authors or bas / len(authors) < THRESHOLD:
        raise SystemExit(f"{path}: only {bas}/{len(authors)} lines by Bas at {commit}")
    holes = [i + 1 for i, a in enumerate(authors) if a != BAS]
    for n in holes:
        lines[n - 1] = ""
    return "\n".join(lines), holes


def main() -> None:
    chat, commit = Path(sys.argv[1]), sys.argv[2]
    verify = "--verify" in sys.argv[3:]
    paths = [line.split("\t")[0] for line in (PROV / "portable.tsv").read_text().splitlines() if line]
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda p: (p, *ported(chat, commit, p)), paths))
    hole_rows = [f"{p}\t{n}" for p, _, holes in results for n in holes]
    if verify:
        import_commit = (PROV / "import.txt").read_text().split()[0]
        bad = []
        for path, text, _ in results:
            committed = subprocess.run(["git", "-C", str(REPO), "show", f"{import_commit}:{path}"], capture_output=True).stdout.decode()
            if committed != text:
                bad.append(path)
        committed_holes = subprocess.run(["git", "-C", str(REPO), "show", f"{import_commit}:docs/provenance/holes.tsv"], capture_output=True).stdout.decode()
        if committed_holes.strip() != "\n".join(hole_rows).strip():
            bad.append("docs/provenance/holes.tsv")
        if bad:
            raise SystemExit("verify failed:\n" + "\n".join(bad))
        print(f"verified {len(results)} files and {len(hole_rows)} holes against {commit}")
        return
    for path, text, _ in results:
        dest = REPO / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text)
    (PROV / "holes.tsv").write_text("\n".join(hole_rows) + "\n")
    print(f"ported {len(results)} files, {len(hole_rows)} holes, from {commit}")


main()
