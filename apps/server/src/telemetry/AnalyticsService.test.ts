import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/unstable/http";

import * as AnalyticsService from "./AnalyticsService.ts";

it.effect("keeps production analytics permanently inert", () => {
  let requests = 0;

  return Effect.gen(function* () {
    const analytics = yield* AnalyticsService.AnalyticsService;

    yield* analytics.record("server.boot.heartbeat", {
      posthogHost: "https://hostile-analytics.invalid",
    });
    yield* analytics.flush;

    assert.equal(requests, 0);
  }).pipe(
    Effect.provide(AnalyticsService.layer),
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make(() => {
        requests += 1;
        return Effect.die("Sightseer analytics must not make HTTP requests");
      }),
    ),
  );
});
