import { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  executeAtomQuery: (_registry: unknown, input: { directoryPath: string }) =>
    mocks.execute(input.directoryPath),
}));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("~/state/projects", () => ({
  projectEnvironment: { listEntries: ({ input }: { input: unknown }) => input },
}));
import { useDirectoryEntries } from "./useDirectoryEntries";

let renderer: ReactTestRenderer | undefined;
let current: ReturnType<typeof useDirectoryEntries>;
function DirectoryTree() {
  const directories = useDirectoryEntries(EnvironmentId.make("local"), "/repo");
  useEffect(() => {
    current = directories;
  }, [directories]);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.execute.mockReset().mockImplementation(async (path: string) => ({
    _tag: "Success",
    value: {
      entries:
        path === ""
          ? [
              { path: "ignored", kind: "directory", ignored: true },
              { path: "src", kind: "directory" },
            ]
          : [{ path: `${path}/file.txt`, kind: "file" }],
      truncated: false,
    },
  }));
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    renderer = create(<DirectoryTree />);
  });
}

describe("lazy directory browsing", () => {
  it("loads only root until a directory is requested, including ignored directories", async () => {
    await mount();
    expect(mocks.execute.mock.calls).toEqual([[""]]);
    expect(current.entries).toContainEqual({ path: "ignored", kind: "directory", ignored: true });
    await act(async () => {
      await current.load("ignored");
    });
    expect(current.entries).toContainEqual({ path: "ignored/file.txt", kind: "file" });
    expect(mocks.execute.mock.calls).toEqual([[""], ["ignored"]]);
  });

  it("refreshes visited folders while retaining cached data on failure and allowing retry", async () => {
    await mount();
    await act(async () => {
      await current.load("src");
    });
    mocks.execute.mockImplementationOnce(async () => ({
      _tag: "Failure",
      cause: Cause.fail(new Error("Directory unavailable")),
    }));
    await act(async () => {
      await current.load("src", true);
    });
    expect(current.error).toBe("Directory unavailable");
    expect(current.entries).toContainEqual({ path: "src/file.txt", kind: "file" });
    await act(async () => {
      current.refresh();
    });
    expect(current.error).toBeNull();
    expect(mocks.execute.mock.calls.map(([path]) => path)).toEqual(["", "src", "src", "", "src"]);
    expect(current.isPending).toBe(false);
  });
});
