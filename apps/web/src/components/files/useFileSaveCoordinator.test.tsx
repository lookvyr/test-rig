import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { act, StrictMode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useFileSaveCoordinator } from "./useFileSaveCoordinator";

const mocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
  confirm: vi.fn(),
  pending: vi.fn(),
}));
vi.mock("~/state/projects", () => ({ projectEnvironment: { writeFile: {} } }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => mocks.writeFile }));
vi.mock("./projectFilesQueryState", () => ({ confirmProjectFileQueryData: mocks.confirm }));

const environmentId = EnvironmentId.make("local");
let renderer: ReactTestRenderer | undefined;

function FileEditor() {
  const coordinator = useFileSaveCoordinator({
    environmentId,
    cwd: "/scratch/chat",
    relativePath: "note.txt",
    onPendingChange: mocks.pending,
  });
  return <button onClick={() => coordinator.change("edited contents")}>Edit</button>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.writeFile.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  mocks.confirm.mockReset();
  mocks.pending.mockReset();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mountEditor() {
  await act(async () => {
    renderer = create(
      <StrictMode>
        <FileEditor />
      </StrictMode>,
    );
  });
  return renderer!.root.findByType("button").props.onClick as () => void;
}

describe("file saving across React effect lifecycles", () => {
  it("persists edits after StrictMode replays mount effects", async () => {
    const edit = await mountEditor();
    await act(async () => edit());
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { cwd: "/scratch/chat", relativePath: "note.txt", contents: "edited contents" },
    });
    expect(mocks.confirm).toHaveBeenCalledWith(
      environmentId,
      "/scratch/chat",
      "note.txt",
      "edited contents",
    );
    expect(mocks.pending.mock.calls).toEqual([
      ["note.txt", true],
      ["note.txt", false],
    ]);
  });

  it("flushes on close and ignores callbacks from the closed editor", async () => {
    const edit = await mountEditor();
    await act(async () => edit());
    await act(async () => renderer?.unmount());
    renderer = undefined;
    await act(async () => vi.runAllTimersAsync());

    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    edit();
    await act(async () => vi.runAllTimersAsync());
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
  });
});
