import { EnvironmentId, type DatabaseStorageStatus } from "@t3tools/contracts";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const state = vi.hoisted(() => ({
  data: null as DatabaseStorageStatus | null,
  error: null as string | null,
  isPending: false,
  refresh: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { ...actual, useState: reactHookHarness.useState };
});
vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});
vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => state }));
vi.mock("../../state/server", () => ({ serverEnvironment: { databaseStorage: vi.fn() } }));
vi.mock("../../hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copyToClipboard: state.copy }),
}));

import { DatabaseStorageNotice } from "./DatabaseStorageNotice";

const render = () => {
  hooks.beginRender();
  return DatabaseStorageNotice({ environmentId: EnvironmentId.make("local"), label: "This Mac" });
};
const button = (label: string) =>
  visitElements(render(), (element) => element.props.children === label);
const click = (label: string) => {
  const found = button(label);
  if (!found) throw new Error(`Missing ${label}`);
  (found.props.onClick as () => void)();
};

beforeEach(() => {
  hooks.reset();
  vi.clearAllMocks();
  state.data = null;
  state.error = null;
  state.isPending = false;
});

it("keeps loading and failed reads actionable without exposing a repair button", () => {
  expect(render()).toBeTruthy();
  expect(button("Copy inspect command")).toBeNull();
  state.error = "Connection lost";
  expect(render()).toBeTruthy();
  click("Refresh storage");
  expect(state.refresh).toHaveBeenCalledOnce();
});

it("copies the exact inspect command and lets refresh restore a dismissed reclamation notice", () => {
  const inspectCommand = "node '/Rig Space/bin.ts' doctor --database '/fixture/dev/statev2.sqlite'";
  state.data = { databaseBytes: 2 * 1024 ** 3, reclaimableBytes: 1024 ** 3, inspectCommand };
  expect(button("Dismiss notice")).not.toBeNull();
  click("Copy inspect command");
  expect(state.copy).toHaveBeenCalledExactlyOnceWith(inspectCommand);
  click("Dismiss notice");
  expect(button("Dismiss notice")).toBeNull();
  expect(button("Copy inspect command")).not.toBeNull();
  click("Refresh storage");
  expect(button("Dismiss notice")).not.toBeNull();
  state.data = { ...state.data, reclaimableBytes: 0 };
  expect(button("Dismiss notice")).toBeNull();
});
