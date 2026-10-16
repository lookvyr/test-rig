import { EnvironmentId } from "@t3tools/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ChatMarkdownAssetImage, ChatMarkdownDirectMedia } from "./ChatMarkdownAssetImage";

vi.mock("../assets/assetUrls", () => ({
  useAssetUrlState: () => ({
    _tag: "Success",
    url: "https://environment.test/api/assets/screenshot.png",
    imageDimensions: { width: 900, height: 1600 },
  }),
  useAssetUrlRefresh: () => vi.fn(),
}));
vi.mock("./media/MediaActions", () => ({
  MediaActions: ({ children }: { children: ReactElement }) => children,
  MediaActionBar: ({ onExpand }: { onExpand?: () => void }) => (
    <span>Save{onExpand ? " Expand" : ""}</span>
  ),
}));

describe("reply media", () => {
  it("renders saved browser screenshots with shared bounded loading and expansion actions", () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdownAssetImage
        environmentId={EnvironmentId.make("environment-media")}
        resource={{ _tag: "browser-screenshot", fileName: "browser-screenshot-demo.png" }}
        alt="Browser result"
        onImageExpand={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-label="Loading image"');
    expect(markup).toContain("aspect-ratio:900 / 1600");
    expect(markup).toContain("max-width:min(100%, 30rem, 16.875rem)");
    expect(markup).toContain("Save Expand");
    expect(markup).toContain('src="https://environment.test/api/assets/screenshot.png"');
  });

  it("renders remote video embeds with native controls and no duplicate action bar", () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdownDirectMedia
        src="https://example.test/demo.mp4?token=abc#t=2"
        kind="video"
        alt="Demo"
        standalone
        onImageExpand={vi.fn()}
      />,
    );
    expect(markup).toContain("<video");
    expect(markup).toContain('src="https://example.test/demo.mp4?token=abc#t=2"');
    expect(markup).toContain('controls=""');
    expect(markup).not.toContain("Save Expand");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<img");
  });

  it("does not add a media toolbar to images embedded in a sentence", () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdownDirectMedia
        src="https://example.test/badge.svg"
        kind="image"
        alt="Build status"
        standalone={false}
      />,
    );
    expect(markup).toContain("<img");
    expect(markup).not.toContain("Save");
  });
});
