import type { PreviewAutomationControlReason } from "@t3tools/contracts";

export class BrowserControlInterrupted extends Error {
  readonly reason: PreviewAutomationControlReason;
  constructor(
    message = "The browser tab changed. Refresh its snapshot.",
    reason: PreviewAutomationControlReason = "interrupted",
  ) {
    super(message);
    this.reason = reason;
  }
}

/** Orders page actions while allowing people and their agent to share the page. */
export class SessionControl {
  private tail: Promise<unknown> = Promise.resolve();
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  generation = 0;
  readonly agentId: string | null;
  private readonly invalidate: () => void;
  constructor(agentId: string | null, invalidate: () => void) {
    this.agentId = agentId;
    this.invalidate = invalidate;
  }
  track(work: Promise<unknown>) {
    this.pending = work.catch(() => undefined);
  }
  system<A>(run: () => Promise<A>): Promise<A> {
    const result = this.tail.then(() => {
      if (this.closed) throw new BrowserControlInterrupted("This browser tab is closed.", "closed");
      return run();
    });
    this.tail = result.then(
      () => this.pending,
      () => this.pending,
    );
    return result;
  }
  agent<A>(agentId: string, run: () => Promise<A>): Promise<A> {
    if (this.agentId !== agentId)
      return Promise.reject(
        new BrowserControlInterrupted("This tab belongs to another agent.", "agentMismatch"),
      );
    return this.system(run);
  }
  human<A>(run: () => Promise<A>): Promise<A> {
    return this.system(() => {
      this.generation++;
      this.invalidate();
      return run();
    });
  }
  async close() {
    this.closed = true;
    this.generation++;
    this.invalidate();
    await this.tail;
  }
}
