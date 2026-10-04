import { expect, it } from "@effect/vitest";
import { turnScopedSelectionTransition } from "./ProviderSelectionTransition.ts";

it("applies native provider selection changes on the next turn", () => {
  expect(turnScopedSelectionTransition()).toEqual({ type: "apply_on_next_turn" });
});
