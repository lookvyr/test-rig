import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";
import { ServerBrowserSessions } from "./browser/ServerBrowserSessions";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: vi.fn(),
}));

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { BrowserProfileReporter } from "./browser/BrowserProfileReporter";
import { PreviewShortcutForwarder } from "./browser/PreviewShortcutForwarder";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";
import { AppRoot } from "./AppRoot";

describe("AppRoot", () => {
  it("shares the application atom registry with routed UI and renderer-wide desktop hosts", () => {
    const root = AppRoot({ router: {} as AppRouter });

    expect(root.type).toBe(AppAtomRegistryProvider);
    const children = Children.toArray(
      (root as ReactElement<{ readonly children: ReactNode }>).props.children,
    );
    expect(children).toHaveLength(5);
    expect(isValidElement(children[0]) && children[0].type).toBe(RouterProvider);
    expect(isValidElement(children[1]) && children[1].type).toBe(ElectronBrowserHost);
    expect(isValidElement(children[2]) && children[2].type).toBe(ServerBrowserSessions);
    expect(isValidElement(children[3]) && children[3].type).toBe(BrowserProfileReporter);
    expect(isValidElement(children[4]) && children[4].type).toBe(PreviewShortcutForwarder);
  });
});
