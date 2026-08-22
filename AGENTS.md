# AGENTS.md

Instructions for AI coding agents working in this repository.

## Project

`n8n-nodes-php` — an [n8n](https://n8n.io/) community node ("PHP Execute") that executes arbitrary PHP code via the local `php` CLI. Single-node package built with [`@n8n/node-cli`](https://www.npmjs.com/package/@n8n/node-cli). Self-hosted only (requires a local PHP binary), therefore n8n Cloud compatibility checks are intentionally disabled.

## Commands

```bash
npm ci            # install dependencies
npm run build     # compile TS -> dist/ (must succeed)
npm run lint      # eslint incl. @n8n/community-nodes rules (must pass with 0 errors)
npm run lint:fix  # autofix where possible
npm run dev       # scratch n8n instance with the node loaded
```

A local `php` CLI is required to exercise runtime behavior (`php -v`). There is no unit test suite; when changing execution logic, smoke-test manually (e.g. require the built `dist/nodes/PhpExecute/PhpExecute.node.js`, call `execute()` with a stubbed context, verify items/errors/temp-dir cleanup).

Always run `npm run lint && npm run build` before committing.

## Key files

- `nodes/PhpExecute/PhpExecute.node.ts` — the entire node implementation.
- `package.json` — `"n8n".nodes[]` must point at the compiled output path; it must match the source file location (`dist/nodes/<Dir>/<Name>.node.js`).
- `icons/php.svg`, `icons/php-dark.svg` — light/dark icon variants. Lint forbids pointing both at the same file; dark variant uses brighter fills.
- `CHANGELOG.md` — one `## X.Y.Z - YYYY-MM-DD` section per release. **CI extracts this section verbatim as the GitHub Release body** — never reword old headings, keep the exact format.
- `.github/workflows/publish.yml` — publishes to npm (provenance via OIDC/Trusted Publisher) and creates the GitHub Release on every `*.*.*` tag push.
- `.github/workflows/ci.yml` — lint + build on pushes to `master`/`main` and PRs.

## Non-obvious decisions (do not revert)

- `eslint.config.mjs` exports `configWithoutCloudSupport`, and `"n8n"."strict"` is `false`: the node requires Node builtins (`child_process`, `fs/promises`, `os`, `path`) which n8n Cloud forbids. Re-enabling cloud support breaks lint.
- The `prepublishOnly` script intentionally blocks bare `npm publish` (exits unless `RELEASE_MODE=true`). Publishing happens through CI on tag push. Do not bypass it except as an explicit emergency fallback.
- Tags are bare semver (`0.3.0`, no `v` prefix) — the publish workflow trigger depends on it.
- Temp scripts are created in a unique `mkdtemp` directory and removed in `finally`; spawned processes have a timeout that sends SIGKILL. Preserve both behaviors.

## Code conventions

- Prettier: tabs, single quotes, trailing commas, print width 100.
- Keep production code free of comments unless the user asks; the existing node code has none.
- Node UI strings and all metadata are in **English** (Russian lives in `README.ru.md`; both READMEs carry a language-switcher line under the H1 and must be updated together).
- Community-node lint rules are effectively the spec:
  - file/class naming: `<Name>.node.ts` matching the node name;
  - `subtitle`, `usableAsTool: true`, light/dark icons required;
  - use `NodeConnectionTypes.Main`, never string literals;
  - every returned item must set `pairedItem`;
  - failures throw `NodeOperationError(this.getNode(), error, { itemIndex })`, honoring `this.continueOnFail()` first.
  Run `npm run lint` after any node change instead of guessing the rules.

## Release process

1. Bump `version` in `package.json` and keep it **identical to the future tag name** — npm publishes whatever `package.json` contains; the tag is only the trigger and is not validated against it.
2. Add a `CHANGELOG.md` section (`## X.Y.Z - date`) above previous ones.
3. Update the "Version history" list in **both** `README.md` and `README.ru.md`.
4. `npm run lint && npm run build`, commit (`Release X.Y.Z`), tag (`X.Y.Z`), push branch + tag.
5. CI does the rest: npm publish with provenance + GitHub Release created from the changelog section. Verify via `npm view <pkg> versions` and the Actions tab.

Do not create releases without being asked.

Publishing mechanics (avoid surprises):

- The **only** publish trigger is pushing a bare-semver tag (`*.*.*`). There is no `workflow_dispatch` button and no sanctioned local publish path.
- Pushes to `master`/PRs run check-only CI — nothing ever reaches npm from them.
- Creating a GitHub Release manually does not publish anything; the Release object is produced by the same tag-triggered workflow after a successful npm publish.
- npm rejects duplicate versions ("cannot publish over previously published version"). A tag can only be retried by deleting and re-pushing it, which re-runs the workflow but still cannot overwrite a published version. The GitHub Release step is idempotent: it skips when the release already exists.

## Environment notes

- Runtime n8n on this machine is a user systemd service: `systemctl --user restart n8n.service`. Dev installs go through `npm link` into `~/.n8n/nodes` — always remove the link when done (`npm uninstall <pkg>` there, `npm uninstall -g <pkg>` globally).
- Dependabot is active; major bumps of `typescript`/`eslint` have failed CI historically — check the Actions tab rather than assuming green.
