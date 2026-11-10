"""Tests of plugin directories in scripts/e2e-slot.sh --preview runs and in scripts/e2e-suite.sh: each runs from a
throwaway repository that holds the scripts, with stand-ins for Docker, curl and the build."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[1]

# Stands in for npx: `npx vite build --outDir <dir> ...` makes <dir>, with the plugins it was built with in plugins.
FAKE_NPX = """#!/bin/sh
out=
while [ $# -gt 0 ]; do
  if [ "$1" = --outDir ]; then out="$2"; fi
  shift
done
mkdir -p "$out"
printf '%s\\n' "${MINDROOM_CLIENT_PLUGINS:-}" > "$out/plugins"
"""

# Stands in for e2e-slot.sh in the suite's repository: logs its arguments.
FAKE_SLOT = """#!/bin/sh
printf '%s\\n' "$*" >> "$SLOT_LOG"
"""

# The run's command: writes what it sees, one line each.
REPORT = 'printf "%s\\n" "$MINDROOM_CLIENT_PLUGINS" "$E2E_PLUGIN_DIRS" "$E2E_SERVER_COMMAND" > "$REPORT"'


class PluginDirTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, self.tmp)
        bin_dir = self.tmp / "bin"
        bin_dir.mkdir()
        for name, text in {"docker": "#!/bin/sh\nexit 0\n", "curl": "#!/bin/sh\nexit 0\n", "npx": FAKE_NPX}.items():
            (bin_dir / name).write_text(text)
            (bin_dir / name).chmod(0o755)
        self.snapshots = self.tmp / "e2e"
        self.env = {
            **{name: value for name, value in os.environ.items() if name not in ("E2E_PLUGIN_DIRS", "MINDROOM_CLIENT_PLUGINS")},
            "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
            "E2E_SNAPSHOT_ROOT": str(self.snapshots),
            "E2E_MAX_CONCURRENT": "0",
        }

    def repository(self, name: str, files: dict[str, str]) -> tuple[Path, str]:
        """A Git repository with these scripts of this one (or the text given) and other files, and its commit."""
        repo = self.tmp / name
        for relative, text in files.items():
            target = repo / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if text:
                target.write_text(text)
            else:
                shutil.copy(REPOSITORY / relative, target)
        git = ["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@example.org", "-c", "commit.gpgsign=false"]
        subprocess.run([*git, "init", "-q"], check=True)
        subprocess.run([*git, "add", "."], check=True)
        subprocess.run([*git, "commit", "-q", "-m", "scripts"], check=True)
        sha = subprocess.run([*git, "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
        return repo, sha

    def plugin(self, name: str, link_to: Path | None = None) -> Path:
        """A plugin directory with a lockfile, an installed package and a fixture page, linked to `link_to` as .mindroom-chat."""
        plugin = self.tmp / name
        (plugin / "node_modules/dep").mkdir(parents=True)
        (plugin / "node_modules/dep/index.js").write_text("export {};\n")
        (plugin / "package-lock.json").write_text("{}\n")
        (plugin / "e2e/fixtures").mkdir(parents=True)
        (plugin / "e2e/fixtures/page.html").write_text("<!doctype html>\n")
        if link_to:
            (plugin / ".mindroom-chat").symlink_to(link_to)
        return plugin


class SlotPreviewTests(PluginDirTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.app, self.sha = self.repository(
            "app",
            {"scripts/e2e-slot.sh": "", "scripts/private-dir.sh": "", "e2e/docker-compose.yaml": "services: {}\n"},
        )
        self.tree = self.snapshots / "slot-98"
        self.copies = self.tree / "e2e-plugins"

    def run_slot(self, **env: str) -> tuple[subprocess.CompletedProcess[str], list[str]]:
        """A --preview run on slot 98 with these variables, and what its command saw."""
        report = self.tmp / "report"
        report.unlink(missing_ok=True)
        result = subprocess.run(
            ["bash", str(self.app / "scripts/e2e-slot.sh"), "98", "--preview", "sh", "-c", REPORT],
            capture_output=True,
            text=True,
            env={**self.env, **env, "REPORT": str(report)},
        )
        return result, report.read_text().splitlines() if report.exists() else []

    def test_client_plugins_are_built_from_copies_into_the_runs_own_build(self) -> None:
        plugin = self.plugin("plugin", link_to=self.app)
        result, (plugins, plugin_dirs, server) = self.run_slot(MINDROOM_CLIENT_PLUGINS=str(plugin))
        self.assertEqual(result.returncode, 0, result.stderr)
        copy = self.copies / "plugin"
        self.assertEqual((plugins, plugin_dirs), (str(copy), ""))
        build = self.snapshots / "builds/slot-98"
        self.assertIn(f"--outDir {build}", server)
        self.assertEqual((build / "plugins").read_text(), f"{copy}\n")
        self.assertFalse((self.snapshots / "builds" / self.sha).exists())
        # The copy has the lockfile and the installed packages, and its link to the app leads to the snapshot.
        self.assertTrue((copy / "package-lock.json").is_file())
        self.assertTrue((copy / "node_modules/dep/index.js").is_file())
        self.assertEqual(os.readlink(copy / ".mindroom-chat"), str(self.tree))

        # The same commit right after, without plugins, gets the commit's own build, without them.
        result, (plugins, _, server) = self.run_slot()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(plugins, "")
        commit_build = self.snapshots / "builds" / self.sha
        self.assertIn(f"--outDir {commit_build}", server)
        self.assertEqual((commit_build / "plugins").read_text(), "\n")

    def test_a_directory_in_both_variables_is_copied_once(self) -> None:
        plugin = self.plugin("plugin")
        other = self.plugin("other")
        result, (plugins, plugin_dirs, _) = self.run_slot(
            E2E_PLUGIN_DIRS=f"{plugin}{os.pathsep}{os.path.relpath(other, self.tree)}",
            MINDROOM_CLIENT_PLUGINS=str(plugin),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(plugins, str(self.copies / "plugin"))
        self.assertEqual(plugin_dirs, f"{self.copies / 'plugin'}{os.pathsep}{self.copies / 'other'}")
        self.assertEqual(sorted(path.name for path in self.copies.iterdir()), ["other", "plugin"])
        # A plugin without a link to the app gets none.
        self.assertFalse((self.copies / "plugin/.mindroom-chat").exists())
        self.assertTrue((self.copies / "plugin/e2e/fixtures/page.html").is_file())

    def test_client_plugins_of_one_name_get_copies_of_their_own_and_their_entries_are_trimmed(self) -> None:
        plugin = self.plugin("plugin")
        other = self.plugin("elsewhere/plugin")
        result, (plugins, _, _) = self.run_slot(MINDROOM_CLIENT_PLUGINS=f" {plugin}, {other} ")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(plugins, f"{self.copies / 'plugin'},{self.copies / 'plugin-2'}")

    def test_two_plugin_directories_of_one_name_are_refused(self) -> None:
        plugin = self.plugin("plugin")
        other = self.plugin("elsewhere/plugin")
        result, seen = self.run_slot(E2E_PLUGIN_DIRS=f"{plugin}{os.pathsep}{other}")
        self.assertEqual(result.returncode, 2)
        self.assertIn("e2e-slot: two directories of E2E_PLUGIN_DIRS are named plugin", result.stderr)
        self.assertEqual(seen, [])

    def test_a_link_that_leads_out_of_the_directory_leads_where_it_did(self) -> None:
        plugin = self.plugin("plugin")
        (self.tmp / "shared").mkdir()
        # As npm links a local package (`npm install ../shared`), and a link inside the directory.
        (plugin / "node_modules/shared").symlink_to("../../shared")
        (plugin / "node_modules/.bin").mkdir()
        (plugin / "node_modules/.bin/dep").symlink_to("../dep/index.js")
        result, _ = self.run_slot(MINDROOM_CLIENT_PLUGINS=str(plugin))
        self.assertEqual(result.returncode, 0, result.stderr)
        copy = self.copies / "plugin"
        self.assertEqual(os.readlink(copy / "node_modules/shared"), str(self.tmp / "shared"))
        self.assertEqual(os.readlink(copy / "node_modules/.bin/dep"), "../dep/index.js")


class SuiteTests(PluginDirTestCase):
    def test_the_suite_runs_the_plugin_directories_specs_on_the_production_build(self) -> None:
        repo, _ = self.repository(
            "app",
            {
                "scripts/e2e-suite.sh": "",
                "scripts/private-dir.sh": "",
                "scripts/e2e-results-tsv.mjs": "",
                "scripts/e2e-slot.sh": FAKE_SLOT,
                "e2e/a.spec.ts": "\n",
            },
        )
        plugin = self.plugin("plugin")
        (plugin / "e2e/nested").mkdir()
        (plugin / "e2e/nested/b.spec.ts").write_text("\n")
        (plugin / "e2e/c.spec.ts").write_text("\n")
        log = self.tmp / "slot.log"
        for options in ([], ["--dev"]):
            log.unlink(missing_ok=True)
            result = subprocess.run(
                ["bash", str(repo / "scripts/e2e-suite.sh"), "--slots", "98", *options],
                capture_output=True,
                text=True,
                env={**self.env, "E2E_PLUGIN_DIRS": str(plugin), "SLOT_LOG": str(log)},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            # Each run as its spec and whether it is on the production build.
            runs = sorted(
                (line.split(" npx playwright test ")[1].split(" ")[0], " --preview " in line)
                for line in log.read_text().splitlines()
            )
            self.assertEqual(
                runs,
                # By their paths in the slot's snapshot.
                [
                    (f"{self.snapshots}/slot-98/e2e-plugins/plugin/e2e/c.spec.ts", True),
                    (f"{self.snapshots}/slot-98/e2e-plugins/plugin/e2e/nested/b.spec.ts", True),
                    (f"{self.snapshots}/slot-98/e2e/a.spec.ts", options == []),
                ],
            )


if __name__ == "__main__":
    unittest.main()
