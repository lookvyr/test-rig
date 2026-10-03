import * as Effect from "effect/Effect";
import Migration0 from "./OrchestrationV2/LegacyPrerequisites/ProjectionThreadsPinOrderKey.ts";
import Migration1 from "./OrchestrationV2/LegacyPrerequisites/ProjectionThreadLinkedPullRequest.ts";
import Migration2 from "./OrchestrationV2/LegacyPrerequisites/ProjectionThreadsUnsettledAt.ts";
import Migration3 from "./OrchestrationV2/LegacyPrerequisites/ProjectionThreadBranchPullRequest.ts";
import Migration4 from "./OrchestrationV2/LegacyPrerequisites/ProjectionThreadsActiveOrderKey.ts";
import Migration5 from "./OrchestrationV2/LegacyPrerequisites/ProjectionThreadPullRequests.ts";
import Migration6 from "./OrchestrationV2/LegacyPrerequisites/ProjectionThreadMessageContext.ts";
import Migration7 from "./OrchestrationV2/LegacyPrerequisites/ProjectionThreadsAutoSettleDisabledAt.ts";

export default Effect.gen(function* () {
  yield* Migration0;
  yield* Migration1;
  yield* Migration2;
  yield* Migration3;
  yield* Migration4;
  yield* Migration5;
  yield* Migration6;
  yield* Migration7;
});
