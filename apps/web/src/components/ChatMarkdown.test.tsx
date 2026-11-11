import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import ChatMarkdown from "./ChatMarkdown";

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../state/server", () => ({ serverEnvironment: { configValueAtom: () => null } }));
vi.mock("../state/assets", () => ({ assetEnvironment: { createUrl: null } }));
vi.mock("../state/preview", () => ({ previewEnvironment: { open: null } }));
vi.mock("../state/entities", () => ({ useActiveEnvironmentId: () => null }));
vi.mock("../state/session", () => ({ usePreparedConnection: () => ({ _tag: "None" }) }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../editorPreferences", () => ({ useOpenInPreferredEditor: () => vi.fn() }));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../hooks/useSettings", () => ({
  getClientSettings: () => ({ wordWrap: false }),
  useClientSettings: (select: (settings: { redesignEnabled: boolean }) => unknown) =>
    select({ redesignEnabled: false }),
}));
vi.mock("./ui/collapsible", () => ({
  Collapsible: (props: { children?: ReactNode }) => <div {...props} />,
  CollapsibleTrigger: (props: { children?: ReactNode }) => <button {...props} />,
  CollapsiblePanel: (props: { children?: ReactNode }) => <section {...props} />,
}));

let renderer: ReactTestRenderer | undefined;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("streamed markdown state", () => {
  it("preserves an opened disclosure when unchanged text finishes streaming", () => {
    const text = "<details><summary>More</summary>Hidden text</details>";
    act(() => {
      renderer = create(<ChatMarkdown cwd={undefined} text={text} isStreaming />);
    });
    const disclosure = () =>
      renderer!.root
        .findAllByType("div")
        .find((node) => node.props["data-markdown-details"] !== undefined)!;
    act(() => disclosure().props.onOpenChange(true));
    act(() => renderer!.update(<ChatMarkdown cwd={undefined} text={text} />));
    expect(disclosure().props["data-markdown-details-open"]).toBe("true");
  });

  it.each([
    "<details><summary>More</summary>Hidden text</details>",
    "- <details><summary>More</summary>Hidden text</details>",
  ])("preserves an opened disclosure through new text and completion: %s", (text) => {
    act(() => {
      renderer = create(<ChatMarkdown cwd={undefined} text={text} isStreaming />);
    });
    const disclosure = () =>
      renderer!.root
        .findAllByType("div")
        .find((node) => node.props["data-markdown-details"] !== undefined)!;
    act(() => disclosure().props.onOpenChange(true));
    expect(disclosure().props["data-markdown-details-open"]).toBe("true");
    act(() =>
      renderer!.update(
        <ChatMarkdown cwd={undefined} text={`${text}\n\nFollowing text`} isStreaming />,
      ),
    );
    expect(disclosure().props["data-markdown-details-open"]).toBe("true");
    act(() =>
      renderer!.update(<ChatMarkdown cwd={undefined} text={`${text}\n\nFollowing text`} />),
    );
    expect(disclosure().props["data-markdown-details-open"]).toBe("true");
  });
});

describe("inline code selection", () => {
  it("selects the whole inline code span on double-click, but leaves fenced code to native word selection", () => {
    const selectAllChildren = vi.fn();
    vi.stubGlobal("window", { getSelection: () => ({ selectAllChildren }) });
    act(() => {
      renderer = create(
        <ChatMarkdown
          cwd={undefined}
          text={"Run `migration-gate --dry-run` first.\n\n```txt\nfenced-block word\n```"}
        />,
      );
    });
    const codes = renderer!.root.findAllByType("code");
    const inline = codes.find((node) => node.props["data-inline-code"] !== undefined)!;
    const fenced = codes.filter((node) => node.props["data-inline-code"] === undefined);
    expect(fenced.length).toBeGreaterThan(0);
    for (const node of fenced) expect(node.props.onDoubleClick).toBeUndefined();

    const target = { tagName: "CODE" };
    inline.props.onDoubleClick({ currentTarget: target });
    expect(selectAllChildren).toHaveBeenCalledWith(target);
  });
});
