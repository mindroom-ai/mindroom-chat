"""Tests of check.py's pre-push mode and the pre-push hook (scripts/git-hooks/): which commits a push adds,
which file versions those commits carry, and that the hook blocks any push with a finding.

The corpus is a made-up upstream repository built here; no upstream file is read. Each test keeps the checker's
cache in its own temporary directory (XDG_CACHE_HOME).
"""

from __future__ import annotations

import hashlib
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import check  # noqa: E402

INSTALL = HERE.parent / "git-hooks" / "install.sh"
GIT_ENV = {
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "Test Author",
    "GIT_AUTHOR_EMAIL": "author@example.invalid",
    "GIT_COMMITTER_NAME": "Test Author",
    "GIT_COMMITTER_EMAIL": "author@example.invalid",
    "GIT_AUTHOR_DATE": "2026-01-01T00:00:00+0000",
    "GIT_COMMITTER_DATE": "2026-01-01T00:00:00+0000",
    "GIT_TERMINAL_PROMPT": "0",
}
# The made-up upstream file. COPIED is three of its lines, the smallest run the check reports.
UPSTREAM = """export function heronLimit(colour: string): number {
  const amberHeronLimit = computeHeronLimit(4817, colour);
  const violetFinchOffset = amberHeronLimit * 37 + colour.length;
  registerFinchOffset(violetFinchOffset, { heron: amberHeronLimit });
  return violetFinchOffset;
}
"""
COPIED = "".join(UPSTREAM.splitlines(keepends=True)[1:4])
# A made-up upstream file that the corpus gains later, and three of its lines.
LATER_UPSTREAM = """export function finchTally(season: string): number {
  const copperFinchTally = countFinchTally(9203, season);
  const indigoHeronShift = copperFinchTally * 53 + season.length;
  recordHeronShift(indigoHeronShift, { finch: copperFinchTally });
  return indigoHeronShift;
}
"""
LATER_COPIED = "".join(LATER_UPSTREAM.splitlines(keepends=True)[1:4])
CLEAN = "export const quietMeadow = 'a line of our own, written for this test';\n"
OWN_CODE = CLEAN + "".join(f"export const meadowRow{i} = quietMeadow.length * {i} + 'row {i}'.length;\n" for i in range(6))
ZERO = "0" * 40
patched_env = mock.patch.dict(os.environ, GIT_ENV)


def setUpModule() -> None:
    patched_env.start()


def tearDownModule() -> None:
    patched_env.stop()


def run(cwd: Path, *args: str, check: bool = True, **kwargs) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=check, **kwargs)


def git(cwd: Path, *args: str) -> str:
    return run(cwd, "git", *args).stdout.strip()


def commit(repo: Path, files: dict[str, str | None], message: str) -> str:
    """Write (or, for None, delete) each file and commit; returns the commit."""
    for path, content in files.items():
        if content is None:
            git(repo, "rm", "-q", path)
            continue
        (repo / path).parent.mkdir(parents=True, exist_ok=True)
        (repo / path).write_text(content)
        git(repo, "add", path)
    git(repo, "commit", "-q", "--allow-empty", "-m", message)
    return git(repo, "rev-parse", "HEAD")


def new_repo(path: Path) -> Path:
    path.mkdir(parents=True)
    git(path, "init", "-q", "--template=", "-b", "main")
    (path / "node_modules").mkdir()  # the generic lines of the made-up corpus: none
    return path


def bare_remote(path: Path, seed: Path) -> Path:
    """A bare repository whose main is seed's main (fetched: nothing is pushed while setting up)."""
    run(path.parent, "git", "init", "-q", "--bare", "--template=", "-b", "main", str(path))
    run(path, "git", "fetch", "-q", str(seed), "refs/heads/main:refs/heads/main")
    return path


class Fixture(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="overlap-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        patcher = mock.patch.dict(os.environ, {"XDG_CACHE_HOME": str(self.tmp / "user-cache")})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.corpus = new_repo(self.tmp / "corpus")
        commit(self.corpus, {"src/app/heron.ts": UPSTREAM}, "made-up upstream file")
        self.repo = new_repo(self.tmp / "client")
        self.base = commit(self.repo, {"src/app/meadow.ts": CLEAN, "README.md": "# Fixture client\n"}, "base")
        self.remote = bare_remote(self.tmp / "remote.git", self.repo)
        git(self.repo, "checkout", "-q", "-b", "work")


class PushUpdatesTests(unittest.TestCase):
    def test_new_updated_and_deleted_refs(self) -> None:
        lines = [
            f"refs/heads/new {'a' * 40} refs/heads/new {ZERO}",
            f"refs/heads/old {'b' * 40} refs/heads/old {'c' * 40}",
            f"(delete) {ZERO} refs/heads/gone {'d' * 40}",
            "",
        ]
        self.assertEqual(check.push_updates(lines), [("a" * 40, None), ("b" * 40, "c" * 40)])

    def test_a_line_it_cannot_read_fails(self) -> None:
        with self.assertRaises(ValueError):
            check.push_updates(["refs/heads/x abc"])


class CommitSelectionTests(Fixture):
    def setUp(self) -> None:
        super().setUp()
        self.b1 = commit(self.repo, {"a.ts": "one\n"}, "b1")
        self.b2 = commit(self.repo, {"a.ts": "two\n"}, "b2")

    def test_a_new_branch_adds_what_main_lacks_oldest_first(self) -> None:
        self.assertEqual(check.pushed_commits(self.repo, [(self.b2, None)], self.base), [self.b1, self.b2])

    def test_an_update_adds_what_follows_the_remote_tip(self) -> None:
        self.assertEqual(check.pushed_commits(self.repo, [(self.b2, self.b1)], self.base), [self.b2])

    def test_bases_this_clone_lacks_leave_nothing_out(self) -> None:
        unknown = "e" * 40
        self.assertEqual(check.pushed_commits(self.repo, [(self.b2, unknown)], self.base), [self.b1, self.b2])
        self.assertEqual(check.pushed_commits(self.repo, [(self.b2, unknown)], unknown), [self.base, self.b1, self.b2])

    def test_without_a_main_every_commit_counts(self) -> None:
        self.assertEqual(check.pushed_commits(self.repo, [(self.b2, None)], None), [self.base, self.b1, self.b2])

    def test_refs_that_share_commits_list_each_commit_once(self) -> None:
        self.assertEqual(check.pushed_commits(self.repo, [(self.b1, None), (self.b2, None)], self.base), [self.b1, self.b2])

    def test_the_remote_main_is_read_from_the_remote(self) -> None:
        self.assertEqual(check.remote_main(self.repo, str(self.remote), self.repo), self.base)
        self.assertIsNone(check.remote_main(self.repo, str(self.tmp / "missing.git"), self.repo))

    def test_a_remote_main_this_clone_lacks_is_fetched_without_touching_refs(self) -> None:
        other = self.tmp / "other"
        run(self.tmp, "git", "clone", "-q", "--template=", str(self.remote), str(other))
        later = commit(other, {"src/app/later.ts": "later\n"}, "main moves on")
        run(self.remote, "git", "fetch", "-q", str(other), "refs/heads/main:refs/heads/main")
        refs = git(self.repo, "for-each-ref")
        self.assertFalse(check.has_commit(self.repo, later))
        self.assertEqual(check.remote_main(self.repo, str(self.remote), self.repo), later)
        self.assertTrue(check.has_commit(self.repo, later))
        self.assertEqual(git(self.repo, "for-each-ref"), refs)
        self.assertFalse((self.repo / ".git" / "FETCH_HEAD").exists())
        self.assertEqual(check.pushed_commits(self.repo, [(self.b2, None)], later), [self.b1, self.b2])


class BlobSelectionTests(Fixture):
    def blob(self, rev: str, path: str) -> str:
        return git(self.repo, "rev-parse", f"{rev}:{path}")

    def changes(self, commits: list[str]) -> set[tuple[str, str, str]]:
        return set(check.changed_blobs(self.repo, commits))

    def test_the_root_commit_brings_every_text_file(self) -> None:
        self.assertEqual(self.changes([self.base]), {
            (self.base, "src/app/meadow.ts", self.blob(self.base, "src/app/meadow.ts")),
            (self.base, "README.md", self.blob(self.base, "README.md")),
        })

    def test_added_and_modified_files_count_and_deleted_ones_do_not(self) -> None:
        c1 = commit(self.repo, {"src/app/new.ts": "new\n", "src/app/meadow.ts": CLEAN + "more\n", "README.md": None}, "c1")
        self.assertEqual(self.changes([c1]), {
            (c1, "src/app/new.ts", self.blob(c1, "src/app/new.ts")),
            (c1, "src/app/meadow.ts", self.blob(c1, "src/app/meadow.ts")),
        })

    def test_a_rename_brings_its_new_path(self) -> None:
        git(self.repo, "mv", "src/app/meadow.ts", "src/app/field.ts")
        c1 = commit(self.repo, {}, "rename")
        self.assertEqual(self.changes([c1]), {(c1, "src/app/field.ts", self.blob(c1, "src/app/field.ts"))})

    def test_binary_package_and_symlink_files_are_left_out(self) -> None:
        (self.repo / "link.ts").symlink_to("src/app/meadow.ts")
        git(self.repo, "add", "link.ts")
        c1 = commit(self.repo, {"logo.png": "not text\n", "package.json": "{}\n", "sub/package-lock.json": "{}\n"}, "c1")
        self.assertEqual(self.changes([c1]), set())

    def test_a_merge_brings_what_it_resolved(self) -> None:
        side = commit(self.repo, {"src/app/meadow.ts": "side\n"}, "side")
        git(self.repo, "checkout", "-q", "-b", "other", self.base)
        other = commit(self.repo, {"src/app/meadow.ts": "other\n"}, "other")
        run(self.repo, "git", "merge", "-q", "work", check=False)
        merge = commit(self.repo, {"src/app/meadow.ts": "resolved\n"}, "merge")
        self.assertEqual(git(self.repo, "rev-list", "--parents", "-n1", merge).split(), [merge, other, side])
        resolved = self.blob(merge, "src/app/meadow.ts")
        self.assertEqual(self.changes([merge]), {(merge, "src/app/meadow.ts", resolved)})


class PrePushTests(Fixture):
    def setUp(self) -> None:
        super().setUp()
        # The cache a check.py process of this test would use (XDG_CACHE_HOME, set by Fixture).
        patcher = mock.patch.object(check, "CACHE", self.tmp / "user-cache" / "upstream-overlap")
        patcher.start()
        self.addCleanup(patcher.stop)

    def push(self, tip: str, remote: str = ZERO) -> tuple[int, str]:
        out = io.StringIO()
        with mock.patch("sys.stdout", out):
            status = check.pre_push(self.corpus, str(self.remote), [f"refs/heads/work {tip} refs/heads/work {remote}"],
                                    self.repo)
        return status, out.getvalue()

    def run_checker(self, tip: str, corpus: Path | None = None, **env: str) -> subprocess.CompletedProcess[str]:
        """check.py --pre-push in a process of its own, as the hook runs it."""
        return run(self.repo, sys.executable, str(HERE / "check.py"), "--corpus", str(corpus or self.corpus),
                   "--pre-push", str(self.remote), input=f"refs/heads/work {tip} refs/heads/work {ZERO}\n",
                   check=False, env={**os.environ, **env})

    def test_a_commit_with_three_upstream_lines_is_reported_by_commit_file_and_lines(self) -> None:
        bad = commit(self.repo, {"src/app/copy.ts": COPIED + CLEAN}, "copy")
        status, out = self.push(bad)
        self.assertEqual(status, 1)
        self.assertIn(f"{bad}\tsrc/app/copy.ts\t1-3\tline-run", out)
        self.assertIn(f"{bad}\tsrc/app/copy.ts\t1-3\ttokens", out)

    def test_a_clean_commit_passes(self) -> None:
        status, out = self.push(commit(self.repo, {"src/app/own.ts": CLEAN + "export const two = 2;\n"}, "clean"))
        self.assertEqual(status, 0, out)
        self.assertIn("0 findings", out)

    def test_a_later_commit_that_deletes_the_lines_does_not_clear_the_earlier_one(self) -> None:
        bad = commit(self.repo, {"notes.md": "Notes\n\n" + COPIED}, "copy")
        fixed = commit(self.repo, {"notes.md": "Notes\n"}, "remove the copy")
        status, out = self.push(fixed)
        self.assertEqual(status, 1)
        self.assertIn(f"{bad}\tnotes.md\t3-5\tline-run", out)
        self.assertNotIn(fixed, out)

    def test_commits_the_remote_has_are_not_checked_again(self) -> None:
        bad = commit(self.repo, {"src/app/copy.ts": COPIED}, "copy")
        clean = commit(self.repo, {"src/app/own.ts": CLEAN}, "clean")
        self.assertEqual(self.push(clean, remote=bad)[0], 0)

    def test_the_commit_is_read_not_the_working_tree(self) -> None:
        clean = commit(self.repo, {"src/app/own.ts": CLEAN}, "clean")
        (self.repo / "src/app/own.ts").write_text(COPIED)
        self.assertEqual(self.push(clean)[0], 0)
        bad = commit(self.repo, {"src/app/copy.ts": COPIED}, "copy")
        (self.repo / "src/app/copy.ts").write_text(CLEAN)
        self.assertEqual(self.push(bad)[0], 1)

    def test_a_blob_found_clean_is_not_checked_again(self) -> None:
        clean = commit(self.repo, {"src/app/own.ts": CLEAN}, "clean")
        self.assertEqual(self.push(clean)[0], 0)
        with mock.patch.object(check, "corpus_lines", side_effect=AssertionError("corpus read again")):
            status, out = self.push(clean)
        self.assertEqual(status, 0)
        self.assertIn("0 not seen before", out)

    def test_lines_a_later_corpus_branch_gains_are_found_in_a_file_checked_before(self) -> None:
        git(self.corpus, "branch", "release")  # sorts after main, which stays the corpus's first ref
        copy = commit(self.repo, {"src/app/finch.ts": LATER_COPIED}, "copy")
        self.assertEqual(self.push(copy)[0], 0, "the corpus lacks the lines yet")
        git(self.corpus, "checkout", "-q", "release")
        commit(self.corpus, {"src/app/finch.ts": LATER_UPSTREAM}, "a later upstream file")
        status, out = self.push(copy)
        self.assertEqual(status, 1, out)
        self.assertIn(f"{copy}\tsrc/app/finch.ts\t1-3\tline-run", out)
        self.assertIn(f"{copy}\tsrc/app/finch.ts\t1-3\ttokens", out)

    def test_a_commit_on_a_detached_corpus_head_changes_the_cache_key(self) -> None:
        before = check.corpus_version(self.corpus)
        git(self.corpus, "checkout", "-q", "--detach")
        commit(self.corpus, {"src/app/finch.ts": LATER_UPSTREAM}, "a later upstream file on a detached HEAD")
        self.assertNotEqual(check.corpus_version(self.corpus), before)

    def test_findings_are_not_remembered_as_clean(self) -> None:
        bad = commit(self.repo, {"src/app/copy.ts": COPIED}, "copy")
        self.assertEqual(self.push(bad)[0], 1)
        self.assertEqual(self.push(bad)[0], 1)

    def test_the_pushing_repository_s_git_variables_do_not_redirect_the_corpus(self) -> None:
        # Git exports GIT_DIR to a hook run from a linked worktree; `git -C <corpus>` would then read this repository.
        tip = commit(self.repo, {"src/app/own.ts": OWN_CODE}, "clean")
        result = self.run_checker(tip, GIT_DIR=str(self.repo / ".git"))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_a_missing_corpus_fails_and_says_why(self) -> None:
        tip = commit(self.repo, {"src/app/own.ts": CLEAN}, "clean")
        result = self.run_checker(tip, self.tmp / "nowhere")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("is not a git clone of the upstream client", result.stderr)

    def test_the_cache_is_the_users_own_whatever_the_temporary_directory_holds(self) -> None:
        bad = commit(self.repo, {"src/app/copy.ts": COPIED}, "copy")
        temporary = self.tmp / "temporary"
        key = hashlib.sha256((HERE / "check.py").read_bytes() + check.corpus_version(self.corpus).encode()).hexdigest()[:16]
        blob = git(self.repo, "rev-parse", f"{bad}:src/app/copy.ts")
        marker = temporary / "upstream-overlap-cache" / f"clean-{key}" / f"{blob}-code"
        marker.parent.mkdir(parents=True)
        marker.touch()
        with mock.patch.object(check, "CACHE", marker.parents[1]):
            self.assertEqual(self.push(bad)[0], 0, "the planted marker is one the checker reads from its cache")
        result = self.run_checker(bad, TMPDIR=str(temporary))
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(f"{bad}\tsrc/app/copy.ts\t1-3\tline-run", result.stdout)
        self.assertEqual(check.CACHE.stat().st_mode & 0o777, 0o700)

    def test_a_missing_cache_directory_and_its_missing_parents_are_the_owners_only_whatever_the_umask(self) -> None:
        home = self.tmp / "home"
        home.mkdir()
        home.chmod(0o755)
        self.addCleanup(os.umask, os.umask(0o002))
        tip = commit(self.repo, {"src/app/own.ts": CLEAN}, "clean")
        result = self.run_checker(tip, HOME=str(home), XDG_CACHE_HOME="")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((home / ".cache").stat().st_mode & 0o777, 0o700)
        self.assertEqual((home / ".cache" / "upstream-overlap").stat().st_mode & 0o777, 0o700)
        self.assertEqual(home.stat().st_mode & 0o777, 0o755, "a parent that was there stays as it was")

    def test_a_relative_cache_home_is_ignored_so_upstream_lines_never_land_in_the_checkout(self) -> None:
        home = self.tmp / "home"
        home.mkdir()
        tip = commit(self.repo, {"src/app/own.ts": CLEAN}, "clean")
        result = self.run_checker(tip, HOME=str(home), XDG_CACHE_HOME="rel")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((home / ".cache" / "upstream-overlap").is_dir())
        self.assertFalse((self.repo / "rel").exists())


class HookTests(Fixture):
    """The installed hook on real pushes to a local bare repository."""

    def install(self, corpus: Path | None = None) -> subprocess.CompletedProcess[str]:
        return run(self.repo, "bash", str(INSTALL), "--corpus", str(corpus or self.corpus), str(self.repo), check=False)

    def push(self, branch: str, **env: str) -> subprocess.CompletedProcess[str]:
        return run(self.repo, "git", "push", str(self.remote), f"HEAD:refs/heads/{branch}", check=False,
                   env={**os.environ, **env})

    def on_remote(self, branch: str) -> bool:
        return run(self.remote, "git", "rev-parse", "--verify", "-q", f"refs/heads/{branch}", check=False).returncode == 0

    def test_without_the_hook_the_copy_reaches_the_remote(self) -> None:
        commit(self.repo, {"src/app/copy.ts": COPIED}, "copy")
        self.assertEqual(self.push("wip/unguarded").returncode, 0)
        self.assertTrue(self.on_remote("wip/unguarded"))

    def test_a_copied_run_is_blocked_and_named(self) -> None:
        self.assertEqual(self.install().returncode, 0)
        bad = commit(self.repo, {"src/app/copy.ts": COPIED}, "copy")
        result = self.push("wip/throwaway")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.on_remote("wip/throwaway"))
        self.assertIn(f"{bad}\tsrc/app/copy.ts\t1-3\tline-run", result.stdout + result.stderr)
        self.assertIn("pre-push: push blocked", result.stderr)

    def test_a_clean_commit_is_pushed(self) -> None:
        self.install()
        commit(self.repo, {"src/app/own.ts": CLEAN + "export const three = 3;\n"}, "clean")
        result = self.push("wip/clean")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.on_remote("wip/clean"))

    def test_a_copy_removed_by_a_later_commit_is_still_blocked(self) -> None:
        self.install()
        bad = commit(self.repo, {"src/app/copy.ts": COPIED}, "copy")
        commit(self.repo, {"src/app/copy.ts": None}, "remove the copy")
        result = self.push("wip/fixed-later")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.on_remote("wip/fixed-later"))
        self.assertIn(bad, result.stdout + result.stderr)

    def test_a_clean_push_from_a_linked_worktree_passes_and_a_copy_is_still_blocked(self) -> None:
        # The push the coordinator makes from a carry worktree: several commits, a locale file and a long spec.
        self.install()
        worktree = self.tmp / "carry"
        git(self.repo, "worktree", "add", "-q", "-b", "carry", str(worktree), "work")
        (worktree / "node_modules").mkdir()
        locale = "{\n" + "".join(f'  "fixtureKey{i}": "A translated fixture string, number {i}",\n' for i in range(400))
        spec = "".join(f"test('fixture case {i}', async () => {{\n  await expectFixtureValue({i}, 'value {i}');\n}});\n"
                       for i in range(150))
        commit(worktree, {"src/app/i18n/locales/additions/en.json": locale + '  "last": "end"\n}\n'}, "locale strings")
        commit(worktree, {"e2e/composer/fixture-long.spec.ts": spec}, "a long spec")
        commit(worktree, {"src/app/i18n/locales/additions/en.json": locale + '  "last": "the end"\n}\n'}, "edit a string")
        result = run(worktree, "git", "push", str(self.remote), "HEAD:refs/heads/wip/carry", check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("0 findings in 0 files of the 3 commits", result.stdout + result.stderr)
        self.assertTrue(self.on_remote("wip/carry"))
        bad = commit(worktree, {"src/app/copy.ts": COPIED}, "copy")
        result = run(worktree, "git", "push", str(self.remote), "HEAD:refs/heads/wip/carry", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(f"{bad}\tsrc/app/copy.ts\t1-3\tline-run", result.stdout + result.stderr)

    def test_a_missing_corpus_blocks(self) -> None:
        self.install()
        commit(self.repo, {"src/app/own.ts": CLEAN}, "clean")
        hooks = Path(git(self.repo, "rev-parse", "--path-format=absolute", "--git-path", "hooks"))
        (hooks / "upstream-overlap" / "corpus").write_text(str(self.tmp / "nowhere") + "\n")
        result = self.push("wip/no-corpus")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.on_remote("wip/no-corpus"))
        self.assertIn("is not a git clone of the upstream client", result.stderr)

    def test_the_bypass_variable_pushes_loudly_and_logs(self) -> None:
        self.install()
        bad = commit(self.repo, {"src/app/copy.ts": COPIED}, "copy")
        result = self.push("wip/emergency", UPSTREAM_OVERLAP_BYPASS="test emergency")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.on_remote("wip/emergency"))
        self.assertIn("UPSTREAM OVERLAP CHECK BYPASSED: test emergency", result.stderr)
        log = (self.repo / ".git" / "upstream-overlap-bypass.log").read_text()
        self.assertIn("test emergency", log)
        self.assertIn(bad, log)

    def test_an_existing_pre_push_hook_is_kept_and_runs_first(self) -> None:
        hooks = self.repo / ".git" / "hooks"
        hooks.mkdir()
        seen = self.tmp / "seen.txt"
        (hooks / "pre-push").write_text(f"#!/bin/sh\necho \"$1\" > {seen}\ncat >> {seen}\n[ ! -e {self.tmp / 'refuse'} ]\n")
        (hooks / "pre-push").chmod(0o755)
        self.assertIn("pre-push.local", self.install().stdout)
        tip = commit(self.repo, {"src/app/own.ts": CLEAN}, "clean")
        self.assertEqual(self.push("wip/chained").returncode, 0)
        self.assertEqual(seen.read_text(), f"{self.remote}\nHEAD {tip} refs/heads/wip/chained {ZERO}\n")
        (self.tmp / "refuse").touch()
        self.assertNotEqual(self.push("wip/refused").returncode, 0)
        self.assertFalse(self.on_remote("wip/refused"))
        self.assertEqual(self.install().returncode, 0)  # installing again keeps both
        self.assertTrue((hooks / "pre-push.local").exists())

    def test_core_hooks_path_is_refused(self) -> None:
        git(self.repo, "config", "core.hooksPath", str(self.tmp / "shared-hooks"))
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("core.hooksPath", result.stderr)
        self.assertFalse((self.repo / ".git" / "hooks" / "pre-push").exists())


if __name__ == "__main__":
    unittest.main()
