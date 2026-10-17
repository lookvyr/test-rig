import { expect, it } from "vite-plus/test";

import {
  OpenCodeReplayController,
  OpenCodeReplayMismatchError,
} from "./OpenCodeReplayController.testkit.ts";

it("preserves the first mismatch when later requests or scope cleanup reach the replay", async () => {
  const controller = new OpenCodeReplayController({
    provider: "opencode",
    protocol: "opencode2-http.sse",
    version: "2.0.18",
    scenario: "first-failure",
    entries: [{ type: "expect_outbound", frame: { type: "session.create", input: "expected" } }],
  });
  const first = await controller
    .expectOutbound({ type: "session.create", input: "wrong" })
    .catch((cause: unknown) => cause);
  expect(first).toBeInstanceOf(OpenCodeReplayMismatchError);
  expect(first).toMatchObject({ cursor: 0, actual: { type: "session.create", input: "wrong" } });

  await expect(controller.expectOutbound({ type: "event.subscribe" })).rejects.toBe(first);
  // Even the originally expected request must not resume a failed transcript.
  await expect(
    controller.expectOutbound({ type: "session.create", input: "expected" }),
  ).rejects.toBe(first);
  let cleanupFailure: unknown;
  try {
    controller.assertComplete();
  } catch (cause) {
    cleanupFailure = cause;
  }
  expect(cleanupFailure).toBe(first);
  expect(controller.finished).toBe(false);
});
