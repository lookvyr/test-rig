import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { HtmlRenderDocument } from "./BrowserDocumentFrame";

vi.mock("~/hooks/useHtmlRenderTheme", () => ({
  useHtmlRenderTheme: () => ({ appearance: "dark", variables: {} }),
}));
vi.mock("~/components/chat/ExpandedImageDialog", () => ({
  ExpandedImageDialog: (props: object) => <div data-image-preview {...props} />,
}));
let renderer: ReactTestRenderer;
let listener: EventTarget;
const frame = {
  contentWindow: { postMessage: vi.fn() },
  closest: vi.fn<(selector: string) => object | null>(() => null),
};
const activation = { isActive: true };
const doc = { activeElement: frame };
const escape = vi.fn();
const openChange = vi.fn();
const request = {
  jsonrpc: "2.0",
  method: "t3/notifications/open-image",
  params: { src: "https://example.com/a.png", name: "Chart" },
};
function send(data: unknown = request, source: unknown = frame.contentWindow) {
  const event = new Event("message");
  Object.assign(event, { data, source });
  act(() => listener.dispatchEvent(event));
}
const previews = () => renderer.root.findAllByProps({ "data-image-preview": true });
beforeEach(() => {
  vi.clearAllMocks();
  frame.closest.mockReturnValue(null);
  activation.isActive = true;
  doc.activeElement = frame;
  listener = new EventTarget();
  vi.stubGlobal("window", listener);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", { userActivation: activation });
  act(() => {
    renderer = create(
      <HtmlRenderDocument
        src="/page.html"
        title="Chart"
        onEscape={escape}
        onImageOpenChange={openChange}
      />,
      {
        createNodeMock: (element) => (element.type === "iframe" ? frame : null),
      },
    );
  });
});
afterEach(() => {
  act(() => renderer.unmount());
  vi.unstubAllGlobals();
});
it("requires the exact frame, focus, user activation and a validated image URL", () => {
  send(request, {});
  doc.activeElement = {} as typeof frame;
  send();
  doc.activeElement = frame;
  activation.isActive = false;
  send();
  activation.isActive = true;
  send({ ...request, params: { src: "file:///private.png" } });
  frame.closest.mockImplementation((selector) => (selector === "[inert]" ? {} : null));
  send();
  expect(previews()).toHaveLength(0);
  frame.closest.mockReturnValue(null);
  send();
  expect(previews()[0]?.props.preview.images).toEqual([request.params]);
  expect(openChange).toHaveBeenCalledWith(true);
});
it("keeps the image above native fullscreen, suppresses outer Escape, and cleans up on close", () => {
  const modal = {};
  frame.closest.mockImplementation((selector) => (selector === "dialog:modal" ? modal : null));
  const iframe = renderer.root.findByType("iframe");
  send();
  expect(previews()[0]?.props.portalContainer).toBe(modal);
  send("test-rig:html-render:escape");
  expect(escape).not.toHaveBeenCalled();
  act(() => previews()[0]?.props.onClose());
  expect(openChange).toHaveBeenLastCalledWith(false);
  expect(renderer.root.findByType("iframe")).toBe(iframe);
  send("test-rig:html-render:escape");
  expect(escape).toHaveBeenCalledOnce();
});
