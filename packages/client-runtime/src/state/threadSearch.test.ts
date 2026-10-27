import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type OrchestrationV2SearchThreadsResult,
  type OrchestrationV2SearchThreadsInput,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { expect, it } from "vite-plus/test";

import {
  createThreadSearchResultsAtomFamily,
  makeThreadSearchKey,
  threadSearchMatchKey,
} from "./threadSearch.ts";

const envA = EnvironmentId.make("env-a");
const envB = EnvironmentId.make("env-b");

it("creates stable keys regardless of environment order", () => {
  expect(makeThreadSearchKey([envB, envA], "needle")).toBe(
    makeThreadSearchKey([envA, envB], "needle"),
  );
});

it("creates keys without array methods unavailable in Hermes", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "toSorted");
  Reflect.deleteProperty(Array.prototype, "toSorted");

  try {
    expect(makeThreadSearchKey([envB, envA], "needle")).toBe('[["env-a","env-b"],"needle"]');
  } finally {
    if (descriptor !== undefined) {
      Reflect.defineProperty(Array.prototype, "toSorted", descriptor);
    }
  }
});

it("encodes scoped thread keys without delimiter collisions", () => {
  const first = threadSearchMatchKey({
    environmentId: EnvironmentId.make("env\u0000thread"),
    threadId: ThreadId.make("id"),
  });
  const second = threadSearchMatchKey({
    environmentId: EnvironmentId.make("env"),
    threadId: ThreadId.make("thread\u0000id"),
  });

  expect(first).not.toBe(second);
});

it("merges successful environments and silently ignores failures", () => {
  const result: OrchestrationV2SearchThreadsResult = {
    matches: [
      {
        threadId: ThreadId.make("thread-a"),
        projectId: ProjectId.make("project-a"),
        source: "user",
        snippet: "needle",
        messageCreatedAt: "2026-07-30T00:00:00.000Z",
      },
    ],
  };
  const searchAtom = createThreadSearchResultsAtomFamily<Error>({
    getSearchAtom: (environmentId) =>
      environmentId === envA
        ? Atom.make(AsyncResult.success(result))
        : Atom.make(
            AsyncResult.failure<OrchestrationV2SearchThreadsResult, Error>(
              Cause.fail(new Error("unsupported rpc")),
            ),
          ),
    labelPrefix: "test:thread-search",
  });
  const registry = AtomRegistry.make();

  const state = registry.get(searchAtom.results(makeThreadSearchKey([envB, envA], "needle")));
  expect(state).toEqual({
    matches: [{ ...result.matches[0], environmentId: envA }],
    isLoading: false,
    rows: [],
  });
  expect(threadSearchMatchKey(state.matches[0]!)).toBe('["env-a","thread-a"]');

  registry.dispose();
});

it("asks environments that omit older settled threads for their rows, with the caller's scope", () => {
  const inputs: Array<readonly [EnvironmentId, OrchestrationV2SearchThreadsInput]> = [];
  const row = { id: ThreadId.make("thread-old") } as OrchestrationV2ThreadShell;
  const search = createThreadSearchResultsAtomFamily<Error>({
    getSearchAtom: (environmentId, input) => {
      inputs.push([environmentId, input]);
      return Atom.make(AsyncResult.success({ matches: [], snapshotSequence: 9, threads: [row] }));
    },
    olderSettledBefore: (environmentId) =>
      Atom.make(environmentId === envA ? "2026-10-01T00:00:00.000Z" : null),
    labelPrefix: "test:thread-search",
  });
  const registry = AtomRegistry.make();
  const scope = {
    titlesOnly: true,
    projectIds: [ProjectId.make("project-a")],
    environmentLabels: { [envA]: "Laptop" },
  };

  // A title-only caller asks only environments that omitted older rows.
  const key = makeThreadSearchKey([envA, envB], "ui", scope);
  expect(registry.get(search.results(key)).rows).toEqual([
    { environmentId: envA, read: { snapshotSequence: 9, threads: [row] } },
  ]);
  expect(registry.get(search.rows(key, envA))).toEqual([{ snapshotSequence: 9, threads: [row] }]);
  expect(inputs).toEqual([
    [
      envA,
      {
        query: "ui",
        olderSettledBefore: "2026-10-01T00:00:00.000Z",
        projectIds: scope.projectIds,
        environmentLabel: "Laptop",
        titlesOnly: true,
      },
    ],
  ]);
  inputs.length = 0;
  registry.get(search.results(makeThreadSearchKey([envB], "needle")));
  expect(inputs).toEqual([[envB, { query: "needle" }]]);

  registry.dispose();
});
