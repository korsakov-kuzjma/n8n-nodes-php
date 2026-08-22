# n8n-nodes-php

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

### Access incoming data

Use standard n8n expressions in the code field, e.g. `{{ $json.email }}`, to interpolate values before execution:

```php
<?php
echo json_encode(["greeting" => "Hello, {{ $json.name }}"]);
```

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [PHP documentation](https://www.php.net/docs.php)

## Version history

### 0.1.0

- Initial release: **PHP Execute** node that runs arbitrary PHP code via the local PHP CLI.
