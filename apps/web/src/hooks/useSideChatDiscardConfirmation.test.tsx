import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useSideChatDiscardConfirmation } from "./useSideChatDiscardConfirmation";

const settings = vi.hoisted(() => ({
  confirmSideChatDiscard: true,
  hydrate: vi.fn<() => Promise<void>>(),
  update: vi.fn(),
}));
vi.mock("./useSettings", () => ({
  ensureClientSettingsHydrated: () => settings.hydrate(),
  getClientSettings: () => settings,
  useUpdateClientSettings: () => (patch: { confirmSideChatDiscard: boolean }) => {
    settings.update(patch);
    settings.confirmSideChatDiscard = patch.confirmSideChatDiscard;
  },
}));
vi.mock("../components/ui/alert-dialog", () => ({
  AlertDialog: "dialog",
  AlertDialogDescription: "p",
  AlertDialogFooter: "footer",
  AlertDialogHeader: "header",
  AlertDialogPopup: "section",
  AlertDialogTitle: "h2",
}));
vi.mock("../components/ui/button", () => ({ Button: "button" }));
vi.mock("../components/ui/checkbox", () => ({ Checkbox: "input" }));

let renderer: ReactTestRenderer | null = null;
let value: ReturnType<typeof useSideChatDiscardConfirmation>;
function Probe({ threadKey }: { threadKey: string }) {
  const result = useSideChatDiscardConfirmation(threadKey);
  useEffect(() => {
    value = result;
  }, [result]);
  return result.dialog;
}
function render(threadKey = "parent-a") {
  act(() => {
    if (renderer) renderer.update(<Probe threadKey={threadKey} />);
    else renderer = create(<Probe threadKey={threadKey} />);
  });
}
function click(label: string) {
  act(() =>
    renderer!.root
      .findAllByType("button")
      .find((button) => button.props.children === label)!
      .props.onClick(),
  );
}
function remember() {
  act(() => renderer!.root.findByType("input").props.onCheckedChange(true));
}
async function request() {
  let result!: Promise<boolean>;
  await act(async () => {
    result = value.confirm();
  });
  return { result };
}
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  settings.confirmSideChatDiscard = true;
  settings.hydrate.mockReset();
  settings.update.mockReset();
});

describe("side chat discard confirmation", () => {
  it("cancels without remembering a checked preference and asks again next time", async () => {
    render();
    const first = await request();
    remember();
    click("Cancel");
    expect(await first.result).toBe(false);
    expect(settings.update).not.toHaveBeenCalled();
    const second = await request();
    expect(renderer!.root.findByType("dialog").props.open).toBe(true);
    expect(renderer!.root.findByType("input").props.checked).toBe(false);
    click("Discard side chat");
    expect(await second.result).toBe(true);
    expect(settings.update).not.toHaveBeenCalled();
  });

  it("remembers a confirmed choice across conversations and supports turning prompts back on", async () => {
    render();
    const first = await request();
    remember();
    click("Discard side chat");
    expect(await first.result).toBe(true);
    expect(settings.update).toHaveBeenCalledWith({ confirmSideChatDiscard: false });
    render("parent-b");
    expect(await (await request()).result).toBe(true);
    expect(renderer!.root.findByType("dialog").props.open).toBe(false);
    settings.confirmSideChatDiscard = true;
    const again = await request();
    expect(renderer!.root.findByType("dialog").props.open).toBe(true);
    click("Cancel");
    expect(await again.result).toBe(false);
  });

  it("ignores repeated requests and cancels a pending discard when changing conversations", async () => {
    render();
    const first = await request();
    expect(await (await request()).result).toBe(false);
    render("parent-b");
    expect(await first.result).toBe(false);
    expect(renderer!.root.findByType("dialog").props.open).toBe(false);
  });

  it("does not show a delayed prompt after unmount during settings hydration", async () => {
    let finish!: () => void;
    settings.hydrate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render();
    const first = await request();
    act(() => renderer!.unmount());
    renderer = null;
    await act(async () => finish());
    expect(await first.result).toBe(false);
    expect(settings.update).not.toHaveBeenCalled();
  });
});
