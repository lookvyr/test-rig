import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { HtmlRenderViewer } from "./HtmlRenderViewer";

vi.mock("../files/BrowserDocumentFrame", () => ({
  HtmlRenderDocument: (props: { src: string; title: string }) => (
    <iframe {...props} sandbox="allow-scripts allow-forms" />
  ),
}));
vi.mock("../ui/button", () => ({
  Button: (props: React.ComponentProps<"button">) => <button {...props} />,
}));

let renderer: ReactTestRenderer;
let modal = false;
const expandFocus = vi.fn();
const closeFocus = vi.fn();
const onOpenInPanel = vi.fn();
const dialog = {
  close: vi.fn(() => {
    modal = false;
  }),
  showModal: vi.fn(() => {
    modal = true;
  }),
  show: vi.fn(),
  matches: () => modal,
};

function render(overrides: Partial<Parameters<typeof HtmlRenderViewer>[0]> = {}) {
  act(() => {
    renderer = create(
      <HtmlRenderViewer
        src="/signed-page.html"
        title="Launch planner"
        height={420}
        failed={false}
        onContentHeight={vi.fn()}
        onOpenInPanel={onOpenInPanel}
        {...overrides}
      />,
      {
        createNodeMock: (element) => {
          if (element.type === "dialog") return dialog;
          const props = element.props as React.ComponentProps<"button">;
          if (props["aria-label"] === "Expand Launch planner") return { focus: expandFocus };
          if (props["aria-label"] === "Close expanded visualization") return { focus: closeFocus };
          return null;
        },
      },
    );
  });
}
function button(label: string) {
  return renderer.root.findAllByType("button").find((node) => node.props["aria-label"] === label)!;
}
function click(label: string) {
  act(() => button(label).props.onClick());
}

beforeEach(() => {
  modal = false;
  vi.clearAllMocks();
});
afterEach(() => act(() => renderer.unmount()));

describe("HTML visualization viewer", () => {
  it.each([false, true])("keeps an unavailable page's actions disabled (failed: %s)", (failed) => {
    render({ src: null, failed });
    expect(button("Expand Launch planner").props.disabled).toBe(true);
    expect(button("Open in panel").props.disabled).toBe(true);
    expect(renderer.root.findAllByType("iframe")).toHaveLength(0);
    expect(renderer.root.findAllByType("p")).toHaveLength(failed ? 1 : 0);
  });

  it("keeps one document mounted across expansion, zoom, and closing", () => {
    render();
    const frame = renderer.root.findByType("iframe");
    click("Expand Launch planner");
    expect(modal).toBe(true);
    expect(closeFocus).toHaveBeenCalledOnce();
    click("Zoom in");
    click("Close expanded visualization");
    expect(modal).toBe(false);
    expect(dialog.show).toHaveBeenCalledOnce();
    expect(expandFocus).toHaveBeenCalledOnce();
    expect(renderer.root.findByType("iframe")).toBe(frame);
    expect(frame.props.src).toBe("/signed-page.html");
    click("Open in panel");
    expect(onOpenInPanel).toHaveBeenCalledOnce();
  });

  it("bounds zoom to 50–200 percent, resets it, and starts a fresh expansion at 100", () => {
    render();
    click("Expand Launch planner");
    for (let index = 0; index < 4; index++) click("Zoom in");
    expect(button("Reset zoom").children.join("")).toBe("200%");
    expect(button("Zoom in").props.disabled).toBe(true);
    click("Reset zoom");
    expect(button("Reset zoom").children.join("")).toBe("100%");
    click("Zoom out");
    click("Zoom out");
    expect(button("Reset zoom").children.join("")).toBe("50%");
    expect(button("Zoom out").props.disabled).toBe(true);
    click("Close expanded visualization");
    click("Expand Launch planner");
    expect(button("Reset zoom").children.join("")).toBe("100%");
  });

  it("returns the same document inline after native Escape closes the dialog", () => {
    render();
    const frame = renderer.root.findByType("iframe");
    click("Expand Launch planner");
    modal = false;
    act(() =>
      renderer.root
        .findByType("dialog")
        .props.onClose({ currentTarget: { ...dialog, open: false } }),
    );
    expect(modal).toBe(false);
    expect(renderer.root.findByType("dialog").props.role).toBe("presentation");
    expect(renderer.root.findByType("iframe")).toBe(frame);
    expect(expandFocus).toHaveBeenCalledOnce();
  });

  it("handles Escape from inside the sandboxed page only while expanded", () => {
    render();
    const frame = renderer.root.findByType("iframe");
    expect(frame.props.onEscape).toBeUndefined();
    click("Expand Launch planner");
    act(() => frame.props.onEscape());
    expect(modal).toBe(false);
    expect(frame.props.onEscape).toBeUndefined();
    expect(expandFocus).toHaveBeenCalledOnce();
  });
});
