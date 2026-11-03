# Provenance

This repository has two kinds of code. The spec (`docs/baspowers/specs/2026-11-02-clean-room-client-design.md`, section 2) defines them.

## Lane P: files ported from MindRoom Chat

- Source: `mindroom-ai/mindroom-chat` at `fc3a5905` (`dev`, 2026-11-02).
- Selection: `git blame -w -M -C -C` attributes at least 95% of the file's lines to Bas Nijholt (`bas@nijho.lt`). Every line attributed to anyone else was blanked when copied; `docs/provenance/holes.tsv` lists them (path, line). Lane C rewrites the blanked lines.
- List: `docs/provenance/portable.tsv` (path, Bas lines, blanked lines): 1581 files, 329,229 Bas lines, 655 blanked lines.
- Grant: per Bas Nijholt's instruction of 2026-11-02, as the author of the lines in these files he licenses them under the Apache License 2.0 for this project.
- Tool: `scripts/port_files.py <chat checkout> <commit>` performs the import; `--verify` recomputes it and compares with the import commit named in `docs/provenance/import.txt`.

## Lane C: clean code

Everything else. Written without access to Cinny or MindRoom Chat source beyond the Lane P files in this repository. Inputs are listed in the spec, section 2.

Supporting inventories, computed by the orchestrator from blame and imports only:

- `docs/provenance/seams.tsv`: modules that Lane P files import but that are not ported (path in MindRoom Chat, number of importing files, Bas share of the original, imported names). Lane C implements them at the same paths.
- `docs/provenance/external.tsv`: npm packages imported by Lane P files, with import counts.

## What the orchestrator saw

The orchestrating session (Claude Opus 5.5, 2026-11-02) ran MindRoom Chat `fc3a5905` locally and captured `docs/design/reference/`; computed blame and import graphs over MindRoom Chat; read MindRoom Chat repository metadata (license, package manifest, path names, settings labels in the running app); and read the MindRoom backend docs and source (Apache-2.0). It never opened a Cinny-authored source file.

## Session log

| Date | Session | Model | Task | Sources consulted |
|---|---|---|---|---|
| 2026-11-02 | orchestrator | Claude Opus 5.5 | spec, inventories, Lane P import, reference screenshots | as above |
| 2026-11-02 | Task 2 implementer | Claude Sonnet 5.5 | license check, verify-ported, similarity-audit scripts | this repository, `node_modules` package manifests; no MindRoom Chat or Cinny source |
