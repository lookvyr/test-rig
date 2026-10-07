import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { NewProjectForm } from "./NewProjectForm";

const mocks = vi.hoisted(() => ({ create: vi.fn(), environments: [] as unknown[] }));
vi.mock("../hooks/useNewProject", () => ({ useNewProject: () => mocks.create }));
vi.mock("../state/environments", () => ({
  usePrimaryEnvironmentId: () => "local",
  useEnvironments: () => ({ environments: mocks.environments }),
}));
vi.mock("./ui/input", () => ({ Input: (props: object) => <input {...props} /> }));
vi.mock("./ui/button", () => ({ Button: (props: object) => <button {...props} /> }));
const local = {
  environmentId: "local",
  label: "Local",
  connection: { phase: "connected" },
  serverConfig: { newProjectsRoot: "/local/projects" },
};
const remote = {
  environmentId: "remote",
  label: "Remote",
  connection: { phase: "connected" },
  serverConfig: { newProjectsRoot: "/remote/projects" },
};
beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue(false);
  mocks.environments = [local, remote];
});

it("keeps the name and reviewed destination when creation fails, then allows retry", async () => {
  const done = vi.fn();
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <NewProjectForm initialEnvironmentId={EnvironmentId.make("remote")} onCreated={done} />,
    );
  });
  await act(async () => {
    tree.root.findByType("input").props.onChange({ target: { value: "Pinball Stats" } });
  });
  expect(JSON.stringify(tree.toJSON())).toContain("/remote/projects/pinball-stats");
  await act(async () => {
    tree.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() });
  });
  expect(mocks.create).toHaveBeenCalledWith(
    { environmentId: "remote", name: "Pinball Stats" },
    { shouldOpen: expect.any(Function) },
  );
  expect(done).not.toHaveBeenCalled();
  expect(tree.root.findByType("input").props.value).toBe("Pinball Stats");
  expect(JSON.stringify(tree.toJSON())).toContain("/remote/projects/pinball-stats");
  mocks.create.mockResolvedValue(true);
  await act(async () => {
    tree.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() });
  });
  expect(done).toHaveBeenCalledOnce();
  await act(async () => tree.unmount());
});

it("accepts only one creation while dispatch is pending", async () => {
  let finish!: (value: boolean) => void;
  mocks.create.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<NewProjectForm onCreated={() => {}} />);
  });
  await act(async () => {
    tree.root.findByType("input").props.onChange({ target: { value: "Project" } });
  });
  await act(async () => {
    const submit = tree.root.findByType("form").props.onSubmit;
    submit({ preventDefault: vi.fn() });
    submit({ preventDefault: vi.fn() });
  });
  expect(mocks.create).toHaveBeenCalledOnce();
  await act(async () => finish(false));
  await act(async () => tree.unmount());
});

it("becomes usable when the environment config arrives after the form opens", async () => {
  mocks.environments = [];
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<NewProjectForm onCreated={() => {}} />);
  });
  mocks.environments = [local];
  await act(async () => {
    tree.update(<NewProjectForm onCreated={() => {}} />);
  });
  await act(async () => {
    tree.root.findByType("input").props.onChange({ target: { value: "Project" } });
  });
  expect(JSON.stringify(tree.toJSON())).toContain("/local/projects/project");
  await act(async () => {
    tree.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() });
  });
  expect(mocks.create).toHaveBeenCalledWith(
    { environmentId: "local", name: "Project" },
    { shouldOpen: expect.any(Function) },
  );
  await act(async () => tree.unmount());
});

it("does not close another overlay when a dismissed creation finishes", async () => {
  let finish!: (value: boolean) => void;
  mocks.create.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const done = vi.fn();
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<NewProjectForm onCreated={done} />);
  });
  await act(async () => {
    tree.root.findByType("input").props.onChange({ target: { value: "Project" } });
  });
  await act(async () => {
    tree.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() });
  });
  const guard = mocks.create.mock.calls[0]?.[1]?.shouldOpen;
  await act(async () => tree.unmount());
  expect(guard()).toBe(false);
  await act(async () => finish(true));
  expect(done).not.toHaveBeenCalled();
});
