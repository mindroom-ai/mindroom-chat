"""Renames of the name scrub (docs/provenance.md, "Name scrub"), read from docs/provenance/rename-map.tsv.

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
            if not row or row.startswith("#") or row.startswith("scope\t"):
                continue
            scope, old, new = row.split("\t")
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
        lines = text.split("\n")
        for index, line in enumerate(lines):
            if self.trigger.search(line):
                for pattern, new in rules:
                    line = pattern.sub(new, line)
                lines[index] = line
        return "\n".join(lines)

    def content(self, text: str, path: str = "") -> str:
        """File contents as the scrub rewrote them (`path` decides whether it is the record)."""
        return self.apply(text, {"all"} if is_record(path) else {"all", "text"})

    def message(self, text: str) -> str:
        return self.apply(text, {"all", "message", "text"})
