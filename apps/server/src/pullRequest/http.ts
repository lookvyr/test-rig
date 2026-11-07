import { AuthOrchestrationOperateScope, EnvironmentHttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import { PullRequestService } from "./PullRequestService.ts";

export const pullRequestHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "pullRequests",
  Effect.fnUntraced(function* (handlers) {
    const service = yield* PullRequestService;
    return handlers.handle(
      "diff",
      Effect.fn("environment.pullRequests.diff")(function* ({ payload, endpoint }) {
        yield* annotateEnvironmentRequest(endpoint.name);
        yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
        return yield* service.withRoutingCredential(payload, service.diff(payload));
      }),
    );
  }),
);
