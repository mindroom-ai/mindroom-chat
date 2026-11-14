#!/usr/bin/env python3
"""Copy Bas-authored files from a MindRoom Chat checkout into this repository (Lane P).

Usage: scripts/port_files.py <chat checkout> <commit> [--wave N] [--verify]

Wave 1 uses docs/provenance/portable.tsv and holes.tsv; wave N > 1 uses portable-waveN.tsv and
holes-waveN.tsv. docs/provenance/import.txt has one line per wave: "<import commit> <source>".

Reads docs/provenance/portable.tsv (path, Bas lines, other lines). For each path it runs
`git blame -w -M -C -C --line-porcelain <commit> -- <path>` in the checkout, copies the file as of
<commit>, and blanks every line not attributed to bas@nijho.lt. Blanked lines are listed in
docs/provenance/holes.tsv (path, 1-based line number). A file whose share of Bas lines is below
95% is refused.

With --verify it recomputes the same output in memory and compares it with the files and
holes.tsv as they were committed by the import commit recorded in docs/provenance/import.txt.

Lines listed for the wave in docs/provenance/holes-overlap-import.tsv (path, line, wave) are blanked
too: Bas-authored lines that are part of a run shared with the upstream client,
blanked in every commit by the history rewrite of 2026-11-03. A new import must blank them the same way.

Paths in the portable lists are this repository's paths. docs/provenance/rename-map.tsv (the name
scrub, read through scripts/rename_map.py) maps a renamed path back to its path in the checkout,
and the copied text goes through the same rules the scrub applied to the import commits.
"""

import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BAS = "<bas@nijho.lt>"
THRESHOLD = 0.95
REPO = Path(__file__).resolve().parent.parent
PROV = REPO / "docs" / "provenance"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rename_map import RenameMap  # noqa: E402

NAMES = RenameMap()


def blame_authors(chat: Path, commit: str, path: str) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(chat), "blame", "-w", "-M", "-C", "-C", "--line-porcelain", commit, "--", path],
        check=True, capture_output=True, text=True,
    ).stdout
    return [line.split(" ", 1)[1] for line in out.splitlines() if line.startswith("author-mail ")]


def source_lines(chat: Path, commit: str, path: str) -> list[str]:
    data = subprocess.run(["git", "-C", str(chat), "show", f"{commit}:{path}"], check=True, capture_output=True).stdout
    return data.decode("utf-8").split("\n")


def overlap_holes(wave: int) -> dict[str, set[int]]:
    found: dict[str, set[int]] = {}
    file = PROV / "holes-overlap-import.tsv"
    for row in file.read_text().splitlines() if file.is_file() else []:
        path, line, row_wave = row.split("\t")
        if int(row_wave) == wave:
            found.setdefault(path, set()).add(int(line))
    return found


def ported(chat: Path, commit: str, path: str, overlap: set[int]) -> tuple[str, list[int]]:
    source = NAMES.source_path(path)
    authors = blame_authors(chat, commit, source)
    lines = source_lines(chat, commit, source)
    bas = sum(1 for a in authors if a == BAS)
    if not authors or bas / len(authors) < THRESHOLD:
        raise SystemExit(f"{path}: only {bas}/{len(authors)} lines by Bas at {commit}")
    holes = [i + 1 for i, a in enumerate(authors) if a != BAS]
    for n in [*holes, *overlap]:
        lines[n - 1] = ""
    return NAMES.content("\n".join(lines)), holes


def main() -> None:
    chat, commit = Path(sys.argv[1]), sys.argv[2]
    verify = "--verify" in sys.argv[3:]
    wave = int(sys.argv[sys.argv.index("--wave") + 1]) if "--wave" in sys.argv else 1
    suffix = "" if wave == 1 else f"-wave{wave}"
    list_file, holes_file = PROV / f"portable{suffix}.tsv", PROV / f"holes{suffix}.tsv"
    rows = [line.split("\t") for line in list_file.read_text().splitlines() if line]
    if verify and rows and len(rows[0]) == 2 and len(rows[0][1]) == 40:
        # Binary wave: each row is (path, blob sha at <commit>); verify by blob hash.
        import_commit = (PROV / "import.txt").read_text().splitlines()[wave - 1].split()[0]
        bad = []
        for path, sha in rows:
            source = subprocess.run(["git", "-C", str(chat), "rev-parse", f"{commit}:{NAMES.source_path(path)}"], capture_output=True, text=True).stdout.strip()
            ported_sha = subprocess.run(["git", "-C", str(REPO), "rev-parse", f"{import_commit}:{path}"], capture_output=True, text=True).stdout.strip()
            authors = set(subprocess.run(["git", "-C", str(chat), "log", "--format=%ae", commit, "--", NAMES.source_path(path)], capture_output=True, text=True).stdout.split())
            if not (sha == source == ported_sha) or authors != {"bas@nijho.lt"}:
                bad.append(path)
        if bad:
            raise SystemExit("verify failed:\n" + "\n".join(bad))
        print(f"verified {len(rows)} binary files by blob hash against {commit}")
        return
    paths = [row[0] for row in rows]
    overlap = overlap_holes(wave)
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda p: (p, *ported(chat, commit, p, overlap.get(p, set()))), paths))
    hole_rows = [f"{p}\t{n}" for p, _, holes in results for n in holes]
    if verify:
        import_commit = (PROV / "import.txt").read_text().splitlines()[wave - 1].split()[0]
        bad = []
        for path, text, _ in results:
            committed = subprocess.run(["git", "-C", str(REPO), "show", f"{import_commit}:{path}"], capture_output=True).stdout.decode()
            if committed != text:
                bad.append(path)
        committed_holes = subprocess.run(["git", "-C", str(REPO), "show", f"{import_commit}:docs/provenance/{holes_file.name}"], capture_output=True).stdout.decode()
        if committed_holes.strip() != "\n".join(hole_rows).strip():
            bad.append(f"docs/provenance/{holes_file.name}")
        if bad:
            raise SystemExit("verify failed:\n" + "\n".join(bad))
        print(f"verified {len(results)} files and {len(hole_rows)} holes against {commit}")
        return
    for path, text, _ in results:
        dest = REPO / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text)
    holes_file.write_text("\n".join(hole_rows) + "\n")
    print(f"ported {len(results)} files, {len(hole_rows)} holes, from {commit}")


main()
