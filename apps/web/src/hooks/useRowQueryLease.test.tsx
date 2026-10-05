import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, type SourceControlProviderSettings } from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useLeasedEnvironmentQuery } from "../state/query";
import { useRowQueryLease } from "./useRowQueryLease";
import { useThreadPullRequest } from "./useThreadPullRequest";

const mocks = vi.hoisted(() => ({ linkedPullRequest: vi.fn() }));
vi.mock("../state/git", () => ({ gitEnvironment: { linkedPullRequest: mocks.linkedPullRequest } }));

const observers: Array<{
  callback: IntersectionObserverCallback;
  node: Element | null;
  options: IntersectionObserverInit | undefined;
  disconnected: boolean;
}> = [];
const scrollRoot = {} as Element;
let renderer: ReactTestRenderer | undefined;
let registry: AtomRegistry.AtomRegistry;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  observers.length = 0;
  mocks.linkedPullRequest.mockReset();
  registry = AtomRegistry.make();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      record: (typeof observers)[number];
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.record = { callback, node: null, options, disconnected: false };
        observers.push(this.record);
      }
      observe(node: Element) {
        this.record.node = node;
      }
      disconnect() {
        this.record.disconnected = true;
      }
    },
  );
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  registry.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function show(index: number, isIntersecting: boolean) {
  await act(async () => {
    observers[index]!.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
  await act(async () => vi.runAllTimersAsync());
}

function Row({ query }: { query: Atom.Atom<AsyncResult.AsyncResult<string, never>> | null }) {
  const { rowRef, enabled } = useRowQueryLease();
  const result = useLeasedEnvironmentQuery(query, enabled);
  return <span ref={rowRef}>{result.data ?? "empty"}</span>;
}

function createNodeMock() {
  return { closest: () => scrollRoot };
}

describe("row query leases", () => {
  it("queries only nearby rows and releases offscreen work without blanking cached results", async () => {
    let requests = 0;
    let subscriptions = 0;
    const queries = Array.from({ length: 30 }, (_, index) => ({
      id: `row-${index}`,
      query: Atom.make((get) => {
        requests++;
        subscriptions++;
        get.addFinalizer(() => {
          subscriptions--;
        });
        return AsyncResult.success(`badge-${index}`);
      }),
    }));
    await act(async () => {
      renderer = create(
        <RegistryContext.Provider value={registry}>
          {queries.map(({ id, query }) => (
            <Row key={id} query={query} />
          ))}
        </RegistryContext.Provider>,
        { createNodeMock },
      );
    });
    expect(requests).toBe(0);
    expect(observers).toHaveLength(30);
    expect(observers[0]?.options).toEqual({ root: scrollRoot, rootMargin: "160px 0px" });
    await show(0, true);
    await show(1, true);
    expect(requests).toBe(2);
    expect(subscriptions).toBe(2);
    await show(0, false);
    expect(subscriptions).toBe(1);
    expect(renderer!.root.findAllByType("span")[0]!.children).toEqual(["badge-0"]);
    await show(2, true);
    expect(requests).toBe(3);
    expect(subscriptions).toBe(2);
    await show(0, true);
    expect(subscriptions).toBe(3);
  });

  it("drops retained badges when a row switches query identity while offscreen", async () => {
    const first = Atom.make(AsyncResult.success("first worktree"));
    let secondRequests = 0;
    const second = Atom.make(() => {
      secondRequests++;
      return AsyncResult.success("second worktree");
    });
    const tree = (query: Parameters<typeof Row>[0]["query"]) => (
      <RegistryContext.Provider value={registry}>
        <Row query={query} />
      </RegistryContext.Provider>
    );
    await act(async () => {
      renderer = create(tree(first), { createNodeMock });
    });
    await show(0, true);
    await show(0, false);
    expect(renderer!.root.findByType("span").children).toEqual(["first worktree"]);
    await act(async () => renderer!.update(tree(second)));
    expect(secondRequests).toBe(0);
    expect(renderer!.root.findByType("span").children).toEqual(["empty"]);
    await show(0, true);
    expect(secondRequests).toBe(1);
    expect(renderer!.root.findByType("span").children).toEqual(["second worktree"]);
    await act(async () => renderer!.update(tree(null)));
    expect(renderer!.root.findByType("span").children).toEqual(["empty"]);
  });

  it("loads status when IntersectionObserver is unavailable", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    await act(async () => {
      renderer = create(
        <RegistryContext.Provider value={registry}>
          <Row query={Atom.make(AsyncResult.success("badge"))} />
        </RegistryContext.Provider>,
        { createNodeMock },
      );
    });
    expect(renderer!.root.findByType("span").children).toEqual(["badge"]);
  });
});

const environmentId = EnvironmentId.make("local");
const providerSettings: SourceControlProviderSettings = {
  github: true,
  gitlab: false,
  "azure-devops": false,
  bitbucket: false,
};

function LinkedPr({
  enabled,
  allowed,
  reference = "42",
}: {
  enabled: boolean;
  allowed: boolean;
  reference?: string;
}) {
  const pr = useThreadPullRequest({
    environmentId,
    projectCwd: "/repo",
    association: { mode: "linked", provider: "github", reference },
    threadBranch: "a-different-checkout",
    gitStatus: null,
    providerSettings: { ...providerSettings, github: allowed },
    enabled,
  });
  return <span>{pr?.title ?? "empty"}</span>;
}

it("retains explicit PR badges offscreen but honors unlink identity and disabled integrations", async () => {
  let requests = 0;
  let subscriptions = 0;
  const query = Atom.make((get) => {
    requests++;
    subscriptions++;
    get.addFinalizer(() => {
      subscriptions--;
    });
    return AsyncResult.success({
      pullRequest: {
        number: 42,
        title: "Explicit PR",
        url: "https://github.com/example/repo/pull/42",
        baseBranch: "main",
        headBranch: "feature",
        state: "open",
      },
    });
  });
  const other = Atom.make(AsyncResult.success({ pullRequest: null }));
  mocks.linkedPullRequest.mockImplementation(({ input }: { input: { reference: string } }) =>
    input.reference === "42" ? query : other,
  );
  const tree = (enabled: boolean, allowed: boolean, reference = "42") => (
    <RegistryContext.Provider value={registry}>
      <LinkedPr enabled={enabled} allowed={allowed} reference={reference} />
    </RegistryContext.Provider>
  );
  await act(async () => {
    renderer = create(tree(false, true));
  });
  expect(requests).toBe(0);
  await act(async () => renderer!.update(tree(true, true)));
  expect(requests).toBe(1);
  expect(renderer!.root.findByType("span").children).toEqual(["Explicit PR"]);
  await act(async () => renderer!.update(tree(false, true)));
  await act(async () => vi.runAllTimersAsync());
  expect(subscriptions).toBe(0);
  expect(renderer!.root.findByType("span").children).toEqual(["Explicit PR"]);
  await act(async () => renderer!.update(tree(false, true, "99")));
  expect(renderer!.root.findByType("span").children).toEqual(["empty"]);
  mocks.linkedPullRequest.mockClear();
  await act(async () => renderer!.update(tree(true, false)));
  expect(mocks.linkedPullRequest).not.toHaveBeenCalled();
  expect(renderer!.root.findByType("span").children).toEqual(["empty"]);
});
