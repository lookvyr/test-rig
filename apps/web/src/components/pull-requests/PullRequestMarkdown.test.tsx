import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { PullRequestMarkdown } from "./PullRequestMarkdown";

describe("pull request Markdown", () => {
  it("renders third-party images as explicit links without requesting the image", () => {
    const html = renderToStaticMarkup(
      <PullRequestMarkdown text="![build result](https://images.example.org/tracker.png)" />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain('href="https://images.example.org/tracker.png"');
    expect(html).toContain("View image: build result");
  });
  it("does not render embedded raw HTML or unsafe script links", () => {
    const html = renderToStaticMarkup(
      <PullRequestMarkdown
        text={'<img src="https://images.example.org/raw.png">\n\n[click](javascript:alert(1))'}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
  });
});
