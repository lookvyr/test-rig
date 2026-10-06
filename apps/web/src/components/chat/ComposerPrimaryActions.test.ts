import { describe, expect, it } from "vite-plus/test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ComposerPrimaryActions, formatPendingPrimaryActionLabel } from "./ComposerPrimaryActions";

describe("formatPendingPrimaryActionLabel", () => {
  it("returns 'Submitting...' while responding", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: true,
        questionIndex: 0,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submitting...' while responding regardless of other flags", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: true,
        questionIndex: 3,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submit' in compact mode on the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit");
  });

  it("returns 'Next' in compact mode when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Next");
  });

  it("returns 'Next question' when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Next question");
  });

  it("returns singular 'Submit answer' on the last question when it is the only question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit answer");
  });

  it("returns plural 'Submit answers' on the last question when there are multiple questions", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Submit answers");
  });

  it("returns plural 'Submit answers' for higher question indices", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 5,
      }),
    ).toBe("Submit answers");
  });
});

describe("follow-up actions", () => {
  const renderActions = (overrides: Partial<Parameters<typeof ComposerPrimaryActions>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(ComposerPrimaryActions, {
        compact: false,
        pendingAction: null,
        isRunning: true,
        showPlanFollowUpPrompt: false,
        promptHasText: true,
        isSendBusy: false,
        sendDisabledReason: null,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        isPreparingWorktree: false,
        hasSendableContent: true,
        onPreviousPendingQuestion: () => {},
        onInterrupt: () => {},
        onImplementPlanInNewThread: () => {},
        ...overrides,
      }),
    );

  it("keeps Stop available before the interruptible run starts", () => {
    const html = renderActions({
      isRunning: false,
      canInterrupt: true,
      isConnecting: true,
      hasSendableContent: false,
    });
    expect(html).toContain('aria-label="Stop generation"');
    expect(html).not.toContain('type="submit"');
  });

  it("shows Send beside Stop for a follow-up, including attachment-only drafts", () => {
    for (const promptHasText of [true, false]) {
      const html = renderActions({ promptHasText });
      expect(html).toContain('aria-label="Stop generation"');
      expect(html).toContain('aria-label="Send message"');
      expect(html).not.toContain('disabled=""');
    }
  });

  it("disables Send without hiding Stop while steering is unavailable", () => {
    const html = renderActions({ sendDisabledReason: "Send message" });
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-label="Stop generation"/);
    expect(html).not.toMatch(/<button[^>]*type="button"[^>]*disabled/);
  });

  it("keeps only Stop for an empty running composer and only Send when idle", () => {
    const running = renderActions({ hasSendableContent: false, promptHasText: false });
    expect(running).toContain('aria-label="Stop generation"');
    expect(running).not.toContain('type="submit"');
    const idle = renderActions({ isRunning: false });
    expect(idle).not.toContain('aria-label="Stop generation"');
    expect(idle).toContain('aria-label="Send message"');
  });
});
