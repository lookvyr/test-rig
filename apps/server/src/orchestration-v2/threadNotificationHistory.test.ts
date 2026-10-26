import { assert, it } from "@effect/vitest";
import { EventId, ProjectId, ProviderInstanceId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { V2SqlitePersistenceMemory } from "../persistence/Layers/V2Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import {
  buildBoundedThreadProjection,
  decodeThreadHistoryCursor,
  selectHistoryPageFromCursor,
  THREAD_HISTORY_PAGE_POLICY,
  THREAD_HISTORY_TURN_SNAPSHOT_ROW_LIMIT,
} from "./threadHistoryPaging.ts";

const TestLayer = ProjectionStore.layer.pipe(Layer.provideMerge(V2SqlitePersistenceMemory));
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId: providerInstanceId, model: "gpt-5.4" };
const encodeUnknownJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const traceSqlStatements = () => {
  const statements: string[] = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        end(endTime, exit);
        const query = span.attributes.get("db.query.text");
        if (typeof query === "string") statements.push(query);
      };
      return span;
    },
  });
  return { statements, tracer };
};

it.layer(TestLayer)("notification wake history", (it) => {
  it.effect("caps a SQL window by runs that a notification started", () =>
    Effect.gen(function* () {
      // A thread woken by PR watches: 12 user turns, then 400 runs that a
      // notification started, with a user turn every 50 runs. The user-turn
      // window reached back to the 12th-newest user turn and read almost every row.
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const sql = yield* SqlClient.SqlClient;
      const now = yield* DateTime.now;
      const nowIso = DateTime.formatIso(now);
      const threadId = ThreadId.make("thread:notification-turn-pages");
      yield* projectionStore.apply({
        id: EventId.make("event:notification-turn-pages:thread"),
        type: "thread.created",
        threadId,
        occurredAt: now,
        payload: {
          createdBy: "user",
          creationSource: "web",
          id: threadId,
          projectId: ProjectId.make("project:notification-turn-pages"),
          title: "Woken by notifications",
          providerInstanceId,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
      });

      const startedRuns = 412;
      const allIds: string[] = [];
      const startIds: string[] = [];
      let ordinal = 0;
      const itemRow = (runId: string, item: Record<string, unknown>) => {
        ordinal += 1;
        const id = `turn-item:notification-turn-pages:${ordinal}`;
        allIds.push(id);
        return {
          turn_item_id: id,
          thread_id: threadId,
          run_id: runId,
          node_id: null,
          provider_thread_id: null,
          provider_turn_id: null,
          parent_item_id: null,
          ordinal,
          type: String(item.type),
          status: "completed",
          updated_at: nowIso,
          payload_json: encodeUnknownJsonString({
            id,
            threadId,
            runId,
            nodeId: null,
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal,
            status: "completed",
            title: null,
            startedAt: nowIso,
            completedAt: nowIso,
            updatedAt: nowIso,
            ...item,
          }),
        };
      };
      const command = { type: "command_execution", input: "command", output: "x", exitCode: 0 };
      const notification = (summary: string) => ({
        type: "notification",
        source: { kind: "monitor" },
        outcome: "completed",
        summary,
      });
      // The newest run is a wake queued behind the last one. It has no items yet,
      // like a run cancelled before it started.
      for (let run = 1; run <= startedRuns + 1; run += 1) {
        const runId = `run:notification-turn-pages:${run}`;
        const status = run > startedRuns ? "queued" : "completed";
        yield* sql`
          INSERT INTO orchestration_v2_projection_runs (
            run_id, thread_id, ordinal, provider, provider_thread_id, status,
            requested_at, completed_at, payload_json
          ) VALUES (
            ${runId}, ${threadId}, ${run}, 'codex', NULL, ${status}, ${nowIso}, ${nowIso},
            ${encodeUnknownJsonString({
              id: runId,
              threadId,
              ordinal: run,
              providerInstanceId,
              modelSelection,
              providerThreadId: null,
              userMessageId: `message:notification-turn-pages:${run}`,
              rootNodeId: `node:notification-turn-pages:${run}`,
              activeAttemptId: null,
              status,
              requestedAt: nowIso,
              startedAt: nowIso,
              completedAt: nowIso,
              checkpointId: null,
              contextHandoffId: null,
            })}
          )
        `;
        if (run > startedRuns) continue;
        const start =
          run <= 12 || run % 50 === 0
            ? {
                type: "user_message",
                createdBy: "user",
                creationSource: "web",
                messageId: `message:notification-turn-pages:${run}`,
                inputIntent: "turn_start",
                text: `Turn ${run}`,
                attachments: [],
              }
            : notification(`Wake ${run}`);
        // A row of the run (a handoff) can come before its first input. A wake
        // steered into the running turn follows it and starts no turn.
        const rows = [
          itemRow(runId, command),
          itemRow(runId, start),
          itemRow(runId, command),
          itemRow(runId, notification(`Steer ${run}`)),
        ];
        startIds.push(rows[1]!.turn_item_id);
        yield* sql`INSERT INTO orchestration_v2_projection_turn_items ${sql.insert(rows)}`;
      }

      const { statements, tracer } = traceSqlStatements();
      const initial = yield* projectionStore
        .getThreadSnapshotWindow(threadId, { rowLimit: 77, userTurnLimit: 10 })
        .pipe(Effect.withTracer(tracer));
      // The 152 newest turns are the 152 newest started runs, 261 to 412. Only
      // three of them are user turns, short of the 12 the user-turn window needs.
      assert.deepEqual(
        initial.projection.turnItems.map((item) => String(item.id)),
        allIds.slice(-THREAD_HISTORY_TURN_SNAPSHOT_ROW_LIMIT),
      );
      // Each run's first input is read by run ID, newest run first, never by a
      // walk over every turn item in the thread.
      const windowStatement = statements.find((statement) => statement.includes("run_starts"));
      assert.isDefined(windowStatement);
      const windowPlan = yield* sql.unsafe<{ readonly detail: string }>(
        `EXPLAIN QUERY PLAN ${windowStatement}`,
      );
      const windowPlanDetails = windowPlan.map((row) => row.detail);
      assert.include(
        windowPlanDetails,
        "SEARCH recent_run USING INDEX orchestration_v2_projection_runs_thread_ordinal_idx (thread_id=? AND ordinal<?)",
      );
      assert.include(
        windowPlanDetails,
        "SEARCH first_input USING INDEX orchestration_v2_projection_turn_items_run_ordinal_idx (run_id=?)",
      );
      const bounded = buildBoundedThreadProjection({
        projection: initial.projection,
        snapshotSequence: 0,
      });
      assert.deepEqual(
        bounded.projection.visibleTurnItems.map((row) => row.sourceItemId),
        allIds.slice(-THREAD_HISTORY_PAGE_POLICY.maxTurnItems),
      );
      const loaded = bounded.projection.visibleTurnItems.map((row) => String(row.sourceItemId));
      let cursor = bounded.historyCursor;
      for (let pages = 0; cursor !== null; pages += 1) {
        assert.isBelow(pages, 30);
        const anchor = decodeThreadHistoryCursor(cursor);
        const snapshot = yield* projectionStore.getThreadSnapshotWindow(threadId, {
          rowLimit: 77,
          userTurnLimit: 20,
          anchorItemId: TurnItemId.make(anchor.si),
          anchorThreadId: ThreadId.make(anchor.st),
        });
        // Older windows stay bounded too.
        assert.isAtMost(
          snapshot.projection.turnItems.length,
          THREAD_HISTORY_TURN_SNAPSHOT_ROW_LIMIT,
        );
        const page = selectHistoryPageFromCursor({
          items: snapshot.projection.visibleTurnItems,
          cursor,
          snapshotSequence: 0,
        });
        loaded.unshift(...page.items.map((row) => String(row.sourceItemId)));
        cursor = page.nextCursor;
      }
      assert.deepEqual(loaded, allIds);
    }),
  );
});
