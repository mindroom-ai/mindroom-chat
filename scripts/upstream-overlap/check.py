#!/usr/bin/env python3
"""Find code in this repository that overlaps the upstream client (AGPL-3.0), for the clean-room audit.

Usage:
  check.py --corpus <bare or normal upstream git repo> [--paths FILE...] [--history] [--jscpd]
           [--snapshots DIR] [--out REPORT.tsv]

Rules (spec: docs/provenance.md, "upstream overlap check"):
  1. Line runs: 3 or more consecutive non-trivial lines (8+ characters after trimming, not only
     punctuation) that each occur verbatim in any version of any upstream text file. Import and
     re-export statements are ignored, because this repository keeps the upstream client's module paths so that
     the ported files compile. Lines that also occur in third-party code under node_modules are
     treated as generic: they neither count toward nor break a run.
  2. Token runs: 30 or more consecutive tokens of JavaScript, TypeScript or CSS that occur in
     the same order in any version of any upstream code file. Comments, whitespace, import
     statements and the trivial lines below are left out of both sides first, so a run may span
     them. (--jscpd additionally runs jscpd at 30 tokens against upstream snapshots at a spread of
     release tags; it is slower and was used for the 2026-11-03 rewrite.)

Output lists only paths and line ranges in this repository, never upstream text.
Without --paths it checks every tracked text file at HEAD; with --history it checks every blob
that any commit of this repository contains and prints "<blob> <path>:<start>-<end>".
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TEXT = re.compile(r"\.(ts|tsx|js|jsx|mjs|cjs|css|scss|json|html|sh|py|svg|md|yml|yaml)$")
PUNCT = re.compile(r"^[\s{}()\[\];,<>/=:.'\"`]*$")
IMPORTS = re.compile(
    r"""^\s*(?:import|export)\s+(?:type\s+)?(?:[\w$]+\s*,?\s*)?(?:\*\s+as\s+[\w$]+|\{[^}]*\}|\*)?\s*"""
    r"""from\s*['"][^'"]+['"];?|^\s*import\s*['"][^'"]+['"];?""",
    re.M,
)
MIN_LEN, MIN_RUN = 8, 3
SNAPSHOT_TAGS = ["v1.8.2", "v2.2.6", "v3.2.0", "v4.0.0", "v4.10.2", "v4.12.8"]
CACHE = Path(tempfile.gettempdir()) / "upstream-overlap-cache"


def git(repo, *args, text=True):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=text, check=True).stdout


def all_blobs(repo):
    found = {}
    for line in git(repo, "rev-list", "--objects", "--all").splitlines():
        oid, _, path = line.partition(" ")
        if path and TEXT.search(path):
            found.setdefault(oid, path)
    return found


def read_blobs(repo, oids):
    proc = subprocess.Popen(["git", "-C", str(repo), "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    out = {}
    for oid in oids:
        proc.stdin.write(f"{oid}\n".encode())
        proc.stdin.flush()
        header = proc.stdout.readline().split()
        if len(header) < 3:
            continue
        body = proc.stdout.read(int(header[2]))
        proc.stdout.read(1)
        if header[1] == b"blob":
            out[oid] = body.decode("utf-8", "replace")
    proc.stdin.close()
    proc.wait()
    return out


# Lines skipped like blank lines (they neither count toward nor break a run). Most carry no
# authorial choice: a JSX closing tag; a JSX tag or attribute line whose attributes are all string,
# number or boolean literals (library design tokens such as folds' variant="Surface" gap="200");
# a line whose only content is a Matrix namespaced identifier as a key or value
# ('m.relates_to': {, rel_type: 'm.replace',, PoniesEmoteRooms = 'im.ponies.emote_rooms',); a line
# that is only a name (eventId, or ...props in a parameter or object list) or passes a prop under
# its own name (room={room}), because ported code fixes those names. Comment lines are skipped too,
# so a comment cannot break a run.
LITERAL_ATTR = r"""[A-Za-z][\w-]*(?:=(?:"[^"]*"|'[^']*'|\{-?[\d.]+\}|\{(?:true|false|null|undefined)\}|\{'[^']*'\}))?"""
TRIVIAL = [
    re.compile(r"^</[\w.]*>$"),
    re.compile(rf"^<[\w.]+(?:\s+{LITERAL_ATTR})*\s*/?>?$"),
    re.compile(rf"^{LITERAL_ATTR}\s*/?>?$"),
    re.compile(r"""^['"]?[\w$]*['"]?\s*[:=]?\s*['"](?:m|io|im|org|com|uk|chat|de|net)\.[\w.-]+['"]\s*[,:;]?\s*\{?$"""),
    re.compile(r"^(?:\.\.\.)?[A-Za-z_$][\w$]*,?$"),
    re.compile(r"^([A-Za-z_$][\w$-]*)=\{\1\}\s*/?>?$"),
    re.compile(r"^(?://|/\*|\*/|\*(?:\s|$))"),
]


def candidate(line):
    stripped = line.strip()
    if len(stripped) < MIN_LEN or PUNCT.match(stripped) or any(t.match(stripped) for t in TRIVIAL):
        return None
    return stripped


def strip_imports(text):
    return IMPORTS.sub(lambda m: "\n" * m.group(0).count("\n"), text)


def corpus_lines(corpus):
    CACHE.mkdir(exist_ok=True)
    head = git(corpus, "rev-parse", "--all").split()[0]
    rules = hashlib.sha256((IMPORTS.pattern + "".join(t.pattern for t in TRIVIAL) + str(MIN_LEN)).encode()).hexdigest()[:12]
    cached = CACHE / f"corpus-{head}-{rules}.json"
    if cached.exists():
        return set(json.loads(cached.read_text()))
    lines = set()
    for text in read_blobs(corpus, list(all_blobs(corpus))).values():
        for line in strip_imports(text).split("\n"):
            c = candidate(line)
            if c:
                lines.add(c)
    cached.write_text(json.dumps(sorted(lines)))
    return lines


def generic_lines(corpus_set):
    cached = CACHE / f"generic-{hashlib.sha256(chr(10).join(sorted(corpus_set)).encode()).hexdigest()[:12]}.json"
    if cached.exists():
        return set(json.loads(cached.read_text()))
    generic = set()
    for root, _, files in os.walk(REPO / "node_modules"):
        for name in files:
            if not TEXT.search(name):
                continue
            try:
                with open(os.path.join(root, name), encoding="utf-8", errors="replace") as fh:
                    for line in fh:
                        s = line.strip()
                        if s in corpus_set:
                            generic.add(s)
            except OSError:
                pass
    cached.write_text(json.dumps(sorted(generic)))
    return generic


def line_runs(text, corpus_set, generic):
    runs, run = [], []
    for number, line in enumerate(strip_imports(text).split("\n"), 1):
        c = candidate(line)
        if c is None or c in generic:
            continue
        if c in corpus_set:
            run.append(number)
            continue
        if len(run) >= MIN_RUN:
            runs.append((run[0], run[-1]))
        run = []
    if len(run) >= MIN_RUN:
        runs.append((run[0], run[-1]))
    return runs


CODE = re.compile(r"\.(ts|tsx|js|jsx|mjs|cjs|css|scss)$")
TOKEN = re.compile(
    r"""//[^\n]*|/\*.*?\*/|`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|[A-Za-z_$][\w$]*|\d[\w.]*|\S""",
    re.S,
)
WINDOW = 30
MASK = (1 << 64) - 1
BASE = 1_000_003
_token_ids: dict[str, int] = {}


def token_id(token):
    found = _token_ids.get(token)
    if found is None:
        found = int.from_bytes(hashlib.blake2b(token.encode(), digest_size=8).digest(), "big")
        _token_ids[token] = found
    return found


def tokens(text):
    """(token id, first line, last line) for each token outside comments, imports and trivial lines."""
    lines = strip_imports(text).split("\n")
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped and any(t.match(stripped) for t in TRIVIAL):
            lines[i] = ""
    found, line, last = [], 1, 0
    clean = "\n".join(lines)
    for match in TOKEN.finditer(clean):
        line += clean.count("\n", last, match.start())
        token = match.group(0)
        last = match.start()
        if token.startswith("//") or token.startswith("/*"):
            continue
        found.append((token_id(token), line, line + token.count("\n")))
    return found


def windows(ids):
    if len(ids) < WINDOW:
        return []
    top = pow(BASE, WINDOW - 1, 1 << 64)
    value = 0
    for t in ids[:WINDOW]:
        value = (value * BASE + t) & MASK
    out = [value]
    for i in range(WINDOW, len(ids)):
        value = ((value - ids[i - WINDOW] * top) * BASE + ids[i]) & MASK
        out.append(value)
    return out


def corpus_windows(corpus):
    from array import array
    head = git(corpus, "rev-parse", "--all").split()[0]
    rules = hashlib.sha256((TOKEN.pattern + IMPORTS.pattern + "".join(t.pattern for t in TRIVIAL) + str(WINDOW)).encode()).hexdigest()[:12]
    cached = CACHE / f"windows-{head}-{rules}.bin"
    data = array("Q")
    if cached.exists():
        with open(cached, "rb") as fh:
            data.frombytes(fh.read())
        return set(data)
    found = set()
    blobs = {oid: path for oid, path in all_blobs(corpus).items() if CODE.search(path)}
    for text in read_blobs(corpus, list(blobs)).values():
        found.update(windows([t for t, _, _ in tokens(text)]))
    data.extend(sorted(found))
    CACHE.mkdir(exist_ok=True)
    with open(cached, "wb") as fh:
        fh.write(data.tobytes())
    return found


def token_runs(text, corpus_set):
    toks = tokens(text)
    hits = windows([t for t, _, _ in toks])
    covered = [False] * len(toks)
    for i, value in enumerate(hits):
        if value in corpus_set:
            for j in range(i, i + WINDOW):
                covered[j] = True
    runs, start = [], None
    for i, flag in enumerate(covered + [False]):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            runs.append((toks[start][1], toks[i - 1][2]))
            start = None
    return runs


def snapshots(corpus, dest):
    dest.mkdir(parents=True, exist_ok=True)
    for tag in SNAPSHOT_TAGS:
        target = dest / tag
        if target.exists():
            continue
        target.mkdir()
        archive = subprocess.run(["git", "-C", str(corpus), "archive", tag, "src"], capture_output=True, check=True).stdout
        subprocess.run(["tar", "-x", "-C", str(target)], input=archive, check=True)
    return [dest / t for t in SNAPSHOT_TAGS]


def jscpd_clones(files_dir, snapshot_dirs):
    found = []
    for snap in snapshot_dirs:
        with tempfile.TemporaryDirectory() as out:
            subprocess.run(
                ["npx", "-y", "jscpd@4", "--min-tokens", "30", "--reporters", "json", "--output", out, "--silent",
                 "--ignore", "**/node_modules/**", str(files_dir), str(snap)],
                capture_output=True, cwd=REPO,
            )
            report = Path(out) / "jscpd-report.json"
            if not report.exists():
                continue
            for dup in json.loads(report.read_text())["duplicates"]:
                a, b = dup["firstFile"], dup["secondFile"]
                for ours, theirs in ((a, b), (b, a)):
                    if os.path.realpath(ours["name"]).startswith(os.path.realpath(files_dir)) and \
                            os.path.realpath(theirs["name"]).startswith(os.path.realpath(snap)):
                        rel = os.path.relpath(os.path.realpath(ours["name"]), os.path.realpath(files_dir))
                        found.append((rel, ours["startLoc"]["line"], ours["endLoc"]["line"], snap.name))
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--paths", nargs="*")
    ap.add_argument("--history", action="store_true")
    ap.add_argument("--jscpd", action="store_true")
    ap.add_argument("--snapshots", default=str(CACHE / "snapshots"))
    ap.add_argument("--out")
    args = ap.parse_args()
    corpus = Path(args.corpus)
    cset = corpus_lines(corpus)
    generic = generic_lines(cset)
    if args.history:
        blobs = all_blobs(REPO)
        texts = read_blobs(REPO, list(blobs))
        items = [(oid, blobs[oid], text) for oid, text in texts.items()]
    else:
        paths = args.paths or [p for p in git(REPO, "ls-files").splitlines() if TEXT.search(p)]
        items = []
        for p in paths:
            f = REPO / p
            if f.is_file():
                items.append(("HEAD", p, f.read_text(encoding="utf-8", errors="replace")))
    cwindows = corpus_windows(corpus)
    rows = []
    for oid, path, text in items:
        if "package-lock.json" in path or path.endswith("package.json"):
            continue
        for start, end in line_runs(text, cset, generic):
            rows.append((oid, path, start, end, "line-run"))
        if CODE.search(path):
            for start, end in token_runs(text, cwindows):
                rows.append((oid, path, start, end, "tokens"))
    if args.jscpd:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            key = {}
            for i, (oid, path, text) in enumerate(items):
                if not re.search(r"\.(ts|tsx|js|jsx|mjs|css|scss)$", path) or "package" in path:
                    continue
                name = f"{i:05d}__{path.replace('/', '__')}"
                (tmp / name).write_text(text)
                key[name] = (oid, path)
            for rel, start, end, tag in jscpd_clones(tmp, snapshots(corpus, Path(args.snapshots))):
                oid, path = key.get(rel, (None, None))
                if path:
                    rows.append((oid, path, start, end, f"jscpd-{tag}"))
    rows.sort(key=lambda r: (r[1], r[0], r[2]))
    lines = [f"{oid}\t{path}\t{start}-{end}\t{kind}" for oid, path, start, end, kind in rows]
    if args.out:
        Path(args.out).write_text("\n".join(lines) + ("\n" if lines else ""))
    print(f"upstream-overlap: {len(rows)} findings in {len({r[1] for r in rows})} files ({len(items)} checked)")
    if not args.out:
        print("\n".join(lines[:200]))
    sys.exit(1 if rows else 0)


if __name__ == "__main__":
    main()
