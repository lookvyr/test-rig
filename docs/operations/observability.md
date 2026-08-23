# Observability

> For maintainers. Using Test Rig? See [docs/user](../user/).

Test Rig observability is local-only:

- human-readable logs go to stdout;
- completed Effect spans are persisted to a local NDJSON file;
- authenticated browser spans are sent to the connected Test Rig server and written to that same
  environment's local trace file;
- resource telemetry stays inside the environment and is exposed through authenticated local RPC;
- in-process metrics are not exported or persisted.

The runtime does not configure an OTLP exporter. Environment variables, persisted settings, or
client bootstrap values cannot enable one.

## Logs

Normal local launches write pretty logs to stdout. SSH-managed launches also persist the remote
process output at `~/.test-rig/ssh-launch/<state>/server.log`.

Logs emitted with `Effect.log...` inside an active span are included as events in the persisted span.

## Trace files

Completed spans are written to `server.trace.ndjson`. The default location depends on the launch:

- production or an explicit home: `<home>/userdata/logs/server.trace.ndjson`;
- linked-worktree development: `<worktree>/.test-rig/userdata/logs/server.trace.ndjson`;
- implicit development outside a worktree: `~/.test-rig/dev/logs/server.trace.ndjson`.

The common production default is:

```sh
TRACE_FILE="${TEST_RIG_HOME:-$HOME/.test-rig}/userdata/logs/server.trace.ndjson"
```

For a linked worktree:

```sh
TRACE_FILE="$WORKTREE/.test-rig/userdata/logs/server.trace.ndjson"
```

Useful commands:

```sh
tail -f "$TRACE_FILE"
```

```sh
jq -c 'select(.exit._tag != "Success") | {
  name,
  durationMs,
  exit,
  attributes
}' "$TRACE_FILE"
```

```sh
jq -c 'select(.durationMs > 1000) | {
  name,
  durationMs,
  traceId,
  spanId
}' "$TRACE_FILE"
```

```sh
jq -r 'select(.traceId == "TRACE_ID_HERE") | [
  .name,
  .spanId,
  (.parentSpanId // "-"),
  .durationMs
] | @tsv' "$TRACE_FILE"
```

## Browser traces

The web client serializes its spans to `/api/observability/v1/traces` on its connected Test Rig
server. The route requires the normal environment authentication, decodes the payload, and records
it through the server's local browser trace collector. It does not forward spans to another host.

This browser-to-environment request is retained because it is local product observability, not
third-party analytics or export.

## Resource telemetry

Process, host-power, and terminal resource telemetry remains local. The native resource monitor and
Electron publisher feed the server over inherited local pipes; clients read the resulting snapshot
through authenticated RPC. See [Resource telemetry architecture](../internals/resource-telemetry.md).

## Local trace configuration

- `T3CODE_TRACE_FILE`: override the local trace path.
- `T3CODE_TRACE_MAX_BYTES`: per-file rotation size; default `10485760`.
- `T3CODE_TRACE_MAX_FILES`: rotated file count; default `10`.
- `T3CODE_TRACE_BATCH_WINDOW_MS`: local flush window; default `200`.
- `T3CODE_TRACE_MIN_LEVEL`: minimum persisted trace level; default `Info`.
- `T3CODE_TRACE_TIMING_ENABLED`: enable timing metadata; default `true`.

There are no supported OTLP endpoint, token, dataset, service-name, or export-interval settings.

## Adding instrumentation

Prefer spans around meaningful boundaries such as RPC requests, orchestration commands, provider
turns, git operations, terminal lifecycle, and SQLite queries. Reuse an existing `Effect.fn(...)`
boundary where one already represents the operation.

Put request-specific detail on spans and keep metric labels low-cardinality. Emit diagnostic logs
inside the relevant span when they should appear in the local trace artifact.

Runtime wiring lives in `apps/server/src/observability/Layers/Observability.ts`. Browser trace
collection is handled by the authenticated server HTTP route and `BrowserTraceCollector`.

## Current constraints

- Logs outside spans are not persisted unless an SSH-managed launcher captures stdout/stderr.
- Metrics remain in process and have no local snapshot artifact.
- `serverLogPath` and legacy OTLP-shaped contract fields remain decode-compatible for older clients
  and settings, but they do not enable export.
