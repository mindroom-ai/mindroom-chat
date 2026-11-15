#!/usr/bin/env python3
"""Checks the licenses of the Rust crates the watch app links (matrix-sdk-ffi and what it depends on).

Usage: check_sdk_licenses.py <matrix-rust-sdk checkout> [--write <file>]

Runs `cargo metadata` for matrix-sdk-ffi with the features scripts/watch/build-sdk.sh builds, for the
watchOS device target, walks the normal (linked) dependencies from matrix-sdk-ffi, and fails listing
every crate whose SPDX license expression is not satisfied by the licenses AGENTS.md allows. An OR is
satisfied by one side, an AND by both; `X WITH <exception>` and `X+` count as X; the old `A/B` syntax is
an OR. EXCEPTIONS names the crates allowed with a license outside the list.
With --write it also writes one line per linked crate (name, version, license) to the file.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ALLOWED = {
    "MIT",
    "MIT-0",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "0BSD",
    "Zlib",
    "Unicode-3.0",
    "Unicode-DFS-2016",
    "CC0-1.0",
    "BlueOak-1.0.0",
    "MPL-2.0",
}

# Crates allowed by name outside the list, with the reason; NOTICE repeats them.
EXCEPTIONS = {
    # The Boost license is permissive and asks for no notice in a binary; matrix-sdk-base needs it
    # through growable-bloom-filter.
    "xxhash-rust": "BSL-1.0",
}

FEATURES = "bundled-sqlite,rustls-aws-lc-rs,unstable-msc4274"
TARGET = "aarch64-apple-watchos"
ROOT = "matrix-sdk-ffi"


def _tokens(expression):
    return re.findall(r"\(|\)|[^\s()]+", expression.replace("/", " OR "))


def license_ok(expression):
    """Whether an SPDX expression is satisfied by the allowed licenses."""
    if not expression or not expression.strip():
        return False
    tokens = _tokens(expression)
    position = 0

    def peek():
        return tokens[position] if position < len(tokens) else None

    def take():
        nonlocal position
        position += 1
        return tokens[position - 1]

    def primary():
        token = take()
        if token == "(":
            value = disjunction()
            take()
            return value
        if peek() == "WITH":
            take()
            take()
        return token.removesuffix("+") in ALLOWED

    def conjunction():
        value = primary()
        while peek() == "AND":
            take()
            value = primary() and value
        return value

    def disjunction():
        value = conjunction()
        while peek() == "OR":
            take()
            value = conjunction() or value
        return value

    return disjunction()


def linked_packages(metadata, root_name):
    """The packages reached from root_name through normal dependencies, root included."""
    packages = {p["id"]: p for p in metadata["packages"]}
    nodes = {n["id"]: n for n in metadata["resolve"]["nodes"]}
    root = next(p["id"] for p in metadata["packages"] if p["name"] == root_name)
    seen, stack = set(), [root]
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        for dep in nodes[pid]["deps"]:
            if any(kind["kind"] is None for kind in dep["dep_kinds"]):
                stack.append(dep["pkg"])
    return sorted((packages[pid] for pid in seen), key=lambda p: (p["name"], p["version"]))


def offenders(metadata, root_name):
    return [
        (p["name"], p["version"], p["license"])
        for p in linked_packages(metadata, root_name)
        if not license_ok(p["license"]) and EXCEPTIONS.get(p["name"]) != p["license"]
    ]


def main(argv):
    if len(argv) not in (2, 4) or (len(argv) == 4 and argv[2] != "--write"):
        print(__doc__, file=sys.stderr)
        return 2
    sdk = Path(argv[1])
    output = subprocess.run(
        [
            "cargo", "metadata", "--format-version", "1",
            "--manifest-path", str(sdk / "bindings" / ROOT / "Cargo.toml"),
            "--filter-platform", TARGET, "--no-default-features", "--features", FEATURES,
        ],
        check=True, capture_output=True, text=True,
    ).stdout
    metadata = json.loads(output)
    if len(argv) == 4:
        lines = [f"{p['name']} {p['version']}: {p['license']}" for p in linked_packages(metadata, ROOT)]
        Path(argv[3]).write_text("\n".join(lines) + "\n")
    bad = offenders(metadata, ROOT)
    for name, version, license in bad:
        print(f"{name} {version}: {license or 'no license'}", file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
