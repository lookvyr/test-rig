import { beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useNewProject } from "./useNewProject";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  wait: vi.fn(),
  open: vi.fn(),
  route: { state: { location: { href: "/draft/original" } } },
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => mocks.route }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => mocks.create }));
vi.mock("../state/projects", () => ({ projectEnvironment: { createNew: {} } }));
vi.mock("../state/entities", () => ({ waitForProject: mocks.wait }));
vi.mock("./useHandleNewThread", () => ({ useNewThreadHandler: () => mocks.open }));
vi.mock("../components/ui/toast", () => ({
  toastManager: { add: vi.fn() },
  stackedThreadToast: (value: object) => value,
}));
const input = { environmentId: EnvironmentId.make("local"), name: "Project" };
beforeEach(() => {
  mocks.route.state.location.href = "/draft/original";
  mocks.create.mockReset().mockResolvedValue({
    _tag: "Success",
    value: { projectId: ProjectId.make("new"), workspaceRoot: "/projects/new" },
  });
  mocks.open.mockReset().mockResolvedValue(undefined);
  mocks.wait.mockReset().mockResolvedValue({ id: "new" });
});

it("keeps a created project without taking focus after the user navigates away", async () => {
  mocks.wait.mockImplementation(async () => {
    mocks.route.state.location.href = "/thread/other";
    return { id: "new" };
  });
  expect(await useNewProject()(input)).toBe(true);
  expect(mocks.open).not.toHaveBeenCalled();
});

it("leaves focus alone when the creation form has been dismissed", async () => {
  expect(await useNewProject()(input, { shouldOpen: () => false })).toBe(true);
  expect(mocks.open).not.toHaveBeenCalled();
});

it("opens the draft only while the original request still owns the surface", async () => {
  expect(await useNewProject()(input, { shouldOpen: () => true })).toBe(true);
  expect(mocks.open).toHaveBeenCalledWith({ environmentId: "local", projectId: "new" });
});
