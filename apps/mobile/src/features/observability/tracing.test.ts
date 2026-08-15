import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { RelayClientTracer } from "@t3tools/shared/relayTracing";

import { makeTracingLayer } from "./tracing";

it.effect("keeps mobile OTLP disabled under hostile configuration", () => {
  const tracingLayer = makeTracingLayer();

  return Effect.gen(function* () {
    const tracer = yield* RelayClientTracer;
    expect(Option.isNone(tracer)).toBe(true);
  }).pipe(Effect.provide(tracingLayer));
});
