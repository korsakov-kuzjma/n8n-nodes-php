# Changelog

All notable changes to this project will be documented in this file.

## 2.0.1 - 2026-08-23

### Fixed

- **Additional Files are now scanned by static analysis in Restricted mode** before being written into the sandbox; violations are reported with the offending file name. Previously only the main PHP code was checked.
- Static analysis now validates the `phpCode` resolved **for every input item**, not just the first one — item-by-item mode with expressions could previously skip the scan for items after the first.
- The fatal-error envelope survives error messages containing invalid UTF-8 (`JSON_INVALID_UTF8_SUBSTITUTE`) instead of degrading to a generic exit-code error.

### Security

- Extended the runtime `disable_functions` blocklist in Restricted mode with network primitives: `fsockopen`, `pfsockopen`, `stream_socket_client`, `stream_socket_server`, `curl_init`, `curl_exec`, `curl_multi_init`, `curl_multi_exec`, `socket_create`, `socket_create_listen`.
- Sandbox hardening: additional-file writes use exclusive creation (no symlink races), failed writes clean up their temporary files, and when n8n runs as root a sandbox directory owned by another user aborts execution instead of being reused.

### Changed

- The result cache stores raw process output instead of fully parsed items and skips entries larger than 1 MB, bounding its memory footprint.
- Clarified option descriptions: Options are evaluated once against the first input item; in batch mode all outputs are paired with the first input item when counts differ; outputs over 1 MB are not cached.
- Removed dead exports (`parsePhpOutput`, `RESTRICTED_PATTERN_LABELS`) and a raw NUL byte that made one source file read as binary.

## 2.0.0 - 2026-08-23

### ⚠️ Breaking changes

- **PHP code is now piped to STDIN** (in-memory execution, no temp files). Data is delivered on a dedicated extra pipe and exposed as PHP variables: `$n8nInput` (current item), `$n8nItems` (all items), `$n8nContext` (workflow/execution metadata). Scripts that previously read `php://stdin` for data must switch to `$n8nInput`.
- `__FILE__` / `__DIR__` now resolve to `Standard input code`, not a temp script path.
- **Safe Mode boolean replaced by Security Level dropdown** (*Restricted* / *Unrestricted*). Legacy workflows with `safeMode: true/false` keep their intent; workflows that never touched the option become **Restricted** — shell-execution calls are blocked before the process starts.
- In Restricted mode scalar JSON roots are typed (`{"output": 42}` as number, not `"42"`).

### Added

- **In-memory execution**: code goes to STDIN, JSON payload to an extra pipe; no temp files or disk I/O.
- **Execution Mode** property: *Run Once for Each Item* (default) or *Run Once for All Items* (batch) — one process for all items with 1:1 `pairedItem` mapping when output count matches input count.
- **Security Level** option: *Restricted* (default) enforces extended `disable_functions` (`exec`, `shell_exec`, `system`, `passthru`, `popen`, `proc_open`, `pcntl_exec`, `dl`, `putenv`, `posix_kill`, `proc_nice`), `allow_url_fopen=0`, `allow_url_include=0`, `open_basedir` on the sandbox directory, plus pre-execution static analysis of the code; *Unrestricted* keeps only memory/timeout limits.
- OS-level privilege drop in Restricted mode when n8n runs as root: worker processes run as `nobody` (uid/gid 65534) inside `/tmp/n8n-php-sandbox`.
- Static code analysis before spawning in Restricted mode: blocks shell execution functions, backtick operators, remote includes and URL fetchers with a precise violation report.
- Typed error hierarchy: `PhpNodeError` base with `PhpBinaryNotFoundError`, `PhpTimeoutError`, `PhpMemoryLimitError`, `PhpSafeModeViolationError`, `PhpFatalError` (parsed from a fatal-error shutdown envelope), `OutputLimitExceededError`, `PhpProcessError`; OOM stderr is detected even without the envelope.
- Fatal-error wrapper injected via `register_shutdown_function`: uncaught fatals surface as structured errors instead of raw non-zero exit codes.
- **Workflow context payload** sent to every execution: node name/id, workflow id/name, execution id, current run index and n8n mode.
- Execution metrics (`phpVersion`, `executionTimeMs`, `peakMemoryUsageMb`, `exitCode`) logged per run and attached as `_phpMetrics` to items produced under *Continue On Fail*.
- **Result Cache TTL (Seconds)** option: identical executions within the TTL window return cached results (SHA-256 key over code + payload + settings, LRU cap 100 entries).
- **Additional Files** collection: helper scripts written into the sandbox before execution (names validated); `require 'helper.php'` works out of the box because the process working directory is the sandbox.
- Options validation via `zod` (coercion + bounds), bundled into the build artifact so the package keeps zero runtime dependencies.
- Composer autoload existence check with a warning instead of a hard failure.
- ADR-0001 documenting why spawn-per-run beats a process pool for this threat model.

## 1.0.0 - 2026-08-22

### Added

- **Data Injection Method** property: the current item JSON is piped to PHP via STDIN by default (read it with `json_decode(file_get_contents('php://stdin'), true)`), safe for quotes and any special characters; legacy n8n-expression interpolation remains available as *Handlebars (Legacy)*.
- **PHP Binary Path** option to point at a specific CLI binary (default `php`).
- **Strict JSON Mode** option: fail when stdout cannot be parsed as JSON instead of wrapping it as `{ output }`.
- **Composer Autoload Path** option: prepends `vendor/autoload.php` via `auto_prepend_file` when the file exists.
- **Safe Mode** option: disables executable functions (`exec`, `shell_exec`, `system`, `passthru`, `popen`, `proc_open`) and restricts file access to the temporary script directory (`open_basedir`).
- **Memory Limit (MB)** option (default 128) applied via `-d memory_limit=<n>M`.
- Graceful shutdown on timeout: SIGTERM first, SIGKILL only after a 2-second grace period.
- Captured stdout/stderr capped at 10 MB each; exceeding the cap kills the process and returns a clear error.
- Jest test suite: output-parser unit tests and real-process integration tests (success, STDIN delivery, timeout/SIGTERM escalation, ENOENT, non-zero exit, output limit).

### Changed

- Refactored the monolithic node into dedicated modules: process management (`helpers/phpProcess.ts`), output parsing (`helpers/outputParser.ts`), shared types (`interfaces.ts`).
- The default code snippet now demonstrates reading STDIN.

### Fixed

- Item mapping no longer references an undeclared variable, so plain-text output items always carry a valid `pairedItem` reference instead of crashing the workflow with a `ReferenceError`.

## 0.3.0 - 2026-08-22

### Added

- Russian documentation (README.ru.md).

## 0.2.0 - 2026-08-22

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
