"""Tests for scripts/watch/check_sdk_licenses.py: python3 -m unittest scripts/watch/test_check_sdk_licenses.py"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_sdk_licenses


def package(name, license, deps=()):
    pid = f"{name} 1.0.0"
    return {
        "id": pid,
        "name": name,
        "version": "1.0.0",
        "license": license,
    }, {"id": pid, "deps": [{"pkg": f"{d} 1.0.0", "dep_kinds": [{"kind": None}]} for d in deps]}


def metadata(*entries, build_only=()):
    packages = [p for p, _ in entries]
    nodes = [n for _, n in entries]
    for node in nodes:
        for dep in node["deps"]:
            if dep["pkg"].split(" ")[0] in build_only:
                dep["dep_kinds"] = [{"kind": "build"}]
    return {"packages": packages, "resolve": {"nodes": nodes}}


class LicenseExpressionTest(unittest.TestCase):
    def test_dual_license_passes_when_one_side_is_allowed(self):
        self.assertTrue(check_sdk_licenses.license_ok("MIT OR Apache-2.0"))

    def test_conjunction_of_allowed_licenses_passes(self):
        self.assertTrue(check_sdk_licenses.license_ok("Apache-2.0 AND ISC"))

    def test_openssl_in_a_conjunction_fails(self):
        self.assertFalse(check_sdk_licenses.license_ok("ISC AND (Apache-2.0 OR ISC) AND OpenSSL"))

    def test_mpl_passes(self):
        self.assertTrue(check_sdk_licenses.license_ok("MPL-2.0"))

    def test_missing_license_fails(self):
        self.assertFalse(check_sdk_licenses.license_ok(None))
        self.assertFalse(check_sdk_licenses.license_ok(""))

    def test_or_later_suffix_counts_as_the_license(self):
        self.assertTrue(check_sdk_licenses.license_ok("MPL-2.0+"))

    def test_old_slash_syntax_reads_as_or(self):
        self.assertTrue(check_sdk_licenses.license_ok("MIT/Apache-2.0"))


class OffendersTest(unittest.TestCase):
    def test_reports_crates_reached_from_the_root_only(self):
        data = metadata(
            package("matrix-sdk-ffi", "Apache-2.0", deps=["good", "bad"]),
            package("good", "MIT"),
            package("bad", "ISC AND OpenSSL"),
            package("unreached", "GPL-3.0"),
        )
        self.assertEqual(
            check_sdk_licenses.offenders(data, "matrix-sdk-ffi"),
            [("bad", "1.0.0", "ISC AND OpenSSL")],
        )

    def test_crate_named_as_an_exception_passes(self):
        data = metadata(
            package("matrix-sdk-ffi", "Apache-2.0", deps=["xxhash-rust"]),
            package("xxhash-rust", "BSL-1.0"),
        )
        self.assertEqual(check_sdk_licenses.offenders(data, "matrix-sdk-ffi"), [])

    def test_exception_does_not_cover_another_crate_with_that_license(self):
        data = metadata(
            package("matrix-sdk-ffi", "Apache-2.0", deps=["other"]),
            package("other", "BSL-1.0"),
        )
        self.assertEqual(check_sdk_licenses.offenders(data, "matrix-sdk-ffi"), [("other", "1.0.0", "BSL-1.0")])

    def test_build_dependencies_are_not_linked(self):
        data = metadata(
            package("matrix-sdk-ffi", "Apache-2.0", deps=["builder"]),
            package("builder", "GPL-3.0"),
            build_only=("builder",),
        )
        self.assertEqual(check_sdk_licenses.offenders(data, "matrix-sdk-ffi"), [])


if __name__ == "__main__":
    unittest.main()
