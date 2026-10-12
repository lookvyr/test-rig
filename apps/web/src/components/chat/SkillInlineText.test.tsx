import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SkillInlineText } from "./SkillInlineText";

describe("sent library skill mentions", () => {
  it("renders the workspace catalogue label and preserves the alias for copying", () => {
    const name = "test-rig:12345678-1234-4234-8234-123456789abc";
    const markup = renderToStaticMarkup(
      createElement(SkillInlineText, {
        text: `Use $${name} please`,
        skills: [{ name, displayName: "Review Follow-up" }],
      }),
    );
    expect(markup).toContain("Review Follow-up");
    expect(markup).toContain(`data-markdown-copy="$${name}"`);
    expect(markup).toContain(" please");
  });
});
