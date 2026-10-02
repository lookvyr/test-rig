import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import { migrationEntries } from "../apps/server/src/persistence/ForkMigrations.ts";
import pinOrder from "../apps/server/src/persistence/Migrations/038_ProjectionThreadsPinOrderKey.ts";
import linkedPR from "../apps/server/src/persistence/Migrations/042_ProjectionThreadLinkedPullRequest.ts";
import unsettled from "../apps/server/src/persistence/Migrations/043_ProjectionThreadsUnsettledAt.ts";
import branchPR from "../apps/server/src/persistence/Migrations/048_ProjectionThreadBranchPullRequest.ts";
import activeOrder from "../apps/server/src/persistence/Migrations/049_ProjectionThreadsActiveOrderKey.ts";
import pullRequests from "../apps/server/src/persistence/Migrations/050_ProjectionThreadPullRequests.ts";
import messageContext from "../apps/server/src/persistence/Migrations/051_ProjectionThreadMessageContext.ts";
import autoSettle from "../apps/server/src/persistence/Migrations/054_ProjectionThreadsAutoSettleDisabledAt.ts";
import v2 from "../apps/server/src/persistence/Migrations/055_OrchestrationV2.ts";
import indexes from "../apps/server/src/persistence/Migrations/056_RemoveRedundantProjectionIndexes.ts";

// Historical Test Rig entries remain unchanged. Only new entries apply to the V2 copy.
// Do not import upstream's automatic default-model/settlement rewrites.
const prerequisites = Effect.gen(function* () {
  yield* pinOrder;
  yield* linkedPR;
  yield* unsettled;
  yield* branchPR;
  yield* activeOrder;
  yield* pullRequests;
  yield* messageContext;
  yield* autoSettle;
});
export const runV2Migrations = Migrator.make({})({
  loader: Migrator.fromRecord(
    Object.fromEntries([
      ...migrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration]),
      ["40_ForkV2Prerequisites", prerequisites],
      ["41_OrchestrationV2", v2],
      ["42_V2ProjectionIndexes", indexes],
    ]),
  ),
});
