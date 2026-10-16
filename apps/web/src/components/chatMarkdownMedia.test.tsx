import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { describe, expect, it } from "vite-plus/test";

import { markdownMediaLayout, rehypeTagMediaLayout } from "./chatMarkdownMedia";

function renderMediaLayout(text: string) {
  return renderToStaticMarkup(
    <ReactMarkdown
      rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeTagMediaLayout]}
      components={{
        img: ({ node }) => (
          <span
            data-standalone={markdownMediaLayout(node)?.mediaStandalone === true}
            data-linked={markdownMediaLayout(node)?.mediaInsideLink === true}
          />
        ),
      }}
    >
      {text}
    </ReactMarkdown>,
  );
}

describe("reply media block layout", () => {
  it.each([
    "![Result](/tmp/result.png)",
    "- ![Result](/tmp/result.png)",
    "1. ![Result](/tmp/result.png)",
    "> ![Result](/tmp/result.png)",
    "**Final screenshot**\n![Browser screenshot](/tmp/result.png)",
    "Final screenshot  \n![Browser screenshot](/tmp/result.png)",
    "Here is the result.\n![Browser screenshot](/tmp/result.png)\nThe flow is complete.",
    "![First](/tmp/first.png)\n![Second](/tmp/second.png)",
    "<div>\n<img src='/tmp/result.png'>\n</div>",
  ])("keeps standalone controls in paragraphs, lists, quotes, and raw blocks: %s", (text) => {
    expect(renderMediaLayout(text)).toContain('data-standalone="true"');
  });

  it.each([
    "See ![Result](/tmp/result.png) here.",
    "[![Result](/tmp/result.png)](https://example.test/result)",
    "<a href='https://example.test/result'>\n<img src='/tmp/result.png'>\n</a>",
  ])("keeps sentence and linked images free of standalone controls: %s", (text) => {
    expect(renderMediaLayout(text)).toContain('data-standalone="false"');
  });

  it("recognizes anchors separated from their image by raw HTML wrappers", () => {
    const markup = renderMediaLayout(
      "<a href='https://example.test/result'><span>\n<img src='/tmp/result.png'>\n</span></a>",
    );
    expect(markup).toContain('data-linked="true"');
    expect(markup).toContain('data-standalone="false"');
  });
});
