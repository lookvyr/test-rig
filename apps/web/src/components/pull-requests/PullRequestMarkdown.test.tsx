import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
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
  it("keeps raw HTML images click-to-open and removes active HTML and unsafe links", () => {
    const html = renderToStaticMarkup(
      <PullRequestMarkdown
        text={
          '<img src="https://images.example.org/raw.png" onerror="alert(1)">\n\n<script>alert(1)</script><iframe src="https://example.org"></iframe>\n\n<a href="javascript:alert(1)" onclick="alert(1)">HTML link</a>\n\n[click](javascript:alert(1))'
        }
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://images.example.org/raw.png"');
    expect(html).not.toMatch(/<script|<iframe|onerror=|onclick=/);
  });

  it("renders nested Markdown and tables inside expandable HTML sections", () => {
    const html = renderToStaticMarkup(
      <PullRequestMarkdown
        text={[
          "## Validation",
          "",
          "<details open>",
          "<summary>Test results</summary>",
          "",
          "**Passed** and ~~obsolete~~",
          "",
          "- [x] Unit tests",
          "- [ ] Manual checks",
          "",
          "| Check | Result |",
          "| --- | --- |",
          "| Build | Passed |",
          "",
          "</details>",
        ].join("\n")}
      />,
    );
    expect(html).toContain("<h2>Validation</h2>");
    expect(html).toMatch(/<details[^>]*open=""/);
    expect(html).toContain("Test results</summary>");
    expect(html).toContain("<strong>Passed</strong>");
    expect(html).toContain("<del>obsolete</del>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<table>");
    expect(html).not.toContain("&lt;details");
  });

  it.each([
    ["typescript", "const answer: number = 42;"],
    ["ts", "const answer: number = 42;"],
    ["gherkin", "Feature: PR descriptions\n  Scenario: Show code\n    Given a fenced code block"],
  ])(
    "highlights %s fences inside details with the shared code controls",
    async (language, code) => {
      const text = `<details>\n<summary>Example</summary>\n\n\`\`\`${language} title="example.txt"\n${code}\n\`\`\`\n\n</details>`;
      const stream = await renderToReadableStream(<PullRequestMarkdown text={text} />);
      await stream.allReady;
      const html = await new Response(stream).text();
      expect(html).toContain(`data-language="${language}"`);
      expect(html).toContain("example.txt");
      expect(html).toContain('aria-label="Copy code"');
      expect(html).toMatch(/aria-label="(?:Wrap lines|Disable line wrap)"/);
      expect(html).toContain('class="shiki');
      expect(html).toContain('<span style="color:');
    },
  );

  it("preserves unknown-language fences and literal HTML inside code", async () => {
    const stream = await renderToReadableStream(
      <PullRequestMarkdown text={"```unknown-pr-language\n<script>example()</script>\n```"} />,
    );
    await stream.allReady;
    const html = await new Response(stream).text();
    expect(html).toContain("&#x3C;script>example()&#x3C;/script>");
    expect(html).not.toContain("<script>example()");
  });
});
