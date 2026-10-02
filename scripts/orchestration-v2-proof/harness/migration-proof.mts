import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runV2Migrations } from "./migrations.mts";

NodeTest.test("fork schema 39 upgrades through forward-only V2 adaptations", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runV2Migrations;
      const rows =
        yield* sql`SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 38 ORDER BY migration_id`;
      NodeAssert.equal(rows.length, 5);
      NodeAssert.equal((yield* runV2Migrations).length, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
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
import { runMigrations } from "../apps/server/src/persistence/ForkMigrations.ts";
import { initializeV2Database } from "../apps/server/src/persistence/initializeV2Database.ts";
import * as EventStore from "../apps/server/src/orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../apps/server/src/orchestration-v2/ProjectionStore.ts";
import * as EventSink from "../apps/server/src/orchestration-v2/EventSink.ts";
import * as Importer from "../apps/server/src/orchestration-v2/legacy/LegacyV1ThreadImporter.ts";
import * as Handoff from "../apps/server/src/orchestration-v2/ContextHandoffService.ts";
import * as IdAllocator from "../apps/server/src/orchestration-v2/IdAllocator.ts";

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
      VALUES (${id},'project',${id},${JSON.stringify({ instanceId: provider, model: "explicit-model" })},${mode},'plan','codex/saved','/tmp/proof-worktree',${timestamp},${timestamp},${id === "linked" ? timestamp : null},'settled',${timestamp},${timestamp},${timestamp},${timestamp},${association},${sideOf})`;
  }
  yield* sql`INSERT INTO projection_thread_sessions (thread_id,status,provider_name,provider_session_id,provider_thread_id,updated_at)
    VALUES ('long','idle','codex','legacy-session','legacy-native-thread',${timestamp})`;
  yield* sql`INSERT INTO projection_turns (thread_id,turn_id,state,requested_at,checkpoint_turn_count,checkpoint_ref,checkpoint_status,checkpoint_files_json)
    VALUES ('long','legacy-turn','completed',${timestamp},1,'refs/test-rig/checkpoints/legacy','ready','[]')`;
  yield* sql`INSERT INTO checkpoint_diff_blobs (thread_id,from_turn_count,to_turn_count,diff,created_at)
    VALUES ('long',0,1,'legacy diff retained',${timestamp})`;
  for (let index = 0; index < 130; index++) {
    const date = new Date(Date.parse(timestamp) + index * 1000).toISOString();
    yield* sql`INSERT INTO projection_thread_messages (message_id,thread_id,role,text,attachments_json,is_streaming,created_at,updated_at)
      VALUES (${`message-${String(index).padStart(3, "0")}`},'long',${index % 2 ? "assistant" : "user"},${`Message ${index}: ` + "saved history ".repeat(1000)},${JSON.stringify(index === 0 ? [attachment] : [])},${index === 129 ? 1 : 0},${date},${date})`;
  }
});

NodeTest.test("imports fork metadata and a long transcript into the real V2 stores", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "test-rig-v2-fixture-"));
  const source = NodePath.join(directory, "state.sqlite");
  const destination = NodePath.join(directory, "statev2.sqlite");
  try {
    await Effect.runPromise(
      seed.pipe(Effect.provide(NodeSqliteClient.layer({ filename: source }))),
    );
    const original = NodeFS.readFileSync(source);
    await Effect.runPromise(
      initializeV2Database(destination).pipe(Effect.provide(NodeServices.layer)),
    );
    await Effect.runPromise(
      runV2Migrations.pipe(Effect.provide(NodeSqliteClient.layer({ filename: destination }))),
    );
    await Effect.runPromise(
      Effect.gen(function* () {
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
      ),
    );
    NodeAssert.deepEqual(NodeFS.readFileSync(source), original);
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

import * as NodeSqlite from "node:sqlite";
import * as NodeCrypto from "node:crypto";
import { deliverContextHandoffs } from "../apps/server/src/orchestration-v2/ContextHandoffDelivery.ts";
import { historyCost } from "../apps/server/src/orchestration-v2/ContextHandoffBudget.ts";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const snapshot = (destination: string) =>
  run(initializeV2Database(destination).pipe(Effect.provide(NodeServices.layer)));
const migrate = (filename: string) =>
  run(runV2Migrations.pipe(Effect.provide(NodeSqliteClient.layer({ filename }))));
const hash = (filename: string) =>
  NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(filename)).digest("hex");

async function withSeededCopy(
  body: (directory: string, source: string, destination: string) => Promise<void>,
) {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "test-rig-v2-recovery-"));
  const source = NodePath.join(directory, "state.sqlite");
  const destination = NodePath.join(directory, "statev2.sqlite");
  try {
    await run(seed.pipe(Effect.provide(NodeSqliteClient.layer({ filename: source }))));
    NodeFS.writeFileSync(
      NodePath.join(directory, "settings.json"),
      '{"provider":"claude-code","mode":"auto"}',
    );
    NodeFS.mkdirSync(NodePath.join(directory, "scratch"));
    NodeFS.writeFileSync(NodePath.join(directory, "scratch", "user-work.txt"), "retain user work");
    await snapshot(destination);
    await migrate(destination);
    await body(directory, source, destination);
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
}

NodeTest.test(
  "a failed transcript batch resumes after reopening without duplicate events or lost messages",
  async () => {
    await withSeededCopy(async (_directory, source, destination) => {
      const original = hash(source);
      await run(
        Effect.gen(function* () {
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
        }).pipe(Effect.provide(importerLayer(destination))),
      );
      const db = new NodeSqlite.DatabaseSync(destination);
      try {
        db.exec("DROP TRIGGER fail_import");
      } finally {
        db.close();
      }
      NodeAssert.equal((await migrate(destination)).length, 0);
      await run(
        Effect.gen(function* () {
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
        }).pipe(Effect.provide(importerLayer(destination))),
      );
      await snapshot(destination);
      const read = new NodeSqlite.DatabaseSync(destination, { readOnly: true });
      try {
        NodeAssert.equal(
          read
            .prepare("SELECT title FROM orchestration_v2_projection_threads WHERE thread_id='long'")
            .get()!.title,
          "new V2 work",
        );
      } finally {
        read.close();
      }
      NodeAssert.equal(hash(source), original);
    });
  },
);

NodeTest.test(
  "failed copies never publish; orphan partial snapshots do not block retry; WAL commits are included",
  async () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "test-rig-v2-snapshot-"));
    const source = NodePath.join(directory, "state.sqlite"),
      destination = NodePath.join(directory, "statev2.sqlite");
    try {
      NodeFS.writeFileSync(source, "not sqlite");
      await NodeAssert.rejects(snapshot(destination));
      NodeAssert.equal(NodeFS.existsSync(destination), false);
      NodeFS.unlinkSync(source);
      const orphan = NodePath.join(directory, ".v2-import-interrupted");
      NodeFS.mkdirSync(orphan);
      NodeFS.writeFileSync(NodePath.join(orphan, "snapshot.sqlite"), "partial");
      const db = new NodeSqlite.DatabaseSync(source);
      try {
        db.exec(
          "PRAGMA journal_mode=WAL; CREATE TABLE proof(text TEXT); INSERT INTO proof VALUES ('committed'); BEGIN; INSERT INTO proof VALUES ('uncommitted');",
        );
        await snapshot(destination);
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
      const before = hash(destination);
      await snapshot(destination);
      NodeAssert.equal(hash(destination), before);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  },
);

NodeTest.test(
  "all fork metadata survives; side chats stay legacy-only and no native sessions/checkpoints are imported",
  async () => {
    await withSeededCopy(async (directory, source, destination) => {
      const settings = NodePath.join(directory, "settings.json");
      const scratch = NodePath.join(directory, "scratch");
      await run(
        Effect.gen(function* () {
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
            (yield* store.getThreadProjection(ThreadId.make("opencode"))).thread.providerInstanceId,
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
            (yield* sql`SELECT diff FROM checkpoint_diff_blobs WHERE thread_id='long'`)[0]!.diff,
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
        }).pipe(Effect.provide(importerLayer(destination))),
      );
      NodeAssert.equal(
        NodeFS.readFileSync(settings, "utf8"),
        '{"provider":"claude-code","mode":"auto"}',
      );
      NodeAssert.equal(
        NodeFS.readFileSync(NodePath.join(scratch, "user-work.txt"), "utf8"),
        "retain user work",
      );
    });
  },
);

NodeTest.test(
  "copies and compares every message in an existing Test Rig schema-39 database",
  { skip: !process.env.TEST_RIG_PROOF_SOURCE },
  async () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "test-rig-v2-real-"));
    const source = NodePath.join(directory, "state.sqlite"),
      destination = NodePath.join(directory, "statev2.sqlite");
    const real = new NodeSqlite.DatabaseSync(process.env.TEST_RIG_PROOF_SOURCE!, {
      readOnly: true,
    });
    try {
      await NodeSqlite.backup(real, source);
    } finally {
      real.close();
    }
    try {
      const original = hash(source);
      const read = new NodeSqlite.DatabaseSync(source, { readOnly: true });
      const threads = read
        .prepare(
          "SELECT thread_id, model_selection_json, runtime_mode, interaction_mode, pull_request_association_json FROM projection_threads WHERE side_of_thread_id IS NULL",
        )
        .all();
      const messages = read
        .prepare(
          "SELECT message_id, thread_id, role, text, created_at, updated_at, attachments_json FROM projection_thread_messages WHERE role IN ('user','assistant') AND thread_id IN (SELECT thread_id FROM projection_threads WHERE side_of_thread_id IS NULL) ORDER BY created_at,message_id",
        )
        .all();
      const ledger = read
        .prepare(
          "SELECT migration_id,name,created_at FROM effect_sql_migrations ORDER BY migration_id",
        )
        .all();
      read.close();
      NodeAssert.equal(ledger.at(-1)!.migration_id, 39);
      await snapshot(destination);
      await migrate(destination);
      await run(
        Effect.gen(function* () {
          const importer = yield* Importer.LegacyV1ThreadImporter;
          const store = yield* ProjectionStore.ProjectionStoreV2;
          const sql = yield* SqlClient.SqlClient;
          yield* importer.reconcileShells;
          for (const row of threads) {
            const id = ThreadId.make(String(row.thread_id));
            yield* importer.ensureTranscript(id);
            const result = yield* store.getThreadProjection(id);
            NodeAssert.equal(result.thread.runtimeMode, row.runtime_mode);
            NodeAssert.deepEqual(
              result.thread.modelSelection,
              JSON.parse(String(row.model_selection_json)),
            );
            const expected = messages.filter((message) => message.thread_id === id);
            NodeAssert.equal(result.messages.length, expected.length);
            for (let index = 0; index < expected.length; index++) {
              const old = expected[index]!,
                next = result.messages[index]!;
              NodeAssert.equal(next.id, old.message_id);
              NodeAssert.equal(next.text, old.text);
              NodeAssert.equal(next.role, old.role);
              NodeAssert.equal(DateTime.formatIso(next.createdAt), old.created_at);
              NodeAssert.equal(DateTime.formatIso(next.updatedAt), old.updated_at);
              NodeAssert.deepEqual(
                next.attachments,
                JSON.parse(String(old.attachments_json ?? "[]")),
              );
            }
          }
          const migrated =
            yield* sql`SELECT migration_id,name,created_at FROM effect_sql_migrations WHERE migration_id<=39 ORDER BY migration_id`;
          NodeAssert.deepEqual(
            JSON.parse(JSON.stringify(migrated)),
            JSON.parse(JSON.stringify(ledger)),
          );
          NodeAssert.equal(yield* importer.pendingThreadCount, 0);
        }).pipe(Effect.provide(importerLayer(destination))),
      );
      NodeAssert.equal(hash(source), original);
      console.log(
        `Copied-data proof: ${threads.length} ordinary threads, ${messages.length} saved messages; original hash unchanged.`,
      );
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  },
);
