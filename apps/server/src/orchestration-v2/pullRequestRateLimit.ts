import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { PullRequestOperationError } from "@t3tools/contracts";
import { PullRequestProviderError } from "../pullRequest/PullRequestProvider.ts";

const isProviderError = Schema.is(PullRequestProviderError);
const isOperationError = Schema.is(PullRequestOperationError);

/** Host pauses are retryable reads, rather than failures of the watched request. */
export function pullRequestRateLimitFailure(cause: Cause.Cause<unknown>) {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));
  return isOperationError(error) &&
    isProviderError(error.cause) &&
    error.cause.reason === "rate-limited"
    ? error.cause
    : null;
}
