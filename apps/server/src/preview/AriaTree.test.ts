import { describe, expect, it } from "vite-plus/test";

import { compactAriaTree } from "./AriaTree.ts";

const todoTree = `- generic [ref=e1]:
  - complementary [ref=e2]:
    - heading "React" [level=3] [ref=e4]
    - blockquote [ref=e12]:
      - paragraph [ref=e13]: A long quote about building user interfaces that already appears in the page text.
      - link "React" [ref=e15] [cursor=pointer]:
        - /url: http://facebook.github.io/react
  - generic [ref=e35]:
    - heading "todos" [level=1] [ref=e37]
    - textbox "New Todo Input" [active] [ref=e38]:
      - /placeholder: What needs to be done?
    - main [ref=e44]:
      - list [ref=e46]:
        - listitem [ref=e47]:
          - generic [ref=e48]:
            - checkbox [checked] [ref=e49]
            - generic [ref=e50]: Buy milk
            - button "Delete todo" [ref=e51] [cursor=pointer]: ×
        - listitem [ref=e52]:
          - generic [ref=e53]:
            - checkbox [ref=e54]
            - generic [ref=e55]: Write the audit
            - button "Delete todo" [ref=e56] [cursor=pointer]: ×`;

describe("compactAriaTree", () => {
  it("keeps controls with refs and the text that labels unnamed ones", () => {
    expect(compactAriaTree(todoTree)).toBe(`- complementary:
  - heading "React" [level=3]
  - link "React" [ref=e15]
- heading "todos" [level=1]
- textbox "New Todo Input" [active] [ref=e38]:
  - /placeholder: What needs to be done?
- list:
  - listitem:
    - checkbox [checked] [ref=e49]
    - generic: Buy milk
    - button "Delete todo" [ref=e51]: ×
  - listitem:
    - checkbox [ref=e54]
    - generic: Write the audit
    - button "Delete todo" [ref=e56]: ×`);
  });

  it("treats a clickable element as a control, but not the clickable content of a link", () => {
    const tree = compactAriaTree(`- generic [ref=e1] [cursor=pointer]: Open menu
- link "Docs" [ref=e2] [cursor=pointer]:
  - img [ref=e3] [cursor=pointer]
  - generic [ref=e4] [cursor=pointer]: Docs
- paragraph [ref=e5]: Plain prose`);
    expect(tree).toBe(`- generic [ref=e1]: Open menu
- link "Docs" [ref=e2]`);
  });

  it("names an unnamed button by the text inside it", () => {
    expect(
      compactAriaTree(`- button [ref=e1]:
  - img "Close"
  - generic [ref=e2]: Close dialog`),
    ).toBe(`- button [ref=e1]:
  - img "Close"
  - generic: Close dialog`);
  });

  it("keeps frame refs, so controls inside a frame stay reachable", () => {
    expect(
      compactAriaTree(`- iframe [ref=e3]:
  - generic [ref=f1e1]:
    - textbox "child" [ref=f1e2]`),
    ).toBe(`- iframe [ref=e3]:
  - textbox "child" [ref=f1e2]`);
  });

  it("shortens long container names and labels without splitting an emoji", () => {
    const tree = compactAriaTree(`- row "${"🙂".repeat(100)}" [ref=e1]:
  - link "one" [ref=e2]
  - link "two" [ref=e3]
- listitem [ref=e4]:
  - checkbox [ref=e5]
  - generic [ref=e6]: ${"🙂".repeat(100)}`);
    expect(tree).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(tree.split("\n").every((line) => line.length < 120)).toBe(true);
    expect(tree).toContain('link "one" [ref=e2]');
  });

  it("returns nothing for a page without controls", () => {
    expect(compactAriaTree(`- paragraph [ref=e1]: Only text`)).toBe("");
  });

  it("parses keys Playwright quotes because the name has YAML syntax in it", () => {
    expect(
      compactAriaTree(`- 'heading "Issues: open" [level=1] [ref=e2]'
- 'navigation "Main: nav" [ref=e3]':
  - link "Home" [ref=e4] [cursor=pointer]:
    - /url: /a
  - 'link "Fix crash on load #123" [ref=e5] [cursor=pointer]':
    - /url: /b
- list [ref=e6]:
  - listitem [ref=e13]:
    - 'button "Save {draft}" [ref=e14]'
  - listitem [ref=e15]:
    - 'button "It''s \`npm test\`" [ref=e16]'
  - listitem [ref=e36]:
    - 'combobox "Pick: one" [ref=e37]':
      - 'option "A: 1" [selected]'
      - option "B"`),
    ).toBe(`- heading "Issues: open" [level=1]
- navigation "Main: nav":
  - link "Home" [ref=e4]
  - link "Fix crash on load #123" [ref=e5]
- list:
  - button "Save {draft}" [ref=e14]
  - button "It's \`npm test\`" [ref=e16]
  - combobox "Pick: one" [ref=e37]:
    - option "A: 1" [selected]
    - option "B"`);
  });

  it("keeps the named row or dialog around a lone unnamed control", () => {
    expect(
      compactAriaTree(`- table [ref=e1]:
  - rowgroup [ref=e2]:
    - row "Alice alice@x.com" [ref=e9]:
      - cell [ref=e10]:
        - checkbox [ref=e11]
      - cell "Alice" [ref=e12]
    - row "Bob bob@x.com" [ref=e14]:
      - cell [ref=e15]:
        - checkbox [ref=e16]
      - cell "Bob" [ref=e17]
- dialog "Delete item?" [ref=e20]:
  - button "Delete" [ref=e21]`),
    ).toBe(`- table:
  - row "Alice alice@x.com":
    - checkbox [ref=e11]
  - row "Bob bob@x.com":
    - checkbox [ref=e16]
- dialog "Delete item?":
  - button "Delete" [ref=e21]`);
  });
});
