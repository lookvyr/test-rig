import { RuntimeRequestId, ThreadId, EnvironmentId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import type { PendingUserInput } from "../../session-logic";
import { Collapsible } from "../ui/collapsible";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";
import { clearPendingUserInputDrafts, usePendingUserInput } from "./usePendingUserInput";

const threadRef = scopeThreadRef(EnvironmentId.make("questions-env"), ThreadId.make("questions"));
const request: PendingUserInput = {
  requestId: RuntimeRequestId.make("question-request"),
  createdAt: "2026-10-06T00:00:00Z",
  responseCapability: "live",
  dismissible: false,
  questions: [
    {
      id: "direction",
      header: "Direction",
      question: "Choose the direction",
      multiSelect: false,
      options: [
        { label: "First", description: "First direction" },
        { label: "Second", description: "Second direction" },
      ],
    },
  ],
};

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(() => renderer?.unmount());
  renderer = undefined;
  clearPendingUserInputDrafts(threadRef);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const panelProps = (prompt = request) => ({
  pendingUserInputs: [prompt],
  respondingRequestIds: [],
  answers: {},
  questionIndex: 0,
  onToggleOption: vi.fn(),
  onAdvance: vi.fn(),
});

function installEventSurface() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const document = new EventTarget();
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal(
    "HTMLInputElement",
    class {
      tagName = "INPUT";
    },
  );
  vi.stubGlobal(
    "HTMLTextAreaElement",
    class {
      tagName = "TEXTAREA";
    },
  );
  vi.stubGlobal(
    "HTMLElement",
    class {
      closest() {
        return null;
      }
    },
  );
  return document;
}

describe("pending question recovery", () => {
  it("disables option buttons and explains a lost provider process", () => {
    const html = renderToStaticMarkup(
      createElement(
        ComposerPendingUserInputPanel,
        panelProps({ ...request, responseCapability: "not_resumable" }),
      ),
    );
    expect(html).toContain("Provider process is gone");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>/);
  });

  it("ignores digit shortcuts and direct option activation when the request cannot resume", async () => {
    const document = installEventSurface();
    const props = panelProps({ ...request, responseCapability: "not_resumable" });
    await act(() => {
      renderer = create(createElement(ComposerPendingUserInputPanel, props));
    });
    const digit = Object.assign(new Event("keydown", { cancelable: true }), {
      key: "1",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    });
    document.dispatchEvent(digit);
    const option = renderer!.root
      .findAllByType("button")
      .find((button) => button.props.disabled === true)!;
    await act(() => option.props.onClick());
    await act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(props.onToggleOption).not.toHaveBeenCalled();
    expect(props.onAdvance).not.toHaveBeenCalled();
    expect(digit.defaultPrevented).toBe(false);
  });

  it("cancels auto-advance when provider loss happens after a selection", async () => {
    installEventSurface();
    const props = panelProps();
    await act(() => {
      renderer = create(createElement(ComposerPendingUserInputPanel, props));
    });
    const option = renderer!.root
      .findAllByType("button")
      .find((button) => button.props.disabled === false)!;
    await act(() => option.props.onClick());
    expect(props.onToggleOption).toHaveBeenCalledOnce();
    await act(() =>
      renderer!.update(
        createElement(ComposerPendingUserInputPanel, {
          ...props,
          pendingUserInputs: [{ ...request, responseCapability: "not_resumable" }],
        }),
      ),
    );
    await act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(props.onAdvance).not.toHaveBeenCalled();
  });

  it("collapses a tall question and reopens the next question", async () => {
    installEventSurface();
    const next = { ...request.questions[0]!, id: "next", header: "Next" };
    const props = panelProps({ ...request, questions: [...request.questions, next] });
    await act(() => {
      renderer = create(createElement(ComposerPendingUserInputPanel, props));
    });
    await act(() => renderer!.root.findByType(Collapsible).props.onOpenChange(false));
    expect(
      renderer!.root.findByProps({ "data-pending-user-input-toggle": "collapsed" }),
    ).toBeDefined();
    await act(() =>
      renderer!.update(
        createElement(ComposerPendingUserInputPanel, { ...props, questionIndex: 1 }),
      ),
    );
    expect(
      renderer!.root.findByProps({ "data-pending-user-input-toggle": "expanded" }),
    ).toBeDefined();
  });

  it("gates custom answers and final submit in the shared main/side/async question hook", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onRespond = vi.fn();
    const promptRef = { current: "original draft" };
    let draft: ReturnType<typeof usePendingUserInput> | undefined;
    function Harness({ prompt }: { prompt: PendingUserInput }) {
      const value = usePendingUserInput({ threadRef, request: prompt, promptRef, onRespond });
      useLayoutEffect(() => {
        draft = value;
      }, [value]);
      return null;
    }
    await act(() => {
      renderer = create(createElement(Harness, { prompt: request }));
    });
    await act(() => draft!.onSelectActivePendingUserInputOption("direction", "First"));
    await act(() =>
      renderer!.update(
        createElement(Harness, { prompt: { ...request, responseCapability: "not_resumable" } }),
      ),
    );
    const answer = draft!.activePendingDraftAnswers;
    await act(() => {
      draft!.onSelectActivePendingUserInputOption("direction", "Second");
      draft!.onChangeActivePendingUserInputCustomAnswer("direction", "new answer");
      draft!.onAdvanceActivePendingUserInput();
    });
    expect(draft!.activePendingDraftAnswers).toEqual(answer);
    expect(promptRef.current).toBe("");
    expect(onRespond).not.toHaveBeenCalled();
    await act(() =>
      renderer!.update(
        createElement(Harness, {
          prompt: { ...request, responseCapability: "message", responseMode: "message" },
        }),
      ),
    );
    await act(() => draft!.onAdvanceActivePendingUserInput());
    expect(onRespond).toHaveBeenCalledWith(request.requestId, { direction: "First" });
  });
});
