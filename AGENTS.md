# AGENTS.md

Instructions for AI coding agents working in this repository.

## Project

`n8n-nodes-php` — an [n8n](https://n8n.io/) community node ("PHP Execute") that executes arbitrary PHP code via the local `php` CLI. Single-node package built with [`@n8n/node-cli`](https://www.npmjs.com/package/@n8n/node-cli). Self-hosted only (requires a local PHP binary), therefore n8n Cloud compatibility checks are intentionally disabled.

## Commands

```bash
npm ci            # install dependencies
npm run build     # tsc + esbuild bundle of zod into dist/ (must succeed)
npm run lint      # eslint incl. @n8n/community-nodes rules (must pass with 0 errors)
npm run lint:fix  # autofix where possible
npm test          # jest suite (unit + real-process integration tests)
npm run dev       # scratch n8n instance with the node loaded
```

A local `php` CLI is required to exercise runtime behavior (`php -v`). When changing execution logic beyond what the jest suite covers, smoke-test manually (require the built `dist/nodes/PhpExecute/PhpExecute.node.js`, call `execute()` with a stubbed context, verify items/errors/sandbox cleanup).

Always run `npm run lint && npm test && npm run build` before committing.

## Key files

- `nodes/PhpExecute/PhpExecute.node.ts` — node UI definition + `execute()` orchestration.
- `nodes/PhpExecute/helpers/` — the actual implementation modules:
  - `phpProcess.ts` — spawn/lifecycle (code via STDIN, payload via fd 3);
  - `bootstrap.ts` — PHP preamble injected before user code (fatal envelope, metrics marker, payload variables);
  - `validation.ts` — zod option schemas; `staticAnalysis.ts` — restricted-mode pattern gate;
  - `sandbox.ts` — sandbox dir/additional files/privilege drop; `cache.ts` — TTL result cache;
  - `outputParser.ts` — fatal-envelope/OOM detection + stdout parsing; `errors.ts` — error hierarchy.
- `scripts/bundle.mjs` — esbuild post-build step inlining `zod` into `dist/nodes/PhpExecute/PhpExecute.node.js`.
- `nodes/PhpExecute/__tests__/` — jest suites; `phpProcess.test.ts` and `phpExecute.node.test.ts` spawn a real `php`.
- `docs/adr/0001-php-process-pool.md` — why execution is spawn-per-run.
- `package.json` — `"n8n".nodes[]` must point at the compiled output path; it must match the source file location (`dist/nodes/<Dir>/<Name>.node.js`).
- `icons/php.svg`, `icons/php-dark.svg` — light/dark icon variants. Lint forbids pointing both at the same file; dark variant uses brighter fills.
- `CHANGELOG.md` — one `## X.Y.Z - YYYY-MM-DD` section per release. **CI extracts this section verbatim as the GitHub Release body** — never reword old headings, keep the exact format.
- `.github/workflows/publish.yml` — publishes to npm (provenance via OIDC/Trusted Publisher) and creates the GitHub Release on every `*.*.*` tag push.
- `.github/workflows/ci.yml` — lint + build on pushes to `master`/`main` and PRs.

## Non-obvious decisions (do not revert)

- `eslint.config.mjs` exports `configWithoutCloudSupport`, and `"n8n"."strict"` is `false`: the node requires Node builtins (`child_process`, `fs/promises`, `os`, `path`) which n8n Cloud forbids. Re-enabling cloud support breaks lint.
- The `prepublishOnly` script intentionally blocks bare `npm publish` (exits unless `RELEASE_MODE=true`). Publishing happens through CI on tag push. Do not bypass it except as an explicit emergency fallback.
- Tags are bare semver (`0.3.0`, no `v` prefix) — the publish workflow trigger depends on it.
- Execution is fully in-memory: user code goes to the PHP process's STDIN (bootstrap preamble + user code in one stream), payload JSON goes to an extra pipe (fd 3). Never reintroduce temp script files.
- Community lint rules forbid runtime dependencies; `zod` must therefore stay bundled by `scripts/bundle.mjs` and must not appear in `dependencies`/`peerDependencies` (only `n8n-workflow` is allowed as a peer).
- The sandbox directory (`os.tmpdir()/n8n-php-sandbox`) persists between runs so additional files can be reused; spawned processes have a timeout that sends SIGTERM then SIGKILL after a grace period. Preserve both behaviors.
- Restricted mode is the default Security Level; legacy `safeMode` boolean maps onto it. Do not weaken `disable_functions`, `open_basedir`, or static analysis without an explicit request.

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
