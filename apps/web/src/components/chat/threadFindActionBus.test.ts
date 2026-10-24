import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  findForMessageMatch,
  requestThreadFindQuery,
  subscribeThreadFindQuery,
  takeThreadFindQuery,
} from "./threadFindActionBus";

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("delivers once to the exact environment and thread, now or after navigation", () => {
  const listener = vi.fn();
  const unsubscribe = subscribeThreadFindQuery(listener);
  requestThreadFindQuery("env-a:thread", { query: "needle", messageId: "message-2" });
  expect(listener).toHaveBeenCalledOnce();
  expect(takeThreadFindQuery("env-b:thread")).toBeNull();
  expect(takeThreadFindQuery("env-a:thread")).toEqual({ query: "needle", messageId: "message-2" });
  expect(takeThreadFindQuery("env-a:thread")).toBeNull();
  unsubscribe();
  requestThreadFindQuery("other", { query: "stale" });
  expect(listener).toHaveBeenCalledOnce();
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 31_000);
  expect(takeThreadFindQuery("other")).toBeNull();
});

it("chooses a literal snippet word for indexed multiword and accent matches", () => {
  expect(
    findForMessageMatch({ snippet: "Café refreshes the sidebar", messageId: "m" }, "sidebar cafe"),
  ).toEqual({ query: "sidebar", messageId: "m" });
  expect(findForMessageMatch({ snippet: "Café reconnect", messageId: "m" }, "cafe")).toEqual({
    query: "Café",
    messageId: "m",
  });
});

it("chooses a reachable rendered word for valid mid-word matches", () => {
  expect(
    findForMessageMatch({ snippet: "appheader and appfooter", messageId: "m" }, "header footer"),
  ).toEqual({ query: "appheader", messageId: "m" });
});
