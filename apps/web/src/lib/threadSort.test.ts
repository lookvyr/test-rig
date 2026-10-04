import { makeTestThread } from "../test/threadFixtures";
import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import type { Thread } from "../types";
import { getLatestThreadForProject, sortThreads } from "./threadSort";
const PROJECT_ID = ProjectId.make("project-1");

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return makeTestThread({
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    ...overrides,
  });
}

describe("sortThreads", () => {
  it("sorts threads by the latest user message in recency mode", () => {
    const sorted = sortThreads(
      [
        makeThread({
          id: ThreadId.make("thread-1"),
          updatedAt: "2026-03-09T10:10:00.000Z",
          latestUserMessageAt: "2026-03-09T10:01:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-2"),
          createdAt: "2026-03-09T10:05:00.000Z",
          updatedAt: "2026-03-09T10:05:00.000Z",
          latestUserMessageAt: "2026-03-09T10:06:00.000Z",
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual([
      ThreadId.make("thread-2"),
      ThreadId.make("thread-1"),
    ]);
  });

  it("falls back to thread timestamps when there is no user message", () => {
    const sorted = sortThreads(
      [
        makeThread({
          id: ThreadId.make("thread-1"),
          updatedAt: "2026-03-09T10:01:00.000Z",
          latestUserMessageAt: "2026-03-09T10:02:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-2"),
          createdAt: "2026-03-09T10:05:00.000Z",
          updatedAt: "2026-03-09T10:05:00.000Z",
          latestUserMessageAt: null,
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual([
      ThreadId.make("thread-2"),
      ThreadId.make("thread-1"),
    ]);
  });

  it("falls back to createdAt when updatedAt is invalid", () => {
    const sorted = sortThreads(
      [
        makeThread({
          id: ThreadId.make("thread-1"),
          createdAt: "2026-03-09T10:00:00.000Z",
          updatedAt: "invalid-date" as never,
          latestUserMessageAt: null,
        }),
        makeThread({
          id: ThreadId.make("thread-2"),
          createdAt: "2026-03-09T09:00:00.000Z",
          updatedAt: "2026-03-09T09:30:00.000Z",
          latestUserMessageAt: null,
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual([
      ThreadId.make("thread-1"),
      ThreadId.make("thread-2"),
    ]);
  });

  it("falls back to id ordering when threads have no sortable timestamps", () => {
    const sorted = sortThreads(
      [
        makeThread({
          id: ThreadId.make("thread-1"),
          createdAt: "invalid-created-at" as never,
          updatedAt: "invalid-updated-at" as never,
          latestUserMessageAt: null,
        }),
        makeThread({
          id: ThreadId.make("thread-2"),
          createdAt: "invalid-created-at" as never,
          updatedAt: "invalid-updated-at" as never,
          latestUserMessageAt: null,
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual([
      ThreadId.make("thread-2"),
      ThreadId.make("thread-1"),
    ]);
  });

  it("can sort threads by createdAt when configured", () => {
    const sorted = sortThreads(
      [
        makeThread({
          id: ThreadId.make("thread-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          updatedAt: "2026-03-09T10:05:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-2"),
          createdAt: "2026-03-09T10:00:00.000Z",
          updatedAt: "2026-03-09T10:10:00.000Z",
        }),
      ],
      "created_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual([
      ThreadId.make("thread-1"),
      ThreadId.make("thread-2"),
    ]);
  });

  it("uses updatedAt as a fallback for created_at sorting when createdAt is invalid", () => {
    const sorted = sortThreads(
      [
        makeThread({
          id: ThreadId.make("thread-1"),
          createdAt: "invalid-date" as never,
          updatedAt: "2026-03-09T10:05:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-2"),
          createdAt: "2026-03-09T10:00:00.000Z",
          updatedAt: "2026-03-09T10:10:00.000Z",
        }),
      ],
      "created_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual([
      ThreadId.make("thread-1"),
      ThreadId.make("thread-2"),
    ]);
  });

  it("returns the latest active thread for a project", () => {
    const latestThread = getLatestThreadForProject(
      [
        makeThread({
          id: ThreadId.make("thread-1"),
          createdAt: "2026-03-09T10:00:00.000Z",
          updatedAt: "2026-03-09T10:01:00.000Z",
          archivedAt: null,
        }),
        makeThread({
          id: ThreadId.make("thread-2"),
          createdAt: "2026-03-09T10:05:00.000Z",
          updatedAt: "2026-03-09T10:10:00.000Z",
          archivedAt: "2026-03-10T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-3"),
          createdAt: "2026-03-09T10:06:00.000Z",
          updatedAt: "2026-03-09T10:06:00.000Z",
          archivedAt: null,
        }),
      ],
      PROJECT_ID,
      "updated_at",
    );

    expect(latestThread?.id).toBe(ThreadId.make("thread-3"));
  });
});
