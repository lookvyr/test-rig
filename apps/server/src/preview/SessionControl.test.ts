import { describe, expect, it, vi } from "vite-plus/test";

import { SessionControl } from "./SessionControl.ts";

describe("SessionControl", () => {
  it("lets human input and agent work share an ordered queue without transferring ownership", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const calls: string[] = [];
    const invalidate = vi.fn();
    const control = new SessionControl("agent", invalidate);
    const first = control.agent("agent", async () => {
      calls.push("agent started");
      entered.resolve();
      await release.promise;
      calls.push("agent finished");
    });
    await entered.promise;
    const human = control.human("viewer", async () => {
      calls.push("human");
    });
    const next = control.agent("agent", async () => {
      calls.push("agent again");
    });
    expect(calls).toEqual(["agent started"]);
    release.resolve();
    await Promise.all([first, human, next]);
    expect(calls).toEqual(["agent started", "agent finished", "human", "agent again"]);
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("returns from a navigation action while later input waits for navigation to settle", async () => {
    const navigation = Promise.withResolvers<void>();
    const control = new SessionControl("agent", () => {});
    await control.agent("agent", async () => {
      control.track(navigation.promise);
    });
    const input = vi.fn(async () => {});
    const queued = control.human("viewer", input);
    expect(input).not.toHaveBeenCalled();
    navigation.resolve();
    await queued;
    expect(input).toHaveBeenCalledOnce();
  });

  it("rejects another agent without poisoning later human or owner actions", async () => {
    const control = new SessionControl("owner", () => {});
    const wrongAgent = vi.fn(async () => {});
    await expect(control.agent("other", wrongAgent)).rejects.toMatchObject({
      reason: "agentMismatch",
    });
    expect(wrongAgent).not.toHaveBeenCalled();
    await expect(control.human("viewer", async () => "human")).resolves.toBe("human");
    await expect(control.agent("owner", async () => "owner")).resolves.toBe("owner");
  });

  it("drains the active action on close and rejects queued and subsequent input", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const control = new SessionControl("agent", () => {});
    const active = control.agent("agent", async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const input = vi.fn(async () => {});
    const rejected = expect(control.human("viewer", input)).rejects.toMatchObject({
      reason: "closed",
    });
    const closed = control.close();
    release.resolve();
    await Promise.all([active, closed, rejected]);
    await expect(control.agent("agent", input)).rejects.toMatchObject({ reason: "closed" });
    expect(input).not.toHaveBeenCalled();
  });

  it("coalesces waiting hovers without expiring the agent's refs", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const invalidate = vi.fn();
    const control = new SessionControl("agent", invalidate);
    const active = control.agent("agent", async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const hovers: number[] = [];
    const first = control.humanLatest("viewer", "hover", async () => {
      hovers.push(1);
    });
    const second = control.humanLatest("viewer", "hover", async () => {
      hovers.push(2);
    });
    release.resolve();
    await Promise.all([active, first, second]);
    expect(hovers).toEqual([2]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("starts the agent's next action after a viewer navigation settles", async () => {
    const navigation = Promise.withResolvers<void>();
    const control = new SessionControl("agent", () => {});
    await control.human("viewer", async () => {
      control.trackUntilHandoff(navigation.promise);
    });
    const action = vi.fn(async () => {});
    const queued = control.agent("agent", action);
    await Promise.resolve();
    expect(action).not.toHaveBeenCalled();
    navigation.resolve();
    await queued;
    expect(action).toHaveBeenCalledOnce();
  });

  it("does not start an agent action after its deadline", async () => {
    const control = new SessionControl("agent", () => {});
    const action = vi.fn(async () => {});
    await expect(control.agent("agent", action, performance.now() - 1)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(action).not.toHaveBeenCalled();
  });
});
