# ADR-0001: PHP execution model — spawn-per-run vs process pool

- **Status:** Accepted
- **Date:** 2026-08-23
- **Deciders:** maintainers of n8n-nodes-php

## Context

Every PHP Execute node invocation spawns a fresh `php` CLI process. Interpreter
startup costs roughly 20–50 ms per run (plus Composer autoload parsing when
enabled). Workloads that call the node once per item pay this cost N times.

A persistent process pool would amortize interpreter startup: N workers are
spawned once and reused across executions. However, stock PHP CLI is a
batch-oriented runtime — it has no built-in keep-alive/repl mode that could
serve as a worker loop, so any pool requires one of:

1. **Long-lived workers via third-party runtime** (FrankenPHP, ReactPHP/Swoole
   app server, RoadRunner-style bridge): the node would talk HTTP/FastCGI/custom
   framing to resident PHP workers.
2. **Hand-rolled worker protocol on plain CLI**: node spawns `php` with a
   bootstrap REPL that reads framed requests from STDIN and answers on STDOUT.
3. **Status quo**: spawn-per-run, mitigating cold start with batching and result
   caching.

## Constraints

- Community nodes must not ship native binaries or provision system services;
  the only supported dependency is a `php` binary already present on the host.
- Security model relies on **process-level isolation**: every execution gets a
  fresh interpreter with fresh `disable_functions`, `open_basedir`,
  `memory_limit`, optional uid/gid drop, and a hard timeout enforced from the
  parent (`SIGTERM`, then `SIGKILL`). A pool must preserve all of these.
- User code may be hostile (the node's whole purpose is executing arbitrary
  code). Any shared mutable state between executions is an attack surface.

## Decision

**Keep spawn-per-run as the execution model; do not implement a process pool in
v2.x.**

Cold-start cost is addressed by cheaper levers shipped alongside this ADR:

- **Batch mode** (`executionMode: 'batch'`) collapses N items into one process,
  turning N startups into 1.
- **Result cache** (`resultCacheTtlSeconds`) skips re-execution entirely for
  identical code+payload within the TTL window.

## Rejected alternatives

### Long-lived workers via third-party runtime (FrankenPHP et al.)

Rejected for now: requires installing and operating a non-standard PHP runtime
on the host, which contradicts the node's "works with any local `php` CLI"
contract and cannot be automated by npm install. It also moves timeout/isolation
enforcement out of the Node.js process.

### Hand-rolled REPL over plain CLI

Rejected: user code runs inside the same long-lived interpreter, so globals,
static state, open resources, and included files leak between executions unless
every request is wrapped in a full teardown dance. Crash recovery (a worker
killed by `exit()`, OOM, or segfault must be detected and respawned), memory
growth over requests, and per-request timeout enforcement inside a shared
process all add substantial failure modes to security-critical infrastructure.

## Future work

Revisit if a future major version ships an opt-in **PHP Runtime setting**
(e.g. `php-cli` | `frankenphp`) where users who need high throughput can point
the node at a FrankenPHP worker instance. That keeps default behavior simple and
isolated while offering a pooled path for power users.

## Consequences

- ~20–50 ms interpreter overhead remains per spawned process (per item in
  item-by-item mode). Acceptable: typical n8n items are I/O-shaped, and batch
  mode covers hot loops.
- Isolation guarantees stay trivially strong: no state survives between
  executions by construction.
