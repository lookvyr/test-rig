import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, expect, it, vi } from "vite-plus/test";

import { makeTestThread } from "../../test/threadFixtures";
import { usePersistThreadSettings } from "./usePersistThreadSettings";

const commands = vi.hoisted(() => ({
  updateMetadata: vi.fn(),
  setRuntimeMode: vi.fn(),
  setInteractionMode: vi.fn(),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <A>(callback: A) => callback,
}));
vi.mock("../../state/threads", () => ({ threadEnvironment: commands }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));

beforeEach(() => {
  for (const command of Object.values(commands)) {
    command.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  }
});

it("leaves the provider/model transition to Send while persisting other thread settings", async () => {
  const environmentId = EnvironmentId.make("test");
  const thread = makeTestThread({ environmentId, branch: "main" });
  const persist = usePersistThreadSettings(environmentId, thread);
  const sendSnapshot = {
    threadId: thread.id,
    createdAt: thread.createdAt,
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet-5",
    },
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
  };

  expect((await persist(sendSnapshot))._tag).toBe("Success");
  expect(commands.updateMetadata).not.toHaveBeenCalled();
  expect(commands.setRuntimeMode).not.toHaveBeenCalled();
  expect(commands.setInteractionMode).not.toHaveBeenCalled();

  await persist({ ...sendSnapshot, branch: "feature/current" });
  expect(commands.updateMetadata).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { threadId: thread.id, branch: "feature/current", worktreePath: null },
  });
});
