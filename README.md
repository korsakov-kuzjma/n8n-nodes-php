# n8n-nodes-php

**English** | [Русский](README.ru.md)

![GitHub License](https://img.shields.io/github/license/korsakov-kuzjma/n8n-nodes-php)

This is an [n8n](https://n8n.io/) community node. It lets you execute arbitrary **PHP** code directly in your n8n workflows.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Security](#security)
[Migrating from 1.x](#migrating-from-1x)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

In short:

1. In your n8n instance open **Settings → Community nodes**.
2. Select **Install a community node**.
3. Enter the package name: `n8n-nodes-php`.
4. Agree to the risks of using community nodes and confirm.

Self-hosted only. This node does not work on n8n Cloud, because it requires a local PHP binary.

### Prerequisites

- A self-hosted n8n instance
- [PHP](https://www.php.net/) CLI installed **on the same machine** as n8n and available in `PATH`:

```bash
php -v
```

## Operations

- **PHP Execute**: runs arbitrary PHP code and returns the result.

The node pipes your code to the PHP interpreter's standard input (nothing is written to disk) and sends the workflow payload over a dedicated extra pipe. After execution it parses stdout:

- If stdout is valid JSON, it is returned as structured data (one item per array element if the root is an array).
- Otherwise it is wrapped as `{ "output": "<text>" }`.
- Uncaught fatal errors, timeouts and OOM conditions are surfaced as typed errors (or pushed as `{ "error": ... }` items when *Continue On Fail* is enabled).

### Data injection method

Choose how the current item's data reaches the script via **Data Injection Method**:

- **STDIN** (default): the item JSON is piped into the process on a separate channel and exposed as ready-to-use PHP variables — no reading or decoding needed.
- **Handlebars (Legacy)**: interpolate values into the code with n8n expressions like `{{ $json.email }}` before execution.

Inside your script you always have access to:

| Variable | Contents |
| -------- | -------- |
| `$n8nInput` | The current item's JSON as an associative array |
| `$n8nItems` | All incoming items as an array of associative arrays |
| `$n8nContext` | Workflow metadata: `nodeName`, `nodeId`, `workflowId`, `workflowName`, `executionId`, `runIndex`, `mode` |

### Execution mode

- **Run Once for Each Item** (default): the script executes once per incoming item; each result item is paired back to its source item.
- **Run Once for All Items**: the script executes once for all items (`$n8nItems` contains all of them). If the script returns as many output elements as there were input items, they are paired 1:1; otherwise all outputs pair to the first input item.

### Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| Timeout (Seconds) | `30` | Maximum execution time. On timeout the process receives SIGTERM first and is force-killed only after a 2-second grace period. |
| PHP Binary Path | `php` | Path to the PHP CLI binary, e.g. `/usr/bin/php8.3`. |
| Strict JSON Mode | off | Fail when the output cannot be parsed as JSON instead of wrapping it in `{ output }`. |
| Composer Autoload Path | empty | Prepends `vendor/autoload.php` via `auto_prepend_file`; warns instead of failing when the file does not exist. |
| Memory Limit (MB) | `128` | Applies `-d memory_limit=<n>M`; exceeding it raises a clear memory-limit error. |
| Security Level | Restricted | See [Security](#security). |
| Result Cache TTL (Seconds) | `0` (off) | Identical executions within the window return cached results without spawning PHP. |

Captured stdout and stderr are capped at 10 MB each; exceeding the cap kills the process and returns an error.

### Additional files

Use **Additional Files** to ship helper scripts alongside your main code. Files are written into the sandbox directory before execution, and the PHP process runs with that directory as its working directory, so plain includes work:

```php
<?php
require 'helpers.php';
echo json_encode(["result" => my_helper(21)]);
```

File names must be simple (`letters-digits._-`); content is free-form PHP.

## Credentials

None required. The node uses the PHP binary available locally.

> **Security note:** executed code runs with the permissions of the n8n process. Only use your own trusted code, and never expose this node to untrusted input without validation.

## Compatibility

| n8n version | Tested |
| ----------- | ------ |
| 2.x         | ✅     |

Requires Node.js ≥ 22 for development. No minimum PHP version is enforced; any CLI version works (`7.4+` recommended).

## Usage

### Return JSON from your script

Echo valid JSON to return structured items:

```php
<?php
$data = [
    ["status" => "success", "time" => time()],
    ["status" => "success", "time" => time() + 1],
];
echo json_encode($data);
```

Result: two items with the fields `status` and `time`.

### Plain text output

```php
<?php
echo "Hello from PHP at " . date('H:i');
```

Result: one item `{ "output": "Hello from PHP at 14:05" }`.

### Work with the current item ($n8nInput)

With the default *STDIN* injection method the current item arrives pre-decoded in `$n8nInput` — safe for quotes and any special characters:

```php
<?php
echo json_encode(["status" => "ok", "data" => $n8nInput]);
```

For an incoming item `{ "email": "a\"b@c.ru" }` the result is:

```json
{ "status": "ok", "data": { "email": "a\"b@c.ru" } }
```

### Process all items at once (batch mode)

Switch **Execution Mode → Run Once for All Items** and loop over `$n8nItems`:

```php
<?php
$out = [];
foreach ($n8nItems as $item) {
    $out[] = ["email" => $item["email"], "score" => strlen($item["email"])];
}
echo json_encode($out);
```

Returning one element per input item keeps the 1:1 pairing intact.

### Use workflow context

```php
<?php
echo json_encode([
    "workflow" => $n8nContext["workflowName"],
    "run" => $n8nContext["runIndex"],
]);
```

### Access incoming data via expressions (legacy)

Set **Data Injection Method → Handlebars (Legacy)** and use standard n8n expressions in the code field, e.g. `{{ $json.email }}`, to interpolate values before execution:

```php
<?php
echo json_encode(["greeting" => "Hello, {{ $json.name }}"]);
```

> Note: interpolated values are pasted into the PHP source as-is; quotes inside data can break the code. Prefer STDIN.

## Security

The **Security Level** option controls how much the sandbox restricts executed code:

| | Restricted (default) | Unrestricted |
| - | -------------------- | ------------ |
| Shell functions (`exec`, `shell_exec`, `system`, `passthru`, `popen`, `proc_open`, …) | disabled via `disable_functions` | allowed |
| Network primitives (`fsockopen`, `stream_socket_*`, `curl_init`/`curl_exec`, `socket_create`, …) | disabled via `disable_functions` | allowed |
| Static analysis of the code before execution | blocks shell calls, backticks and remote URL fetchers (in the main code **and** additional files) | skipped |
| Remote file access (`allow_url_fopen` / `allow_url_include`) | disabled | follows php.ini |
| File access scope | sandbox directory (+ Composer vendor dir if configured) | unrestricted |
| OS user | drops to `nobody` when n8n runs as root | n8n process user |
| Working directory | `/tmp/n8n-php-sandbox` | `/tmp/n8n-php-sandbox` |
| Memory / timeout / output caps | enforced | enforced |

Restricted mode is designed so that even hostile code cannot escape to a shell or read arbitrary paths; use Unrestricted only for fully trusted scripts.

## Migrating from 1.x

- Replace `json_decode(file_get_contents('php://stdin'), true)` with `$n8nInput`.
- If you relied on `__FILE__`/`__DIR__` pointing at a temp script, note they now resolve to `Standard input code`.
- The old **Safe Mode** checkbox became **Security Level**: `true` maps to *Restricted*, `false` to *Unrestricted*; workflows that never saved the option now run **Restricted** and will block shell functions until you switch them to *Unrestricted*.
- Scalar JSON roots keep their type (`42` returns `{ "output": 42 }` as a number).

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [PHP documentation](https://www.php.net/docs.php)
* [ADR-0001: why no process pool](docs/adr/0001-php-process-pool.md)

## Version history

### 2.0.2

- Maintenance release, no node behavior changes: CI workflows use `actions/checkout@v7`; dev tooling updated (`release-it` 21, transitive `ip-address` 10.5).

### 2.0.1

- Bugfix release: static analysis now covers **Additional Files** and the `phpCode` resolved for every input item (Restricted mode).
- Extended runtime blocklist in Restricted mode with network primitives (`fsockopen`, `stream_socket_*`, `curl_*`, `socket_*`).
- Sandbox hardening: race-free exclusive writes, temp-file cleanup, ownership check under root; fatal envelope survives invalid UTF-8.
- Result cache bounded to 1 MB per entry and stores raw output.

### 2.0.0

- **Breaking:** PHP code is piped to STDIN (in-memory execution); data arrives as `$n8nInput` / `$n8nItems` / `$n8nContext` variables instead of `php://stdin`; `__FILE__`/`__DIR__` resolve to `Standard input code`.
- **Breaking:** Safe Mode replaced by the **Security Level** dropdown (*Restricted* default / *Unrestricted*); legacy `safeMode` values are mapped automatically.
- **Execution Mode**: per-item or batch (one process for all items) with correct `pairedItem` mapping.
- Hardened sandbox: extended `disable_functions`, remote-file-access off, `open_basedir`, static pre-execution analysis, privilege drop to `nobody` under root.
- Typed error hierarchy incl. parsed fatal errors (shutdown envelope) and OOM detection; metrics (`executionTimeMs`, `peakMemoryUsageMb`, `exitCode`) logged and attached under Continue On Fail.
- **Result Cache TTL** option and **Additional Files** collection (sandbox working dir).
- Options validated with zod (bundled, zero runtime dependencies); Composer autoload path warns instead of failing.

### 1.0.0

- **Data Injection Method**: the current item JSON is passed to PHP via STDIN by default — safe for any characters, no escaping required. Legacy n8n-expression interpolation remains available as *Handlebars (Legacy)*.
- **PHP Binary Path** option to point at a specific CLI binary (default `php`).
- **Strict JSON Mode**: fail on non-JSON output instead of wrapping it as `{ output }`.
- **Composer Autoload Path** option: prepends a `vendor/autoload.php` via `auto_prepend_file` when the file exists.
- **Safe Mode** option: disables executable functions (`exec`, `shell_exec`, `system`, `passthru`, `popen`, `proc_open`) and confines file access to the temporary script directory (`open_basedir`).
- **Memory Limit (MB)** option (default 128) applied via `-d memory_limit`.
- Graceful shutdown on timeout: SIGTERM first, SIGKILL only after a 2-second grace period.
- Captured stdout/stderr capped at 10 MB with a clear error when exceeded.
- Refactored into dedicated process-management and output-parsing helpers; added a Jest test suite.
- Hardened item mapping so every returned item always carries a valid `pairedItem` reference.

### 0.3.0

- Russian documentation (README.ru.md).

### 0.2.0

- **Timeout** option (default 30 s) kills runaway PHP scripts.
- Safe per-execution temp directories; clear error when `php` is missing from `PATH`.
- Node can be used as an AI agent tool (`usableAsTool`); dark-theme icon.
- Reliability fixes: CI triggers on `master`, scalar JSON output handling, lint compliance.

### 0.1.0

- Initial release: **PHP Execute** node that runs arbitrary PHP code via the local PHP CLI.
