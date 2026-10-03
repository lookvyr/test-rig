import * as NodeAssert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { makeV2SqlitePersistenceLive } from "../../persistence/Layers/V2Sqlite.ts";
import { runV2Migrations } from "../../persistence/V2Migrations.ts";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ThreadId,
  RunId,
  ProviderThreadId,
  ProviderInstanceId,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { runMigrations } from "../../persistence/Migrations.ts";
import { initializeV2Database } from "../../persistence/initializeV2Database.ts";
import * as EventStore from "../EventStore.ts";
import * as ProjectionStore from "../ProjectionStore.ts";
import * as EventSink from "../EventSink.ts";
import * as Importer from "../legacy/LegacyV1ThreadImporter.ts";
import * as Handoff from "../ContextHandoffService.ts";
import * as IdAllocator from "../IdAllocator.ts";
import * as NodeSqlite from "node:sqlite";
import * as NodeCrypto from "node:crypto";
import { deliverContextHandoffs } from "../ContextHandoffDelivery.ts";
import { historyCost } from "../ContextHandoffBudget.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
it.layer(NodeServices.layer)("fork V2 migration", (it) => {
  it.effect("fork schema 39 upgrades through forward-only V2 adaptations", () =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runV2Migrations();
        const rows =
          yield* sql`SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 38 ORDER BY migration_id`;
        NodeAssert.equal(rows.length, 5);
        NodeAssert.equal((yield* runV2Migrations()).length, 0);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })));
    }),
  );

  function importerLayer(filename: string) {
    const database = NodeSqliteClient.layer({ filename });
    const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
      Layer.provideMerge(database),
    );
    const sink = EventSink.layer.pipe(Layer.provide(stores));
    return Importer.layer.pipe(Layer.provideMerge(Layer.mergeAll(stores, sink)));
  }
  const timestamp = "2026-10-01T12:00:00.000Z";
  const attachment = {
    type: "image",
    id: "image-1",
    name: "proof.png",
    mimeType: "image/png",
    sizeBytes: 32,
  };
  const seed = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations();
    yield* sql`INSERT INTO projection_projects (project_id,title,workspace_root,scripts_json,default_model_selection_json,created_at,updated_at)
    VALUES ('project','Proof','/tmp/proof-workspace','[]','{"instanceId":"claude-code","model":"sonnet"}',${timestamp},${timestamp})`;
    for (const [id, provider, mode, association, sideOf] of [
      ["long", "codex", "auto", '{"mode":"unlinked"}', null],
      [
        "linked",
        "claude-code",
        "approval-required",
        '{"mode":"linked","provider":"github","reference":"https://github.com/lookvyr/test-rig/pull/42"}',
        null,
      ],
      ["unavailable", "cursor", "full-access", null, null],
      ["opencode", "opencode", "auto-accept-edits", null, null],
      ["side", "codex", "full-access", null, "long"],
    ] as const) {
      yield* sql`INSERT INTO projection_threads (thread_id,project_id,title,model_selection_json,runtime_mode,interaction_mode,branch,worktree_path,created_at,updated_at,archived_at,settled_override,settled_at,snoozed_until,snoozed_at,pinned_at,pull_request_association_json,side_of_thread_id)
      VALUES (${id},'project',${id},${yield* encodeJson({ instanceId: provider, model: "explicit-model" })},${mode},'plan','codex/saved','/tmp/proof-worktree',${timestamp},${timestamp},${id === "linked" ? timestamp : null},'settled',${timestamp},${timestamp},${timestamp},${timestamp},${association},${sideOf})`;
    }
    yield* sql`INSERT INTO projection_thread_sessions (thread_id,status,provider_name,provider_session_id,provider_thread_id,updated_at)
    VALUES ('long','idle','codex','legacy-session','legacy-native-thread',${timestamp})`;
    yield* sql`INSERT INTO projection_turns (thread_id,turn_id,state,requested_at,checkpoint_turn_count,checkpoint_ref,checkpoint_status,checkpoint_files_json)
    VALUES ('long','legacy-turn','completed',${timestamp},1,'refs/test-rig/checkpoints/legacy','ready','[]')`;
    yield* sql`INSERT INTO checkpoint_diff_blobs (thread_id,from_turn_count,to_turn_count,diff,created_at)
    VALUES ('long',0,1,'legacy diff retained',${timestamp})`;
    for (let index = 0; index < 130; index++) {
      const date = DateTime.formatIso(
        DateTime.add(DateTime.makeUnsafe(timestamp), { seconds: index }),
      );
      yield* sql`INSERT INTO projection_thread_messages (message_id,thread_id,role,text,attachments_json,is_streaming,created_at,updated_at)
      VALUES (${`message-${String(index).padStart(3, "0")}`},'long',${index % 2 ? "assistant" : "user"},${`Message ${index}: ` + "saved history ".repeat(1000)},${yield* encodeJson(index === 0 ? [attachment] : [])},${index === 129 ? 1 : 0},${date},${date})`;
    }
  });

  it.effect("imports fork metadata and a long transcript into the real V2 stores", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectory({ prefix: "test-rig-v2-fixture-" });
      const source = path.join(directory, "state.sqlite");
      const destination = path.join(directory, "statev2.sqlite");
      try {
        yield* seed.pipe(Effect.provide(NodeSqliteClient.layer({ filename: source })));
        const original = yield* fs.readFile(source);
        yield* initializeV2Database(destination).pipe(Effect.provide(NodeServices.layer));
        yield* runV2Migrations().pipe(
          Effect.provide(NodeSqliteClient.layer({ filename: destination })),
        );
        yield* Effect.gen(function* () {
          const importer = yield* Importer.LegacyV1ThreadImporter;
          const store = yield* ProjectionStore.ProjectionStoreV2;
          NodeAssert.equal((yield* importer.reconcileShells).importedThreadCount, 4);
          NodeAssert.equal((yield* importer.reconcileShells).importedThreadCount, 0);
          yield* importer.ensureTranscript(ThreadId.make("long"));
          const projection = yield* store.getThreadProjection(ThreadId.make("long"));
          NodeAssert.equal(projection.messages.length, 130);
          NodeAssert.equal(projection.thread.activeProviderThreadId, null);
          NodeAssert.equal(projection.thread.runtimeMode, "auto");
          NodeAssert.equal(projection.thread.historyOrigin, "v1_import");
          NodeAssert.deepEqual(projection.thread.pullRequestAssociation, { mode: "unlinked" });
          NodeAssert.deepEqual(projection.messages[0]?.attachments, [attachment]);
          NodeAssert.equal(projection.messages[129]?.streaming, false);
          NodeAssert.equal(projection.turnItems[129]?.status, "interrupted");
          const handoff = yield* Handoff.ContextHandoffServiceV2;
          const prepared = yield* handoff.prepareLegacyImport({
            threadId: ThreadId.make("long"),
            targetRunId: RunId.make("fresh-run"),
            toProviderThreadId: ProviderThreadId.make("fresh-provider-thread"),
            toProviderInstanceId: ProviderInstanceId.make("codex"),
            items: projection.turnItems,
            createdAt: DateTime.makeUnsafe(timestamp),
          });
          NodeAssert.deepEqual(prepared.fromProviderThreadIds, []);
          NodeAssert.ok(prepared.history && prepared.history.omittedItems > 0);
          NodeAssert.match(prepared.history.coverage, /t3_thread_read/);
          const statuses: string[] = [];
          const delivery = yield* deliverContextHandoffs({
            handoffs: [prepared],
            budget: 16_000,
            alreadyDeliveredItemIds: new Set(),
            providerThread: {
              id: prepared.toProviderThreadId,
              driver: ProviderDriverKind.make("codex"),
              providerInstanceId: ProviderInstanceId.make("codex"),
              providerSessionId: null,
              appThreadId: prepared.threadId,
              ownerNodeId: null,
              nativeThreadRef: {
                driver: ProviderDriverKind.make("codex"),
                strength: "strong",
                nativeId: "new-native-session",
              },
              nativeConversationHeadRef: null,
              status: "idle",
              firstRunOrdinal: null,
              lastRunOrdinal: null,
              handoffIds: [],
              forkedFrom: null,
              createdAt: prepared.createdAt,
              updatedAt: prepared.createdAt,
            },
            inject: (history) =>
              Effect.sync(() => {
                NodeAssert.ok(historyCost(history.messages, history.context) <= 16_000);
                NodeAssert.ok(history.messages.length > 0 && history.messages.length < 130);
                for (const message of history.messages)
                  NodeAssert.ok(
                    projection.messages.some(
                      (saved) => saved.text === message.text && saved.role === message.role,
                    ),
                  );
                NodeAssert.match(history.context, /t3_thread_read/);
                return true;
              }),
            persist: (handoff) =>
              Effect.sync(() => {
                statuses.push(handoff.delivery!.status);
              }),
          });
          NodeAssert.equal(delivery.context, "");
          NodeAssert.deepEqual(statuses, ["pending", "injected"]);
          NodeAssert.equal(
            (yield* importer.ensureTranscript(ThreadId.make("long"))).importedMessageCount,
            0,
          );
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              importerLayer(destination),
              Handoff.layer.pipe(Layer.provide(IdAllocator.layer)),
            ),
          ),
        );
        NodeAssert.deepEqual(yield* fs.readFile(source), original);
      } finally {
        yield* fs.remove(directory, { recursive: true, force: true });
      }
    }),
  );

  const snapshot = (destination: string) =>
    initializeV2Database(destination).pipe(Effect.provide(NodeServices.layer));
  const migrate = (filename: string) =>
    runV2Migrations().pipe(Effect.provide(NodeSqliteClient.layer({ filename })));
  const hash = (filename: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return NodeCrypto.createHash("sha256")
        .update(yield* fs.readFile(filename))
        .digest("hex");
    });

  function withSeededCopy<A, E, R>(
    body: (directory: string, source: string, destination: string) => Effect.Effect<A, E, R>,
  ) {
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectory({ prefix: "test-rig-v2-recovery-" });
      const source = path.join(directory, "state.sqlite");
      const destination = path.join(directory, "statev2.sqlite");
      try {
        yield* seed.pipe(Effect.provide(NodeSqliteClient.layer({ filename: source })));
        yield* fs.writeFileString(
          path.join(directory, "settings.json"),
          '{"provider":"claude-code","mode":"auto"}',
        );
        yield* fs.makeDirectory(path.join(directory, "scratch"));
        yield* fs.writeFileString(
          path.join(directory, "scratch", "user-work.txt"),
          "retain user work",
        );
        yield* snapshot(destination);
        yield* migrate(destination);
        yield* body(directory, source, destination);
      } finally {
        yield* fs.remove(directory, { recursive: true, force: true });
      }
    });
  }

  it.effect(
    "a failed transcript batch resumes after reopening without duplicate events or lost messages",
    () =>
      Effect.gen(function* () {
        yield* withSeededCopy((_directory, source, destination) =>
          Effect.gen(function* () {
            const original = yield* hash(source);
            yield* Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              const importer = yield* Importer.LegacyV1ThreadImporter;
              yield* importer.reconcileShells;
              yield* sql`CREATE TRIGGER fail_import BEFORE INSERT ON orchestration_events
       WHEN NEW.event_id = 'migration:v1:message:message-075'
       BEGIN SELECT RAISE(ABORT, 'proof interrupted import'); END`;
              const failed = yield* Effect.result(importer.ensureTranscript(ThreadId.make("long")));
              NodeAssert.equal(failed._tag, "Failure");
              const count =
                (yield* sql`SELECT count(*) AS count FROM orchestration_v2_projection_messages WHERE thread_id='long'`)[0]!
                  .count;
              NodeAssert.ok(Number(count) > 2 && Number(count) < 130);
              NodeAssert.equal(
                (yield* sql`SELECT transcript_imported_at FROM orchestration_v2_legacy_imports WHERE thread_id='long'`)[0]!
                  .transcript_imported_at,
                null,
              );
            }).pipe(Effect.provide(importerLayer(destination)));
            const db = new NodeSqlite.DatabaseSync(destination);
            try {
              db.exec("DROP TRIGGER fail_import");
            } finally {
              db.close();
            }
            NodeAssert.equal((yield* migrate(destination)).length, 0);
            yield* Effect.gen(function* () {
              const importer = yield* Importer.LegacyV1ThreadImporter;
              const sql = yield* SqlClient.SqlClient;
              NodeAssert.equal((yield* importer.reconcileShells).importedThreadCount, 0);
              yield* importer.ensureTranscript(ThreadId.make("long"));
              NodeAssert.equal(
                (yield* sql`SELECT count(*) AS count FROM orchestration_v2_projection_messages WHERE thread_id='long'`)[0]!
                  .count,
                130,
              );
              NodeAssert.equal(
                (yield* sql`SELECT count(*) AS count FROM orchestration_events WHERE application_event_version=2 AND event_id LIKE 'migration:v1:message:%'`)[0]!
                  .count,
                130,
              );
              NodeAssert.equal(
                (yield* importer.ensureTranscript(ThreadId.make("long"))).importedMessageCount,
                0,
              );
              yield* sql`UPDATE orchestration_v2_projection_threads SET title='new V2 work' WHERE thread_id='long'`;
            }).pipe(Effect.provide(importerLayer(destination)));
            yield* snapshot(destination);
            const read = new NodeSqlite.DatabaseSync(destination, { readOnly: true });
            try {
              NodeAssert.equal(
                read
                  .prepare(
                    "SELECT title FROM orchestration_v2_projection_threads WHERE thread_id='long'",
                  )
                  .get()!.title,
                "new V2 work",
              );
            } finally {
              read.close();
            }
            NodeAssert.equal(yield* hash(source), original);
          }),
        );
      }),
  );

  it.effect(
    "failed copies never publish; orphan partial snapshots do not block retry; WAL commits are included",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectory({ prefix: "test-rig-v2-snapshot-" });
        const source = path.join(directory, "state.sqlite"),
          destination = path.join(directory, "statev2.sqlite");
        try {
          yield* fs.writeFileString(source, "not sqlite");
          NodeAssert.equal((yield* Effect.exit(snapshot(destination)))._tag, "Failure");
          NodeAssert.equal(yield* fs.exists(destination), false);
          yield* fs.remove(source);
          const orphan = path.join(directory, ".v2-import-interrupted");
          yield* fs.makeDirectory(orphan);
          yield* fs.writeFileString(path.join(orphan, "snapshot.sqlite"), "partial");
          const db = new NodeSqlite.DatabaseSync(source);
          try {
            db.exec(
              "PRAGMA journal_mode=WAL; CREATE TABLE proof(text TEXT); INSERT INTO proof VALUES ('committed'); BEGIN; INSERT INTO proof VALUES ('uncommitted');",
            );
            yield* snapshot(destination);
            const copy = new NodeSqlite.DatabaseSync(destination, { readOnly: true });
            try {
              NodeAssert.deepEqual(
                copy
                  .prepare("SELECT text FROM proof")
                  .all()
                  .map((row) => row.text),
                ["committed"],
              );
            } finally {
              copy.close();
            }
            db.exec("ROLLBACK");
          } finally {
            db.close();
          }
          const before = yield* hash(destination);
          yield* snapshot(destination);
          NodeAssert.equal(yield* hash(destination), before);
        } finally {
          yield* fs.remove(directory, { recursive: true, force: true });
        }
      }),
  );

  it.effect(
    "all fork metadata survives; side chats stay legacy-only and no native sessions/checkpoints are imported",
    () =>
      Effect.gen(function* () {
        yield* withSeededCopy((directory, source, destination) =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const settings = path.join(directory, "settings.json");
            const scratch = path.join(directory, "scratch");
            yield* Effect.gen(function* () {
              const importer = yield* Importer.LegacyV1ThreadImporter;
              const store = yield* ProjectionStore.ProjectionStoreV2;
              const sql = yield* SqlClient.SqlClient;
              yield* importer.reconcileShells;
              for (const id of ["long", "linked", "unavailable", "opencode"]) {
                const { thread } = yield* store.getThreadProjection(ThreadId.make(id));
                NodeAssert.equal(thread.title, id);
                NodeAssert.equal(thread.projectId, "project");
                NodeAssert.equal(thread.modelSelection?.model, "explicit-model");
                NodeAssert.equal(thread.interactionMode, "plan");
                NodeAssert.equal(thread.branch, "codex/saved");
                NodeAssert.equal(thread.worktreePath, "/tmp/proof-worktree");
                NodeAssert.equal(thread.activeProviderThreadId, null);
                NodeAssert.equal(thread.historyOrigin, "v1_import");
                NodeAssert.equal(DateTime.formatIso(thread.createdAt), timestamp);
                NodeAssert.equal(DateTime.formatIso(thread.updatedAt), timestamp);
                NodeAssert.equal(thread.settledOverride, "settled");
                for (const date of [
                  thread.settledAt,
                  thread.snoozedUntil,
                  thread.snoozedAt,
                  thread.pinnedAt,
                ])
                  NodeAssert.equal(DateTime.formatIso(date!), timestamp);
                NodeAssert.equal(thread.archivedAt === null, id !== "linked");
              }
              const linked = (yield* store.getThreadProjection(ThreadId.make("linked"))).thread;
              NodeAssert.equal(linked.providerInstanceId, "claude-code");
              NodeAssert.equal(linked.runtimeMode, "approval-required");
              NodeAssert.deepEqual(linked.pullRequestAssociation, {
                mode: "linked",
                provider: "github",
                reference: "https://github.com/lookvyr/test-rig/pull/42",
              });
              NodeAssert.equal(
                (yield* store.getThreadProjection(ThreadId.make("unavailable"))).thread
                  .providerInstanceId,
                "cursor",
              );
              NodeAssert.equal(
                (yield* store.getThreadProjection(ThreadId.make("opencode"))).thread
                  .providerInstanceId,
                "opencode",
              );
              NodeAssert.equal(
                (yield* sql`SELECT count(*) AS count FROM orchestration_v2_projection_threads WHERE thread_id='side'`)[0]!
                  .count,
                0,
              );
              NodeAssert.equal(
                (yield* sql`SELECT side_of_thread_id FROM projection_threads WHERE thread_id='side'`)[0]!
                  .side_of_thread_id,
                "long",
              );
              NodeAssert.equal(
                (yield* sql`SELECT provider_thread_id FROM projection_thread_sessions WHERE thread_id='long'`)[0]!
                  .provider_thread_id,
                "legacy-native-thread",
              );
              NodeAssert.equal(
                (yield* sql`SELECT checkpoint_ref FROM projection_turns WHERE thread_id='long'`)[0]!
                  .checkpoint_ref,
                "refs/test-rig/checkpoints/legacy",
              );
              NodeAssert.equal(
                (yield* sql`SELECT diff FROM checkpoint_diff_blobs WHERE thread_id='long'`)[0]!
                  .diff,
                "legacy diff retained",
              );
              for (const table of [
                "orchestration_v2_projection_provider_threads",
                "orchestration_v2_projection_checkpoints",
              ])
                NodeAssert.equal(
                  (yield* sql.unsafe<{ readonly count: number }>(
                    `SELECT count(*) AS count FROM ${table}`,
                  ))[0]!.count,
                  0,
                );
              NodeAssert.equal(
                (yield* sql`SELECT default_model_selection_json FROM projection_projects WHERE project_id='project'`)[0]!
                  .default_model_selection_json,
                '{"instanceId":"claude-code","model":"sonnet"}',
              );
            }).pipe(Effect.provide(importerLayer(destination)));
            NodeAssert.equal(
              yield* fs.readFileString(settings),
              '{"provider":"claude-code","mode":"auto"}',
            );
            NodeAssert.equal(
              yield* fs.readFileString(path.join(scratch, "user-work.txt")),
              "retain user work",
            );
          }),
        );
      }),
  );
  it.effect("opens only the separate V2 snapshot through the production persistence layer", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "test-rig-v2-layer-" });
      const source = path.join(directory, "state.sqlite");
      yield* seed.pipe(Effect.provide(NodeSqliteClient.layer({ filename: source })));
      const original = yield* hash(source);
      const readSchema = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return (yield* sql<{
          id: number;
        }>`SELECT max(migration_id) AS id FROM effect_sql_migrations`)[0]!.id;
      });
      for (let reopen = 0; reopen < 2; reopen++) {
        NodeAssert.equal(
          yield* readSchema.pipe(Effect.provide(makeV2SqlitePersistenceLive(directory))),
          42,
        );
      }
      NodeAssert.equal(
        yield* readSchema.pipe(Effect.provide(NodeSqliteClient.layer({ filename: source }))),
        39,
      );
      NodeAssert.equal(yield* hash(source), original);
      NodeAssert.ok(yield* fs.exists(path.join(directory, "statev2.sqlite")));
    }).pipe(Effect.scoped),
  );
});
