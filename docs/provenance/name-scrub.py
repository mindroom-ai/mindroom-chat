#!/usr/bin/env python3
"""One-time history rewrite: remove the name Cinny from paths, file contents and commit messages.

Bas's decision of 2026-11-03: after the build, one rewrite renames the upstream client's name
everywhere except the provenance record (docs/provenance.md and docs/provenance/), which keeps it
because it is what proves the clean-room process.

Usage (in a clone that may be rewritten, never in a checkout other sessions use):

    python3 name-scrub.py [--repo DIR] [--date YYYY-MM-DD] [--refs REF...] [--no-record] [--patch FILE...]

What it does:

  1. Builds the ordered rename rules (RULES below) and the path renames, and checks that no new
     path collides with a path of any commit.
  2. Runs git-filter-repo once over every commit after the signed initial commit (ROOT, which is
     excluded from the rewrite and keeps its hash and signature) on the given refs (default: every
     local branch). No commit is pruned, squashed or added. For every file version:
       - paths: tracked paths are renamed by the rules (the provenance record keeps its paths);
       - contents outside the provenance record: all rules; inside it: only the "all" rules (paths
         and tool names), so the record keeps the name in its prose; docs/provenance/audit/ is
         left byte for byte;
       - commit hashes inside docs/, justfile, AGENTS.md, README.md and NOTICE (never Lane P files)
         are translated to the rewritten commits; in history-rewrite-commit-map.txt only the right
         column; blob ids in history-blanked.tsv are translated to the rewritten blobs;
     and every commit message gets the message rules (git-filter-repo itself translates abbreviated
     commit hashes in messages).
  3. Unless --no-record: commits on top of main the record of the rewrite:
     docs/provenance/rename-map.tsv (path renames and the ordered rules), the commit map
     docs/provenance/name-scrub-commit-map.txt, a copy of this script as
     docs/provenance/name-scrub.py, a paragraph in docs/provenance.md, and scripts/rename_map.py
     with the change to scripts/port_files.py that makes --verify read the rename map (so both
     Lane P imports still verify against MindRoom Chat at their original paths).

  4. Applies each --patch (git format-patch output) with `git am`, as extra commits on top.

The output depends only on the input commits and this script: the rewrite keeps every author,
committer and date, and the record and patch commits take the author, committer and date of the
input tip. Running it on a later main gives the same commits for the shared prefix (filter-repo
writes commits in order and every rule is local to one file version), so commits made after a
first run can be brought over by running it again on the later main (see the procedure in the
record paragraph of docs/provenance.md).

Work files (rules, logs) go to <repo>/.git/name-scrub/.
"""

import argparse
import hashlib
import importlib.util
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = "f31c1b1223db53ee069898601a7de4cb0eaa5d9a"  # signed initial commit; never rewritten
TRIGGER = r"(?i)cinny"
RECORD_FILE = "docs/provenance.md"
RECORD_DIR = "docs/provenance/"
AUDIT_DIR = "docs/provenance/audit/"
COMMIT_MAP_OLD = "docs/provenance/history-rewrite-commit-map.txt"
HISTORY_BLANKED = "docs/provenance/history-blanked.tsv"
HASH_FILES = ("justfile", "AGENTS.md", "README.md", "NOTICE")
ISSUE = "ISSUE"  # CINNY-<n> issue ids become ISSUE-<n> (same length)

# e2e specs named after their issue id get names that say what they test.
SPEC_STEMS = [
    ("cinny001b-root-restore", "root-path-thread-restore"),
    ("cinny001-last-open-thread", "last-open-thread"),
    ("cinny-021-clear-cache", "clear-cache"),
    ("cinny015-thread-exit-scroll", "thread-exit-scroll"),
    ("cinny029-thread-load-button", "thread-load-button"),
    ("cinny030-thread-filter-persistence", "thread-filter-persistence"),
    ("cinny031-focused-room-view", "focused-room-view"),
    ("cinny032-search-result-open-target", "search-result-open-target"),
    ("cinny033-jump-to-latest", "jump-to-latest"),
    ("cinny033-message-permalink-open-target", "message-permalink-open-target"),
    ("cinny034-direct-room-timeline", "direct-room-timeline"),
    ("cinny044-settings-avatar", "settings-avatar"),
    ("cinny060-thread-summary-consistency", "thread-summary-consistency"),
    ("cinny061-thread-summary-cache-upgrade", "thread-summary-cache-upgrade"),
    ("cinny067-thread-send-stability", "thread-send-stability"),
    ("cinny068-fresh-zero-reply-open", "fresh-zero-reply-open"),
    ("cinny069-room-resume-thread-preload", "room-resume-thread-preload"),
    ("cinny070-thread-prepend-scroll", "thread-prepend-scroll"),
    ("cinny071-cached-room-resume", "cached-room-resume"),
    ("cinny073-recent-threads-mobile", "recent-threads-mobile"),
    ("cinny075-reactions", "message-reactions"),
    ("cinny076-classic-view-thread-bubbles", "classic-view-thread-bubbles"),
    ("cinny077-classic-large-room-scroll", "classic-large-room-scroll"),
    ("cinny111-thread-list-overflow", "thread-list-overflow"),
    ("cinny124-flight-recorder", "flight-recorder"),
    ("cinny132-keyboard-viewport", "keyboard-viewport"),
    ("cinny207-background-room-freshness", "background-room-freshness"),
    ("cinny207-gap-fill-restart", "gap-fill-restart"),
    ("cinny207-stale-cache-divergence", "stale-cache-divergence"),
    ("cinny207-stop-emoji-redaction", "stop-emoji-redaction"),
    ("cinny207-streamed-edit-cache", "streamed-edit-cache"),
    ("cinny217-invite-menu-portal", "invite-menu-portal"),
]

# Words after the name that make it a noun ("Cinny owns", "Cinny or ...") rather than an adjective
# ("Cinny clone").
NOT_A_NOUN_NEXT = r"(?:or|and|is|was|has|had|owns|wrote|writes|renders|uses|does|did|keeps|by|in|inside|as|on|to|for|with|from|at|of|itself)\b"


def message_stems() -> list[tuple[str, str, str]]:
    """In commit messages a bare `cinny030` names its spec when the id names only one spec."""
    by_id: dict[str, list[str]] = {}
    for old, new in SPEC_STEMS:
        m = re.match(r"cinny-?(\d+[a-z]?)-", old)
        by_id.setdefault(m.group(1), []).append(new)
    return [("message", rf"\bcinny-?{i}\b(?![-\w])", news[0]) for i, news in sorted(by_id.items()) if len(news) == 1]


def rules() -> list[tuple[str, str, str]]:
    """Ordered (scope, regex, replacement) rules. Scopes: all (everywhere, the provenance record
    included: paths and tool names), message (commit messages only), text (contents outside the
    record and messages)."""
    r: list[tuple[str, str, str]] = []
    # Paths and tool names, also inside the provenance record.
    r += [("all", re.escape(old), new) for old, new in SPEC_STEMS]
    r += [("all", r"cinny-overlap", "upstream-overlap")]
    r += message_stems()
    # Links of the old credit (history only).
    r += [
        ("text", r"//github\.com/ajbura/cinny\b", "//upstream.invalid/source"),
        ("text", r"//cinny\.in\b", "//upstream.invalid"),
    ]
    # The clean-room rules name the forbidden repositories; the record names them now.
    r += [
        ("text", r"Cinny \(`cinnyapp/\*`,", "the upstream client named in `docs/provenance.md` (its GitHub organization,"),
        ("text", r"Cinny \(`cinnyapp/cinny`,", "the upstream client named in `docs/provenance.md` (its repository,"),
        ("text", r"`cinnyapp/[^`]*`", "`upstream`"),
        ("text", r"\bcinnyapp\b", "upstream"),
    ]
    # Protocol and storage identifiers.
    r += [
        ("text", r"\bm\.cinny\.spaces\b", "io.mindroom.spaces"),
        ("text", r"\bio\.cinny\.", "io.mindroom."),
        ("text", r"(?<![A-Za-z0-9])cinny_e2e_", "mindroom_e2e_"),
        # `mindroom_` would make keys such as mindroom_multi_account_store cache-owned.
        ("text", r"(?<![A-Za-z0-9])cinny_", "mindroom_client_"),
    ]
    # Issue ids (CINNY-207, cinny-207, cinny207, CINNY111): same length.
    r += [
        ("text", r"CINNY(?=-?\d)", ISSUE),
        ("text", r"Cinny(?=-\d)", ISSUE.capitalize()),
        ("text", r"cinny(?=-?\d)", ISSUE.lower()),
    ]
    # The design spec names the upstream client through the record (Bas, 2026-11-04).
    r += [("text", r"\bfork of Cinny\b", "fork of the upstream client named in `docs/provenance.md`")]
    # Code comments and test names where the name means this client, not the upstream project.
    r += [
        ("text", r"\bcold Cinny boot\b", "cold client boot"),
        ("text", r"\bfor Cinny live e2e tests\b", "for live e2e tests"),
        ("text", r"\bCinny E2E\b", "MindRoom E2E"),
        ("text", r"\brendering in Cinny\.", "rendering in the client."),
        ("text", r"\(Cinny renders\b", "(the client renders"),
        ("text", r"\bof Cinny's render tree\b", "of the app's render tree"),
        ("text", r"\bCinny-owned\b", "client-owned"),
        ("text", r"\bCinny settings\b", "client settings"),
        ("text", r"\bCinny `settings`", "client `settings`"),
        ("text", r"\bCinny's unversioned\b", "the client's unversioned"),
        ("text", r"\bvs Cinny unresolved\b", "vs client unresolved"),
        ("text", r"\bloads Cinny inside\b", "loads the client inside"),
        ("text", r"\bthe Cinny credit\b", "the upstream client credit"),
    ]
    # Prose elsewhere: "upstream" before a noun, "the upstream client" as a noun.
    r += [
        ("text", r"\b([Tt])he Cinny's\b", r"\1he upstream client's"),
        ("text", r"\bCinny's\b", "the upstream client's"),
        ("text", r"\bCinny-(?=[a-z])", "upstream-"),
        ("text", rf"\b([Tt])he Cinny\b(?= [a-z])(?! {NOT_A_NOUN_NEXT})", r"\1he upstream"),
        ("text", r"\b([Tt])he Cinny\b", r"\1he upstream client"),
        ("text", rf"\b([Aa]) Cinny\b(?= [a-z])(?! {NOT_A_NOUN_NEXT})", r"\1n upstream"),
        ("text", rf"\bCinny\b(?= [a-z])(?! {NOT_A_NOUN_NEXT})", "upstream"),
        ("text", r"\bCinny\b", "the upstream client"),
    ]
    # Identifiers and fixture names (AccountDataEvent.CinnySpaces, __cinnyImageViewer,
    # cinny-e2e-fixture, Pwcinnye2eprimary123!); the last rule catches any other spelling.
    r += [
        ("text", r"Cinny", "Mindroom"),
        ("text", r"CINNY", "MINDROOM"),
        ("text", r"cinny", "mindroom"),
        ("text", r"(?i)cinny", "mindroom"),
    ]
    # Messages first take their own rules, then the text rules: put message rules before text.
    order = {"all": 0, "message": 1, "text": 2}
    return sorted(r, key=lambda row: order[row[0]])


RENAME_MAP_MODULE = '''"""Renames of the name scrub (docs/provenance.md, "Name scrub"), read from docs/provenance/rename-map.tsv.

The map has three tab-separated columns (scope, old, new), applied in file order:
  path     a path before the scrub (also its path in MindRoom Chat) and its path in this repository
  trigger  a regex; only lines matching it are rewritten
  all      regex and replacement (Python re.sub syntax), applied to every file, the provenance record
           included (paths and tool names)
  message  applied to commit messages only
  text     applied to file contents outside the provenance record and to commit messages
Rules apply line by line, so line numbers never change. docs/provenance/audit/ was left unchanged.
scripts/port_files.py uses it to reproduce the Lane P imports from MindRoom Chat.
"""

import re
from pathlib import Path

MAP_FILE = Path(__file__).resolve().parent.parent / "docs" / "provenance" / "rename-map.tsv"


def is_record(path: str) -> bool:
    return path == "docs/provenance.md" or path.startswith("docs/provenance/")


class RenameMap:
    def __init__(self, file: Path = MAP_FILE) -> None:
        self.paths: dict[str, str] = {}
        self.trigger: re.Pattern[str] | None = None
        self.rules: list[tuple[str, re.Pattern[str], str]] = []
        rows = file.read_text().splitlines() if file.is_file() else []
        for row in rows:
            if not row or row.startswith("#") or row.startswith("scope\\t"):
                continue
            scope, old, new = row.split("\\t")
            if scope == "path":
                self.paths[old] = new
            elif scope == "trigger":
                self.trigger = re.compile(old)
            else:
                self.rules.append((scope, re.compile(old), new))
        self.sources = {new: old for old, new in self.paths.items()}

    def source_path(self, path: str) -> str:
        """The path before the scrub (in MindRoom Chat) of a path in this repository."""
        return self.sources.get(path, path)

    def apply(self, text: str, scopes: set[str]) -> str:
        if self.trigger is None or not self.trigger.search(text):
            return text
        rules = [(pattern, new) for scope, pattern, new in self.rules if scope in scopes]
        lines = text.split("\\n")
        for index, line in enumerate(lines):
            if self.trigger.search(line):
                for pattern, new in rules:
                    line = pattern.sub(new, line)
                lines[index] = line
        return "\\n".join(lines)

    def content(self, text: str, path: str = "") -> str:
        """File contents as the scrub rewrote them (`path` decides whether it is the record)."""
        return self.apply(text, {"all"} if is_record(path) else {"all", "text"})

    def message(self, text: str) -> str:
        return self.apply(text, {"all", "message", "text"})
'''

PORT_FILES_DOC_OLD = '''blanked in every commit by the history rewrite of 2026-11-03. A new import must rerun that check
on its output and blank what it reports.
"""'''
PORT_FILES_DOC_NEW = '''blanked in every commit by the history rewrite of 2026-11-03. A new import must rerun that check
on its output and blank what it reports.

Paths in the portable lists are this repository's paths. docs/provenance/rename-map.tsv (the name
scrub, read through scripts/rename_map.py) maps a renamed path back to its path in the checkout,
and the copied text goes through the same rules the scrub applied to the import commits.
"""'''
PORT_FILES_EDITS = [
    (
        'PROV = REPO / "docs" / "provenance"\n',
        'PROV = REPO / "docs" / "provenance"\n\nsys.path.insert(0, str(Path(__file__).resolve().parent))\n'
        'from rename_map import RenameMap  # noqa: E402\n\nNAMES = RenameMap()\n',
    ),
    (
        "    authors = blame_authors(chat, commit, path)\n    lines = source_lines(chat, commit, path)\n",
        "    source = NAMES.source_path(path)\n    authors = blame_authors(chat, commit, source)\n"
        "    lines = source_lines(chat, commit, source)\n",
    ),
    ('    return "\\n".join(lines), holes\n', '    return NAMES.content("\\n".join(lines)), holes\n'),
    ('["git", "-C", str(chat), "rev-parse", f"{commit}:{path}"]', '["git", "-C", str(chat), "rev-parse", f"{commit}:{NAMES.source_path(path)}"]'),
    ('"--format=%ae", commit, "--", path]', '"--format=%ae", commit, "--", NAMES.source_path(path)]'),
]


def git(repo: Path, *args: str, check: bool = True) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=check).stdout


def load_module(work: Path):
    module_file = work / "rename_map.py"
    module_file.write_text(RENAME_MAP_MODULE)
    spec = importlib.util.spec_from_file_location("rename_map", module_file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_map(file: Path, path_rows: list[tuple[str, str]], date: str) -> None:
    lines = [
        f"# Name scrub of {date} (docs/provenance.md, \"Name scrub\"). Columns: scope, old, new. Rules apply in",
        "# this order, line by line, to lines matching the trigger (Python re syntax); see scripts/rename_map.py.",
        "scope\told\tnew",
        f"trigger\t{TRIGGER}\t",
    ]
    lines += [f"path\t{old}\t{new}" for old, new in path_rows]
    for scope, pattern, new in rules():
        assert "\t" not in pattern + new and "\n" not in pattern + new
        lines.append(f"{scope}\t{pattern}\t{new}")
    file.write_text("\n".join(lines) + "\n")


def is_record(path: str) -> bool:
    return path == RECORD_FILE or path.startswith(RECORD_DIR)


def lane_p_paths(repo: Path, ref: str) -> set[str]:
    found = set()
    for name in ("portable.tsv", "portable-wave2.tsv", "portable-wave3.tsv"):
        text = git(repo, "show", f"{ref}:docs/provenance/{name}", check=False)
        found |= {row.split("\t")[0] for row in text.splitlines() if row}
    return found


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--repo", default=".")
    ap.add_argument("--date", help="date in the record (default: the committer date of the input tip)")
    ap.add_argument("--refs", nargs="+", help="refs to rewrite (default: every local branch)")
    ap.add_argument("--no-record", action="store_true", help="skip the record commits on main")
    ap.add_argument("--patch", nargs="*", default=[], help="git format-patch files to apply on top, in order")
    args = ap.parse_args()
    repo = Path(args.repo).resolve()
    work = Path(git(repo, "rev-parse", "--absolute-git-dir").strip()) / "name-scrub"
    work.mkdir(exist_ok=True)
    names = load_module(work)

    if git(repo, "status", "--porcelain", "--untracked-files=no").strip():
        raise SystemExit("scrub: the working tree has changes to tracked files")
    refs = args.refs or git(repo, "for-each-ref", "--format=%(refname)", "refs/heads/").split()
    roots = set(git(repo, "rev-list", "--max-parents=0", *refs).split())
    if roots != {ROOT}:
        raise SystemExit(f"scrub: expected the single root {ROOT}, found {sorted(roots)}")
    others = [r for r in git(repo, "for-each-ref", "--format=%(refname)").split() if r not in refs]
    if others:
        print("scrub: not rewritten (delete them, or `git log --all` keeps the old history):", *others, sep="\n  ")

    # Path renames over every path any rewritten commit has.
    all_paths = set(git(repo, "log", "--format=", "--name-only", *refs).split("\n")) - {""}
    renames = {}
    for path in sorted(all_paths):
        if is_record(path) or not re.search(TRIGGER, path):
            continue
        renames[path] = None
    # Build the rule table once to rename paths with the same rules as contents.
    write_map(work / "rename-map.tsv", [], args.date)
    rmap = names.RenameMap(work / "rename-map.tsv")
    for path in renames:
        renames[path] = rmap.apply(path, {"all", "text"})
        if re.search(TRIGGER, renames[path]):
            raise SystemExit(f"scrub: {path} keeps the name after renaming")
    clashes = sorted({new for new in renames.values()} & all_paths)
    if clashes or len(set(renames.values())) != len(renames):
        raise SystemExit(f"scrub: renamed paths collide: {clashes}")
    write_map(work / "rename-map.tsv", sorted(renames.items()), args.date)
    rmap = names.RenameMap(work / "rename-map.tsv")

    tip = refs[0] if "refs/heads/main" not in refs else "refs/heads/main"
    # Hash translation skips Lane P files; none lives where hashes are translated. Checked here
    # instead of passed to the transform, so the output of a commit never depends on the tip.
    lane_p = {renames.get(p, p) for p in lane_p_paths(repo, tip)}
    if any(p.startswith("docs/") or p in HASH_FILES for p in lane_p):
        raise SystemExit("scrub: a Lane P file is in docs/ or a hash file; the hash translation would touch it")
    # Record and patch commits: identity and date of the input tip, so reruns give the same hashes.
    ident = git(repo, "log", "-1", "--format=%cn%n%ce%n%cI", tip).split("\n")
    env = {**os.environ, "GIT_AUTHOR_NAME": ident[0], "GIT_AUTHOR_EMAIL": ident[1], "GIT_AUTHOR_DATE": ident[2],
           "GIT_COMMITTER_NAME": ident[0], "GIT_COMMITTER_EMAIL": ident[1], "GIT_COMMITTER_DATE": ident[2]}
    args.date = args.date or ident[2][:10]
    write_map(work / "rename-map.tsv", sorted(renames.items()), args.date)

    try:
        import git_filter_repo as fr
    except ImportError:
        found = subprocess.run(["sh", "-c", "readlink -f $(command -v git-filter-repo)"], capture_output=True, text=True).stdout.strip()
        store = Path(found).parents[1]
        sys.path[:0] = [str(p.parent) for p in store.glob("lib/python*/site-packages/git_filter_repo.py")]
        import git_filter_repo as fr

    log = {"translated": [], "blobs": {}}
    hex_re = re.compile(r"\b[0-9a-f]{7,40}\b")
    state: dict[str, object] = {}

    def translate_hash(token: str, path: str) -> str:
        new = state["filter"]._translate_commit_hash(token.encode()).decode()
        if new != token:
            log["translated"].append((path, token, new))
        return new

    def transform(data: bytes, path: str, value) -> bytes:
        text = data.decode("utf-8", "surrogateescape")
        new = rmap.content(text, path)
        if path == HISTORY_BLANKED:
            new = "\n".join(blanked_row(row, value) for row in new.split("\n"))
        elif path == COMMIT_MAP_OLD:
            rows = []
            for row in new.split("\n"):
                parts = row.split(" ")
                if len(parts) == 2 and not row.startswith("#"):
                    row = f"{parts[0]} {hex_re.sub(lambda m: translate_hash(m.group(0), path), parts[1])}"
                rows.append(row)
            new = "\n".join(rows)
        elif path.startswith("docs/") or path in HASH_FILES:
            new = hex_re.sub(lambda m: translate_hash(m.group(0), path), new)
        if not is_record(path) and re.search(TRIGGER, new):
            raise SystemExit(f"scrub: {path} keeps the name")
        return new.encode("utf-8", "surrogateescape")

    def new_blob(oid: str, path: str, value) -> str:
        if oid not in log["blobs"]:
            data = value.get_contents_by_identifier(oid.encode())
            out = transform(data, path, value) if data is not None and not value.is_binary(data) else data
            log["blobs"][oid] = oid if out == data else hashlib.sha1(b"blob %d\0" % len(out) + out).hexdigest()
        return log["blobs"][oid]

    def blanked_row(row: str, value) -> str:
        parts = row.split("\t")
        if len(parts) == 3 and re.fullmatch(r"[0-9a-f]{40}", parts[0]):
            parts[0] = new_blob(parts[0], parts[1], value)
        return "\t".join(parts)

    def filename_callback(filename: bytes) -> bytes:
        path = filename.decode("utf-8", "surrogateescape")
        return renames.get(path, path).encode("utf-8", "surrogateescape")

    cache: dict[tuple[bytes, bytes], bytes] = {}

    def file_info_callback(filename, mode, blob_id, value):
        path = filename.decode("utf-8", "surrogateescape")
        if mode == b"160000" or path.startswith(AUDIT_DIR):
            return (filename, mode, blob_id)
        key = (blob_id, filename)
        if key not in cache:
            data = value.get_contents_by_identifier(blob_id)
            if data is None or value.is_binary(data):
                cache[key] = blob_id
            else:
                out = transform(data, path, value)
                cache[key] = blob_id if out == data else value.insert_file_with_contents(out)
        return (filename, mode, cache[key])

    def message_callback(message: bytes) -> bytes:
        text = rmap.message(message.decode("utf-8", "surrogateescape"))
        if re.search(TRIGGER, text):
            raise SystemExit("scrub: a commit message keeps the name")
        return text.encode("utf-8", "surrogateescape")

    fr_args = fr.FilteringOptions.parse_args(
        ["--force", "--prune-empty", "never", "--prune-degenerate", "never", "--refs", *refs, f"^{ROOT}"]
    )
    state["filter"] = fr.RepoFilter(
        fr_args, filename_callback=filename_callback, file_info_callback=file_info_callback, message_callback=message_callback
    )
    before = {r: git(repo, "rev-parse", r).strip() for r in refs}
    count_before = len(git(repo, "rev-list", *before.values()).split())
    state["filter"].run()

    # Checks.
    if git(repo, "rev-list", "--max-parents=0", *refs).split() != [ROOT]:
        raise SystemExit("scrub: the root commit changed")
    count_after = len(git(repo, "rev-list", *refs).split())
    if count_after != count_before:
        raise SystemExit(f"scrub: {count_before} commits before, {count_after} after")
    commit_map = (Path(git(repo, "rev-parse", "--absolute-git-dir").strip()) / "filter-repo" / "commit-map").read_text()
    pairs = [row.split() for row in commit_map.splitlines()[1:] if row.strip()]
    (work / "translated.tsv").write_text("".join(f"{p}\t{o}\t{n}\n" for p, o, n in log["translated"]))
    (work / "blob-map.tsv").write_text("".join(f"{o}\t{n}\n" for o, n in sorted(log["blobs"].items()) if o != n))
    print(f"scrub: rewrote {len(pairs)} commits on {len(refs)} refs; root {ROOT[:7]} kept; "
          f"{len(renames)} paths renamed; {len(log['translated'])} hash references translated")

    if args.no_record:
        return
    git(repo, "checkout", "-q", "main")
    git(repo, "reset", "-q", "--hard", "main")
    prov = repo / "docs" / "provenance"
    shutil.copy(work / "rename-map.tsv", prov / "rename-map.tsv")
    shutil.copy(Path(__file__).resolve(), prov / "name-scrub.py")
    (prov / "name-scrub.py").chmod(0o755)
    (prov / "name-scrub-commit-map.txt").write_text(
        f"# Old commit (before the name scrub of {args.date}) -> new commit. Old commits are kept only in a private backup bundle.\n"
        + "".join(f"{old} {new}\n" for old, new in sorted(pairs))
    )
    (repo / "scripts" / "rename_map.py").write_text(RENAME_MAP_MODULE)
    port = repo / "scripts" / "port_files.py"
    source = port.read_text()
    for old, new in [(PORT_FILES_DOC_OLD, PORT_FILES_DOC_NEW), *PORT_FILES_EDITS]:
        if source.count(old) != 1:
            raise SystemExit(f"scrub: scripts/port_files.py changed; cannot find {old!r}")
        source = source.replace(old, new)
    port.write_text(source)
    record = repo / RECORD_FILE
    text = record.read_text()
    heading = "\n## Cinny overlap check\n"
    if text.count(heading) != 1:
        raise SystemExit("scrub: docs/provenance.md has no Cinny overlap check heading")
    paragraph = (
        "\n## Name scrub\n\n"
        "Bas's decision of 2026-11-03: the name Cinny appears only in this provenance record (`docs/provenance.md` "
        "and `docs/provenance/`), which needs it to describe the clean-room process. The rewrite of "
        f"{args.date} (`docs/provenance/name-scrub.py`, git-filter-repo) renamed it in the paths, file contents and "
        f"messages of every commit after the signed initial commit `{ROOT[:7]}`, which is unchanged; every commit "
        "was kept, none squashed or pruned. Issue ids `CINNY-<n>` became `ISSUE-<n>`, e2e specs named after them got "
        "names that say what they test, `scripts/cinny-overlap/` became `scripts/upstream-overlap/`, storage keys and "
        "account data types got MindRoom names (`m.cinny.spaces` is `io.mindroom.spaces`, `cinny_*` keys are "
        "`mindroom_client_*`), and prose calls Cinny \"the upstream client\". In the record only paths and tool names "
        "changed; `docs/provenance/audit/` is untouched. `docs/provenance/rename-map.tsv` lists the path renames and "
        "the ordered rules; `scripts/port_files.py` applies it (`scripts/rename_map.py`), so every import wave still "
        "verifies against MindRoom Chat `fc3a5905` at its original paths. Commit hashes in `docs/`, `justfile`, "
        "`AGENTS.md`, `README.md` and `NOTICE`, and blob ids in `history-blanked.tsv`, name the rewritten objects; "
        "`docs/provenance/name-scrub-commit-map.txt` maps each old commit to its new one, and the old commits are "
        "kept only in a private backup bundle. The output depends only on the input commits and the script, so a "
        "commit made on the old history after the rewrite is brought over by running the script with `--no-record` "
        "on that later history (its shared commits come out with the same hashes) and cherry-picking the rewritten "
        "new commits.\n"
    )
    text = text.replace(heading, paragraph + "\n## Upstream overlap check\n")
    record.write_text(text)
    files = [
        "docs/provenance/rename-map.tsv",
        "docs/provenance/name-scrub.py",
        "docs/provenance/name-scrub-commit-map.txt",
        RECORD_FILE,
        "scripts/rename_map.py",
        "scripts/port_files.py",
    ]
    git(repo, "add", "--", *files)
    subprocess.run(
        ["git", "-C", str(repo), "-c", "commit.gpgsign=false", "commit", "-q", "-m",
         "docs(provenance): record the name scrub; port_files.py verifies through the rename map", "--", *files],
        check=True, env=env,
    )
    print("scrub: record commit", git(repo, "rev-parse", "--short", "HEAD").strip())

    # The comment beside the account data type explained why it kept the old name; it no longer does.
    data = repo / "src" / "types" / "matrix" / "accountData.ts"
    stale = "  // The sidebar's space order and folders, kept under the key existing accounts already use.\n"
    text = data.read_text() if data.is_file() else ""
    if text.count(stale) == 1:
        data.write_text(text.replace(stale, "  // The sidebar's space order and folders.\n"))
        subprocess.run(
            ["git", "-C", str(repo), "-c", "commit.gpgsign=false", "commit", "-q", "-m",
             "docs(sidebar): the space order account data type has its own name now", "--", "src/types/matrix/accountData.ts"],
            check=True, env=env,
        )
        print("scrub: comment commit", git(repo, "rev-parse", "--short", "HEAD").strip())
    else:
        print("scrub: src/types/matrix/accountData.ts no longer has the old comment; nothing to fix")

    for patch in args.patch:
        subprocess.run(
            ["git", "-C", str(repo), "-c", "commit.gpgsign=false", "am", "-q", "--3way", "--committer-date-is-author-date",
             str(Path(patch).resolve())],
            check=True, env=env,
        )
        if re.search(TRIGGER, git(repo, "show", "--format=%B", "HEAD", "--", ".", ":!docs/provenance.md", ":!docs/provenance/")):
            raise SystemExit(f"scrub: {patch} brings the name back")
        print("scrub: patch commit", git(repo, "rev-parse", "--short", "HEAD").strip(), Path(patch).name)


if __name__ == "__main__":
    main()
