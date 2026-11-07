import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { PrimaryConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import { remoteHttpClientLayer } from "../rpc/http.ts";
import { fetchEnvironmentPullRequestDiff } from "./pullRequestDiffHttp.ts";

const target = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("env"),
  label: "Review",
  httpBaseUrl: "https://example.test",
  wsBaseUrl: "wss://example.test",
});
const prepared: PreparedConnection = {
  environmentId: target.environmentId,
  label: target.label,
  httpBaseUrl: target.httpBaseUrl,
  socketUrl: target.wsBaseUrl,
  target,
  httpAuthorization: { _tag: "Bearer", token: "test-token" },
};
const reference = { projectId: ProjectId.make("project"), repository: "owner/repo", number: 7 };
describe("PR diff HTTP transport", () => {
  it.effect("preserves the provider's failure and uses the paired environment credentials", () =>
    Effect.gen(function* () {
      const failed = yield* fetchEnvironmentPullRequestDiff(prepared, reference).pipe(
        Effect.flip,
        Effect.provide(
          remoteHttpClientLayer(async (url, init) => {
            const request = new Request(url, init);
            expect(request.url).toBe("https://example.test/api/pull-requests/diff");
            expect(request.headers.get("authorization")).toBe("Bearer test-token");
            return Response.json(
              { _tag: "PullRequestOperationError", operation: "diff", detail: "Patch unavailable" },
              { status: 502 },
            );
          }),
        ),
      );
      expect(failed).toMatchObject({
        _tag: "PullRequestOperationError",
        detail: "Patch unavailable",
      });
    }),
  );
  it.effect("recognizes a missing endpoint on an older paired server", () =>
    Effect.gen(function* () {
      const failed = yield* fetchEnvironmentPullRequestDiff(prepared, reference).pipe(
        Effect.flip,
        Effect.provide(remoteHttpClientLayer(async () => new Response(null, { status: 404 }))),
      );
      expect(failed).toMatchObject({
        _tag: "RemoteEnvironmentAuthUndeclaredStatusError",
        status: 404,
      });
    }),
  );
});
