import {
  PullRequestOperationError,
  PullRequestUnavailableError,
  type PullRequestDiffInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";

const isPullRequestError = Schema.is(
  Schema.Union([PullRequestOperationError, PullRequestUnavailableError]),
);
export const fetchEnvironmentPullRequestDiff = (
  prepared: PreparedConnection,
  diff: PullRequestDiffInput,
) =>
  executeAuthenticatedEnvironmentHttpRequest({
    prepared,
    group: "pullRequests",
    method: "POST",
    timeoutMs: 60_000,
    preserveError: isPullRequestError,
    url: (baseUrl) => environmentEndpointUrl(baseUrl, "/api/pull-requests/diff"),
    request: ({ client, headers }) => client.diff({ payload: diff, headers }),
  });
