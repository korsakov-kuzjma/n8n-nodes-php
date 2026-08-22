# n8n-nodes-php

**English** | [Русский](README.ru.md)

This is an [n8n](https://n8n.io/) community node. It lets you execute arbitrary **PHP** code directly in your n8n workflows.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
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

The node writes your code to a temporary file, executes it with `php <file>`, captures stdout/stderr, deletes the temp file, and returns the output:

- If stdout is valid JSON, it is returned as structured data (one item per array element if the root is an array).
- Otherwise it is wrapped as `{ "output": "<text>" }`.
- If the process exits with a non-zero code, the node throws an error containing stderr (or pushes `{ "error": ... }` when *Continue On Fail* is enabled).

### Data injection method

Choose how the current item's data reaches the script via **Data Injection Method**:

- **STDIN** (default): the item JSON is piped to the process standard input. It is safe for any characters and requires no escaping.
- **Handlebars (Legacy)**: interpolate values into the code with n8n expressions like `{{ $json.email }}` before execution.

### Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| Timeout (Seconds) | `30` | Maximum execution time. On timeout the process receives SIGTERM first and is force-killed only after a 2-second grace period. |
| PHP Binary Path | `php` | Path to the PHP CLI binary, e.g. `/usr/bin/php8.3`. |
| Strict JSON Mode | off | Fail when the output cannot be parsed as JSON instead of wrapping it in `{ output }`. |
| Composer Autoload Path | empty | Prepends `vendor/autoload.php` via `auto_prepend_file`; ignored when the file does not exist. |
| Safe Mode | off | Disables `exec`, `shell_exec`, `system`, `passthru`, `popen`, `proc_open` and restricts file access to the temporary script directory (`open_basedir`). |
| Memory Limit (MB) | `128` | Applies `-d memory_limit=<n>M` to the executed script. |

Captured stdout and stderr are capped at 10 MB each; exceeding the cap kills the process and returns an error.

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

### Receive incoming data via STDIN (default)

By default the current item's JSON is piped to the script through standard input. Read it with `php://stdin` — no escaping needed, safe for quotes and any special characters:

```php
<?php
$input = json_decode(file_get_contents('php://stdin'), true);
echo json_encode(["status" => "ok", "data" => $input]);
```

For an incoming item `{ "email": "a\"b@c.ru" }` the result is:

```json
{ "status": "ok", "data": { "email": "a\"b@c.ru" } }
```

### Access incoming data via expressions (legacy)

Set **Data Injection Method → Handlebars (Legacy)** and use standard n8n expressions in the code field, e.g. `{{ $json.email }}`, to interpolate values before execution:

```php
<?php
echo json_encode(["greeting" => "Hello, {{ $json.name }}"]);
```

> Note: interpolated values are pasted into the PHP source as-is; quotes inside data can break the code. Prefer STDIN.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [PHP documentation](https://www.php.net/docs.php)

## Version history

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
