# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- Configurable **Timeout** option (default 30 s): the PHP process is killed when exceeded.
- `usableAsTool` support so the node can be used as an AI agent tool.
- Dark-theme icon variant.
- Clear error message when the `php` binary is missing from `PATH`.

### Changed

- Node UI strings unified in English.
- ESLint switched to the community-node config without n8n Cloud checks (`n8n-node cloud-support disable`); the node is self-hosted-only and requires Node builtins.

### Fixed

- CI workflow now also triggers on pushes to `master`.
- Temporary script files are created in a unique per-execution directory (`mkdtemp`), preventing collisions between parallel runs.
- Scalar JSON output (e.g. `42`, `"text"`) no longer produces an invalid item; arrays of objects are split into one item per element as documented.
- Removed duplicated `homepage` key in package.json.

## 0.1.0 - 2026-08-22

### Added

- **PHP Execute** node: executes arbitrary PHP code via the local PHP CLI (`php`).
- Automatic JSON parsing of stdout; plain output is wrapped as `{ output }`.
- Error handling with support for *Continue On Fail*.
- PHP logo icon (light/dark).
