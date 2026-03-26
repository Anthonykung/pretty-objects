<!--
  File: CHANGELOG.md
  Project: pretty-objects
  Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
  License: Apache-2.0
-->

# Changelog

All notable changes to **Pretty Objects** will be documented in this file.

This project was originally built for my own workflow while working with large structured datasets (JSON / JSONL / logs) during AI development. It's a very simple project so there's probably not going to be any meaningful updates, it'll probably be security/dependency updates, unless of course you have some ideas of what to add then let me know :3c

---

## [0.0.3] - 2026-03-25

### Removed

- Some dev stuff clean up, nothing that would affect user experience in this update

## [0.0.2] - 2026-03-25

### Bug Fixes

- Fixed published extension packaging so installed VSIX builds include the runtime `typescript` dependency required for JS/TS literal support.
- Hardened startup activation so welcome setup, stale temporary tab cleanup, and initial diagnostics failures do not prevent command registration.
- Improved startup error logging so extension-host activation failures are easier to diagnose after install.


## [0.0.1] - 2026-03-24

Initial public release.

### Added

- Prettify structured payloads from:
  - JSON
  - JSONL / NDJSON
  - JavaScript object literals
  - TypeScript object literals
  - Python literals (`dict`, `list`, `tuple`, `set`)
- Format document and format selection support.
- Preview formatting before applying changes.
- Restore the last prettify operation.
- JSONL dataset tools:
  - **Line-preserving mode** (one object per line)
  - **Pretty view mode** (convert JSONL into readable JSON arrays)
- Collapse and expand nested objects using editor folding.
- Deterministic JSON repair mode for minor parse issues.
- Optional moderate repair mode for slightly more aggressive fixes.
- Optional best-effort repair mode for temporary Object Viewer text-to-JSON fallback after standard repairs fail.
- Dedicated command palette commands for all features.
- Custom formatter keybindings for JSON and JSONL workflows.
- Settings for controlling formatting behavior and safety limits.
- Built-in welcome page with onboarding tips and quick actions.
- Object Viewer for top-level arrays and JSONL / NDJSON documents:
  - inspect one item at a time
  - edit the current item directly
  - move to previous / next items
  - insert and remove items
  - diff two items within the same collection
  - search large collections and navigate filtered result subsets
  - group records by dotted field path
  - jump by absolute index or filtered result number
  - edit items in named in-memory viewer tabs instead of untitled files
  - export the current item to a separate file via Save Item As File

### Notes

- JS/TS and Python formatting are designed for **standalone literal payloads**, not full source files.
- Pretty Objects does **not overwrite content** if parsing fails and no safe repair path exists.
- Collapse / expand functionality uses VS Code folding so the underlying document remains valid JSON/JSONL.

---

<p align="center">
Created with 💖 by <a href="https://anth.dev">Anthony Kung</a>
</p>
