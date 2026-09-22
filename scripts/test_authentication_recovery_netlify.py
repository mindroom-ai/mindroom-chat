"""Check the Netlify routing contract for mutable authentication assets."""

import fnmatch
from pathlib import Path
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[1]


class AuthenticationRecoveryNetlifyTests(unittest.TestCase):
    def test_bootstrap_assets_win_before_the_spa_fallback(self):
        config = tomllib.loads((ROOT / "netlify.toml").read_text())
        for path in ("/authentication-recovery.js", "/runtime-config.js"):
            with self.subTest(path=path):
                # Netlify applies the first matching redirect, including forced rewrites.
                rule = next(
                    rule
                    for rule in config["redirects"]
                    if fnmatch.fnmatchcase(path, rule["from"])
                )
                self.assertEqual(rule["to"], path)
                self.assertEqual(rule["status"], 200)
                self.assertTrue((ROOT / "public" / path.removeprefix("/")).is_file())

    def test_bootstrap_assets_are_not_stored_in_caches(self):
        config = tomllib.loads((ROOT / "netlify.toml").read_text())
        for path in ("/authentication-recovery.js", "/runtime-config.js"):
            with self.subTest(path=path):
                headers = {}
                for rule in config.get("headers", []):
                    if fnmatch.fnmatchcase(path, rule["for"]):
                        headers.update(rule["values"])
                cache_control = headers.get("Cache-Control", "")
                self.assertIn("no-store", cache_control.split(", "))


if __name__ == "__main__":
    unittest.main()
