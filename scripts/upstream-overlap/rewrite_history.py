#!/usr/bin/env python3
"""One-time history rewrite of 2026-11-03: blank every upstream overlap in every commit.

Usage: rewrite_history.py <findings.tsv> <purge-paths.txt> <workdir> <upstream repository>

<findings.tsv> is `check.py --history --jscpd --out` output for this repository: one row per
finding (blob, path, start-end, kind). Every line inside a finding's range is replaced by an empty
line in that blob, except import and re-export statements and lines that are already blank, so
line numbers stay the same. Each blanked blob is checked again (blanking can leave a skeleton of
brackets and kept lines that still matches) and blanked further until it passes.
<purge-paths.txt> lists MindRoom Chat repository tooling removed from every commit; their rows are
also dropped from the provenance lists. The rewrite runs git-filter-repo once, so the commits and
their messages stay; commits that end up empty are pruned.

Writes into <workdir>: blobs/<oid> (replacement contents), blanked.tsv (blob, path, line),
holes-overlap-import.tsv rows for docs/provenance (path, line, wave), and holes-overlap-head.tsv
(path, line) for the tip.
"""

import subprocess
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from check import CODE, IMPORTS, REPO, corpus_lines, corpus_windows, generic_lines, git, line_runs, read_blobs, token_runs  # noqa: E402

PROV = "docs/provenance"


def blank_lines(text: str, ranges: list[tuple[int, int]]) -> list[int]:
    stripped = IMPORTS.sub(lambda m: "\n" * m.group(0).count("\n"), text).split("\n")
    lines = set()
    for start, end in ranges:
        for number in range(start, end + 1):
            if number <= len(stripped) and stripped[number - 1].strip():
                lines.add(number)
    return sorted(lines)


def main() -> None:
    findings, purge_file, work = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    corpus = Path(sys.argv[4])
    cset = corpus_lines(corpus)
    generic = generic_lines(cset)
    cwindows = corpus_windows(corpus)
    purge = [p for p in purge_file.read_text().splitlines() if p]
    (work / "blobs").mkdir(parents=True, exist_ok=True)
    ranges: dict[str, list[tuple[int, int]]] = defaultdict(list)
    paths: dict[str, str] = {}
    for row in findings.read_text().splitlines():
        oid, path, span, _kind = row.split("\t")
        start, end = map(int, span.split("-"))
        ranges[oid].append((start, end))
        paths[oid] = path
    texts = read_blobs(REPO, list(ranges))
    blanked_rows, by_oid = [], {}
    for oid, text in texts.items():
        lines = text.split("\n")
        numbers: set[int] = set()
        todo = ranges[oid]
        while todo:
            new = blank_lines("\n".join(lines), todo)
            numbers.update(new)
            for n in new:
                lines[n - 1] = ""
            current = "\n".join(lines)
            todo = line_runs(current, cset, generic) + (token_runs(current, cwindows) if CODE.search(paths[oid]) else [])
            if todo and not blank_lines(current, todo):
                raise SystemExit(f"{paths[oid]} ({oid}): residual overlap {todo} has nothing left to blank")
        numbers = sorted(numbers)
        by_oid[oid] = numbers
        (work / "blobs" / oid).write_bytes("\n".join(lines).encode())
        blanked_rows += [f"{oid}\t{paths[oid]}\t{n}" for n in numbers]
    (work / "blanked.tsv").write_text("\n".join(blanked_rows) + "\n")

    def purged(path: str) -> bool:
        return any(path == p or path.startswith(p.rstrip("/") + "/") for p in purge)

    # Provenance lists that name purged files: drop those rows in every version.
    for list_path in (f"{PROV}/portable-wave2.tsv", f"{PROV}/dropped.tsv"):
        for oid in git(REPO, "log", "--all", "--format=", "--raw", "--no-abbrev", "--", list_path).split():
            if len(oid) != 40 or set(oid) == {"0"}:
                continue
            text = read_blobs(REPO, [oid]).get(oid)
            if text is None:
                continue
            kept = [row for row in text.split("\n") if not (row and purged(row.split("\t")[0]))]
            if len(kept) != len(text.split("\n")):
                (work / "blobs" / oid).write_bytes("\n".join(kept).encode())

    # Overlap holes in each Lane P import, so port_files.py --verify can reproduce the import.
    imports = [line.split()[0] for line in (REPO / PROV / "import.txt").read_text().splitlines() if line.strip()]
    rows = []
    for wave, commit in enumerate(imports[:2], 1):
        listing = (REPO / PROV / ("portable.tsv" if wave == 1 else "portable-wave2.tsv")).read_text()
        for row in listing.splitlines():
            path = row.split("\t")[0]
            if not row or purged(path):
                continue
            oid = git(REPO, "rev-parse", f"{commit}:{path}").strip()
            rows += [f"{path}\t{n}\t{wave}" for n in by_oid.get(oid, [])]
    (work / "holes-overlap-import.tsv").write_text("\n".join(rows) + ("\n" if rows else ""))

    head_rows = []
    for line in git(REPO, "ls-tree", "-r", "HEAD").splitlines():
        meta, path = line.split("\t", 1)
        oid = meta.split()[2]
        head_rows += [f"{path}\t{n}" for n in by_oid.get(oid, [])]
    (work / "holes-overlap-head.tsv").write_text("\n".join(head_rows) + ("\n" if head_rows else ""))
    print(f"{len(by_oid)} blobs blanked ({len(blanked_rows)} lines), {len(rows)} import holes, {len(head_rows)} tip holes")
    print(f"run: git filter-repo --force --invert-paths --paths-from-file {purge_file} --blob-callback \"$(cat {work}/callback.py)\"")
    (work / "callback.py").write_text(
        "import os\n"
        f"replacement = os.path.join({str(work / 'blobs')!r}, blob.original_id.decode())\n"
        "if os.path.exists(replacement):\n"
        "    with open(replacement, 'rb') as fh:\n"
        "        blob.data = fh.read()\n"
    )


if __name__ == "__main__":
    main()
