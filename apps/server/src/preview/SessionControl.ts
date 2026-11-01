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

const settle = (work: Promise<unknown>) =>
  work.then(
    () => undefined,
    () => undefined,
  );

/**
 * Orders page actions while people and their agent share the page. Nobody takes
 * exclusive control: human input runs in order with agent actions and expires
 * the agent's element refs, so its next action starts from a fresh snapshot.
 */
export class SessionControl {
  readonly agentId: string | null;
  private readonly onGenerationChange: () => void;
  private tail: Promise<unknown> = Promise.resolve();
  private latestHuman: {
    entry: { viewerId: string; key: string; run: () => Promise<void> };
    result: Promise<void>;
  } | null = null;
  private pending: Promise<void> = Promise.resolve();
  private readonly viewerNavigations = new Set<Promise<void>>();
  private epoch = 0;
  private closed = false;

  constructor(agentId: string | null, onGenerationChange: () => void = () => {}) {
    this.agentId = agentId;
    this.onGenerationChange = onGenerationChange;
  }

  get generation() {
    return this.epoch;
  }

  private enqueue<A>(run: () => Promise<A>): Promise<A> {
    this.latestHuman = null;
    const result = this.tail.then(run);
    this.tail = result.then(
      () => this.pending,
      () => this.pending,
    );
    return result;
  }

  /** An action can respond before its navigation commits, while later actions still wait. */
  track(work: Promise<unknown>) {
    this.pending = Promise.all([this.pending, settle(work)]).then(() => undefined);
  }

  /** Viewer navigations keep viewer input responsive; the agent's next action waits for them. */
  trackUntilHandoff(work: Promise<unknown>) {
    const settled = settle(work).finally(() => {
      this.viewerNavigations.delete(settled);
    });
    this.viewerNavigations.add(settled);
  }

  private assertOpen() {
    if (this.closed) throw new BrowserControlInterrupted("This browser tab is closed.", "closed");
  }

  agentMayAct(agentId: string) {
    return this.agentId === null || this.agentId === agentId;
  }

  /** Nobody holds a tab exclusively, so an agent may act whenever the tab is its own. */
  agentCanActNow(agentId: string) {
    return this.agentMayAct(agentId);
  }

  async agent<A>(agentId: string, run: () => Promise<A>, deadlineMs?: number): Promise<A> {
    if (!this.agentMayAct(agentId))
      throw new BrowserControlInterrupted("This tab belongs to another agent.", "agentMismatch");
    this.assertOpen();
    // Wait outside the queue, so human input (such as a corrected URL) is never held behind it.
    await Promise.all(this.viewerNavigations);
    return this.enqueue(async () => {
      this.assertOpen();
      if (deadlineMs !== undefined && performance.now() >= deadlineMs) {
        throw new DOMException(
          "This browser request expired before it could start.",
          "TimeoutError",
        );
      }
      return run();
    });
  }

  /** Read without queueing so agents can observe without delaying human input. */
  observe<A>(run: () => Promise<A>) {
    this.assertOpen();
    return run();
  }

  system<A>(run: () => Promise<A>): Promise<A> {
    try {
      this.assertOpen();
    } catch (error) {
      return Promise.reject(error);
    }
    return this.enqueue(async () => {
      this.assertOpen();
      return run();
    });
  }

  /** Human input runs in order with agent actions and expires the agent's element refs. */
  human<A>(_viewerId: string, run: () => Promise<A>): Promise<A> {
    return this.system(() => {
      this.epoch++;
      this.onGenerationChange();
      return run();
    });
  }

  /**
   * Pointer hovers: replace only adjacent waiting work; the running action and intervening
   * actions keep their order. A hover changes nothing, so it keeps the agent's refs.
   */
  humanLatest(viewerId: string, key: string, run: () => Promise<void>): Promise<void> {
    if (this.closed) return this.system(run);
    const latest = this.latestHuman;
    if (latest?.entry.viewerId === viewerId && latest.entry.key === key) {
      latest.entry.run = run;
      return latest.result;
    }
    const entry = { viewerId, key, run };
    const result = this.system(async () => {
      if (this.latestHuman?.entry === entry) this.latestHuman = null;
      await entry.run();
    });
    this.latestHuman = { entry, result };
    return result;
  }

  async close() {
    if (!this.closed) {
      this.closed = true;
      this.latestHuman = null;
      this.epoch++;
      this.onGenerationChange();
    }
    await this.tail;
  }
}
