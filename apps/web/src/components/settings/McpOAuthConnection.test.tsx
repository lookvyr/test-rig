import { beforeEach, expect, it, vi } from "vite-plus/test";
import type { McpOAuthBeginResult, McpOAuthStatus } from "@t3tools/contracts";
import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const openExternal = vi.hoisted(() => vi.fn());
vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({ shell: { openExternal } }),
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

import { McpOAuthConnection } from "./McpOAuthConnection";

const flow = { flowId: "flow-1", authorizationUrl: "https://login.example/authorize" };
const onBegin = vi.fn<() => Promise<McpOAuthBeginResult>>(async () => flow);
const onComplete = vi.fn(async () => {});
const onSignOut = vi.fn(async () => {});
const onRefresh = vi.fn();
let status: McpOAuthStatus;
const render = () => {
  hooks.beginRender();
  return McpOAuthConnection({
    status,
    error: null,
    pending: false,
    disabled: false,
    onBegin,
    onComplete,
    onSignOut,
    onRefresh,
  });
};
const button = (label: string) => {
  const found = visitElements(render(), (element) => element.props.children === label);
  if (!found) throw new Error(`Missing ${label}`);
  return found;
};
const click = (label: string) => (button(label).props.onClick as () => Promise<void>)();

beforeEach(() => {
  hooks.reset();
  vi.clearAllMocks();
  status = { serverName: "example", projectId: null, state: "signed-out", error: null };
});

it("signs in without a provider session and completes a remote browser callback", async () => {
  await click("Sign in");
  expect(onBegin).toHaveBeenCalledOnce();
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(flow.authorizationUrl);
  const callback = "http://remote.example/oauth/mcp/callback?code=one&state=two";
  const input = visitElements(
    render(),
    (element) => element.props["aria-label"] === "Sign-in callback URL",
  );
  (input!.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: callback },
  });
  await click("Complete sign-in");
  expect(onComplete).toHaveBeenCalledExactlyOnceWith({
    flowId: flow.flowId,
    callbackUrl: callback,
  });
  expect(onRefresh).toHaveBeenCalledTimes(2);
  expect(
    visitElements(render(), (element) => element.props["aria-label"] === "Sign-in callback URL"),
  ).toBeNull();
});

it("makes expired credentials visible and allows removing the shared sign-in", async () => {
  status = { ...status, state: "expired" };
  expect(
    visitElements(render(), (element) => element.props.children === "Sign-in expired"),
  ).not.toBeNull();
  await click("Sign out");
  expect(onSignOut).toHaveBeenCalledOnce();
  expect(onRefresh).toHaveBeenCalledOnce();
});

it("refreshes an existing sign-in without opening a browser when authorization is unnecessary", async () => {
  onBegin.mockResolvedValueOnce({ flowId: null, authorizationUrl: null });
  await click("Sign in");
  expect(openExternal).not.toHaveBeenCalled();
  expect(onRefresh).toHaveBeenCalledOnce();
  expect(
    visitElements(render(), (element) => element.props["aria-label"] === "Sign-in callback URL"),
  ).toBeNull();
});
