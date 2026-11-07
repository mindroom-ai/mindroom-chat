#!/usr/bin/env python3
"""Find code in this repository that overlaps the upstream client (AGPL-3.0), for the clean-room audit.

Usage:
  check.py --corpus <bare or normal upstream git repo> [--paths FILE...] [--history] [--jscpd]
           [--snapshots DIR] [--out REPORT.tsv]
  check.py --corpus <upstream git repo> --pre-push <remote URL>  < pre-push hook input

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
With --pre-push (the pre-push hook, scripts/git-hooks/pre-push) it reads the hook's input from the
current repository and checks every commit the push adds: each text file the commit adds or
modifies, as that commit has it. It prints "<commit> <path> <start>-<end> <kind>" and remembers
blobs it found clean, so a routine push checks only new files.
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
# The user's cache directory, the same from every shell (nix develop gives each shell its own TMPDIR).
CACHE = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "upstream-overlap"


def git(repo, *args, text=True):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=text, check=True).stdout


def forget_calling_repository():
    """Git exports GIT_DIR (and in a linked worktree more) to the hooks it runs, and with it set `git -C <corpus>`
    reads the pushing repository instead, whose files then match themselves line for line. Drop git's
    repository-local variables, so that every command finds its repository from its own path."""
    names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True, check=True).stdout
    for name in names.split():
        os.environ.pop(name, None)


def corpus_head(corpus):
    try:
        return git(corpus, "rev-parse", "--all").split()[0]
    except (subprocess.CalledProcessError, IndexError):
        sys.exit(f"upstream-overlap: {corpus} is not a git clone of the upstream client with commits; nothing was checked")


def make_cache():
    """CACHE and the parents it lacks, owner-only whatever the umask: mkdir's mode covers only the last one."""
    umask = os.umask(0o077)
    try:
        CACHE.mkdir(mode=0o700, parents=True, exist_ok=True)
    finally:
        os.umask(umask)


def write_atomic(path, data):
    """Replace a cache file whole, so that a run reading it at the same time never sees part of it."""
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    if isinstance(data, bytes):
        tmp.write_bytes(data)
    else:
        tmp.write_text(data)
    os.replace(tmp, path)


def unchecked(path):
    """Dependency names and versions, which no check reads."""
    return "package-lock.json" in path or path.endswith("package.json")


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
    proc.stdout.close()
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
    make_cache()
    head = corpus_head(corpus)
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
    write_atomic(cached, json.dumps(sorted(lines)))
    return lines


def generic_lines(corpus_set, repo=REPO):
    cached = CACHE / f"generic-{hashlib.sha256(chr(10).join(sorted(corpus_set)).encode()).hexdigest()[:12]}.json"
    if cached.exists():
        return set(json.loads(cached.read_text()))
    if not (repo / "node_modules").is_dir():
        # Without it every line would count as upstream-only, and the cache would keep that.
        sys.exit(f"upstream-overlap: {repo / 'node_modules'} is missing; install the dependencies once to find generic lines")
    generic = set()
    for root, _, files in os.walk(repo / "node_modules"):
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
    write_atomic(cached, json.dumps(sorted(generic)))
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
    head = corpus_head(corpus)
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
    make_cache()
    write_atomic(cached, data.tobytes())
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


ZERO = re.compile(r"0+")


def push_updates(lines):
    """(local commit, remote commit or None) for each ref in the pre-push hook's input; a deletion pushes nothing."""
    updates = []
    for line in lines:
        if line.strip():
            _, local, _, remote = line.split()
            if not ZERO.fullmatch(local):
                updates.append((local, None if ZERO.fullmatch(remote) else remote))
    return updates


def has_commit(repo, oid):
    return subprocess.run(["git", "-C", str(repo), "cat-file", "-e", f"{oid}^{{commit}}"], capture_output=True).returncode == 0


def remote_main(repo, url, cwd):
    """The commit of the remote's main branch, or None when it has none or cannot be asked. When the repository
    lacks it (main moved on since the last fetch), its objects are fetched without touching any ref."""
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    listed = subprocess.run(["git", "ls-remote", url, "refs/heads/main"], cwd=cwd, capture_output=True, text=True, env=env)
    oid = next((line.split("\t")[0] for line in listed.stdout.splitlines() if line.endswith("\trefs/heads/main")), None)
    if oid and not has_commit(repo, oid):
        subprocess.run(["git", "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--no-auto-maintenance", url,
                        "refs/heads/main"], cwd=cwd, capture_output=True, env=env)
    return oid


def pushed_commits(repo, updates, main):
    """The commits a push adds, oldest first: reachable from a pushed tip but from neither the remote's tip of
    that ref nor the remote's main. A base this repository does not have cannot be left out, so the commits
    behind it are checked too: slower, never fewer."""
    commits = []
    for local, remote in updates:
        bases = [f"^{oid}" for oid in (remote, main) if oid and has_commit(repo, oid)]
        commits += git(repo, "rev-list", "--reverse", local, *bases).split()
    return list(dict.fromkeys(commits))


def changed_blobs(repo, commits):
    """(commit, path, blob) for each text file a commit adds or modifies, as that commit has it: every file of a
    root commit, and for a merge each file that differs from one of its parents. Deletions, symlinks and
    submodules carry no file content."""
    if not commits:
        return []
    out = subprocess.run(["git", "-C", str(repo), "diff-tree", "--stdin", "-r", "-m", "--root", "--no-renames", "-z"],
                         input="\n".join(commits) + "\n", capture_output=True, text=True, errors="surrogateescape",
                         check=True).stdout
    fields = out.split("\0")
    found, commit, i = [], None, 0
    while i < len(fields):
        field = fields[i]
        i += 1
        if field.startswith(":"):
            _, mode, _, oid, status = field[1:].split()
            path = fields[i]
            i += 1
            if status in ("A", "M", "T") and mode in ("100644", "100755") and TEXT.search(path) and not unchecked(path):
                found.append((commit, path, oid))
        elif field:
            commit = field
    return list(dict.fromkeys(found))


def pre_push(corpus, url, lines, repo, prefix=""):
    """Check every commit a push adds (scripts/git-hooks/pre-push); returns the exit status, 1 on any finding.
    A blob found clean is remembered under the checker's own hash and the corpus head, so a routine push reads
    the corpus only for files it has not seen."""
    updates = push_updates(lines)
    main = remote_main(repo, url, repo / prefix) if updates else None
    if updates and not (main and has_commit(repo, main)):
        print("upstream-overlap: the remote's main is not available here, so every commit behind the pushed tips is checked")
    commits = pushed_commits(repo, updates, main)
    changes = changed_blobs(repo, commits)
    key = hashlib.sha256(Path(__file__).read_bytes() + corpus_head(corpus).encode()).hexdigest()[:16]
    clean = CACHE / f"clean-{key}"

    def marker(oid, path):
        return clean / f"{oid}-{'code' if CODE.search(path) else 'text'}"

    todo = {marker(oid, path): (oid, path) for _, path, oid in changes if not marker(oid, path).exists()}
    found = {}
    if todo:
        cset = corpus_lines(corpus)
        generic = generic_lines(cset, repo)
        cwindows = corpus_windows(corpus)
        texts = read_blobs(repo, sorted({oid for oid, _ in todo.values()}))
        clean.mkdir(parents=True, exist_ok=True)
        for done, (oid, path) in todo.items():
            runs = [(start, end, "line-run") for start, end in line_runs(texts[oid], cset, generic)]
            if CODE.search(path):
                runs += [(start, end, "tokens") for start, end in token_runs(texts[oid], cwindows)]
            if runs:
                found[done] = runs
            else:
                done.touch()
    rows = [(commit, path, start, end, kind) for commit, path, oid in changes
            for start, end, kind in found.get(marker(oid, path), [])]
    print(f"upstream-overlap: {len(rows)} findings in {len({(r[0], r[1]) for r in rows})} files of the "
          f"{len(commits)} commits this push adds ({len(changes)} files they add or modify, {len(todo)} not seen before)")
    for commit, path, start, end, kind in rows:
        print(f"{commit}\t{path}\t{start}-{end}\t{kind}")
    return 1 if rows else 0


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
    ap.add_argument("--pre-push", metavar="URL", help="check the commits of the pre-push input on stdin (the hook)")
    args = ap.parse_args()
    prefix = os.environ.get("GIT_PREFIX", "")  # where the push ran, for a relative remote path
    forget_calling_repository()
    corpus = Path(args.corpus)
    corpus_head(corpus)
    if args.pre_push is not None:
        repo = Path(git(Path.cwd(), "rev-parse", "--show-toplevel").strip())
        sys.exit(pre_push(corpus, args.pre_push, sys.stdin.read().splitlines(), repo, prefix))
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
        if unchecked(path):
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
