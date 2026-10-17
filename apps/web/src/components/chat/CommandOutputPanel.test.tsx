import { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  data: { output: { text: "first line\n", truncated: false }, running: true },
  error: null as string | null,
}));
vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => state }));
vi.mock("../../state/orchestration", () => ({
  orchestrationEnvironment: { commandOutput: vi.fn() },
}));
vi.mock("../../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../../state/entities", () => ({ useServerConfigs: () => new Map() }));

import { CommandOutputPanel } from "./CommandOutputPanel";

let renderer: ReactTestRenderer;
const scroller = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 };
const props = {
  environmentId: EnvironmentId.make("local"),
  threadId: ThreadId.make("thread"),
  itemId: TurnItemId.make("command"),
};
const update = () => act(() => renderer.update(<CommandOutputPanel {...props} />));
beforeEach(() => {
  state.data = { output: { text: "first line\n", truncated: false }, running: true };
  state.error = null;
  Object.assign(scroller, { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
  act(() => {
    renderer = create(<CommandOutputPanel {...props} />, {
      createNodeMock: (element) =>
        element.type === "div" && (element.props as { onScroll?: unknown }).onScroll
          ? scroller
          : null,
    });
  });
});
afterEach(() => act(() => renderer.unmount()));

it("keeps the bounded tail visible with an actionable stream error", () => {
  state.error = "Connection lost";
  update();
  expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain(
    "Collapse and reopen",
  );
  expect(JSON.stringify(renderer.toJSON())).toContain("first line");
});

it("follows the tail until scrolled upward and resumes only at the bottom", () => {
  expect(scroller.scrollTop).toBe(1000);
  const scrollPanel = renderer.root.findByProps({
    className: "max-h-80 overflow-auto text-muted-foreground",
  });
  scroller.scrollTop = 100;
  act(() => scrollPanel.props.onScroll({ currentTarget: scroller }));
  state.data = { ...state.data, output: { text: "second line\n", truncated: false } };
  scroller.scrollHeight = 1200;
  update();
  expect(scroller.scrollTop).toBe(100);
  scroller.scrollTop = 1000;
  act(() => scrollPanel.props.onScroll({ currentTarget: scroller }));
  state.data = { ...state.data, output: { text: "third line\n", truncated: true } };
  scroller.scrollHeight = 1400;
  update();
  expect(scroller.scrollTop).toBe(1400);
  expect(JSON.stringify(renderer.toJSON())).toContain("Earlier output not shown");
});
