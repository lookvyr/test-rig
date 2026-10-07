import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ handled: { current: null as string | null } }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useRef: () => state.handled,
  useEffect: (effect: () => void) => effect(),
}));
import {
  useWorkspaceMutationRefresh,
  workspaceMutationRefreshToken,
} from "./useWorkspaceMutationRefresh";

beforeEach(() => {
  state.handled.current = null;
});

describe("workspace mutation refresh", () => {
  it("scopes the same mutation to each preview resource", () => {
    expect(workspaceMutationRefreshToken("file:/repo/README.md", "event-1")).not.toBe(
      workspaceMutationRefreshToken("diff:/repo", "event-1"),
    );
    expect(workspaceMutationRefreshToken("file:/repo/README.md", null)).toBeNull();
  });

  it("holds the latest workspace mutation while an editable file is saving, then catches up once", () => {
    const refresh = vi.fn();
    const resourceKey = "file:/repo/README.md";
    useWorkspaceMutationRefresh({ enabled: false, mutationId: "tool-1", resourceKey, refresh });
    useWorkspaceMutationRefresh({ enabled: false, mutationId: "tool-2", resourceKey, refresh });
    expect(refresh).not.toHaveBeenCalled();
    useWorkspaceMutationRefresh({ enabled: true, mutationId: "tool-2", resourceKey, refresh });
    expect(refresh).toHaveBeenCalledOnce();
    useWorkspaceMutationRefresh({ enabled: true, mutationId: "tool-2", resourceKey, refresh });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("refreshes another active resource even when the workspace mutation is unchanged", () => {
    const refresh = vi.fn();
    useWorkspaceMutationRefresh({ mutationId: "tool-1", resourceKey: "file:A", refresh });
    useWorkspaceMutationRefresh({ mutationId: "tool-1", resourceKey: "file:B", refresh });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
