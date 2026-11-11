/**
 * Shrinks a Playwright `ariaSnapshot({ mode: "ai" })` tree to what an agent acts on: interactive
 * elements with their refs, headings for orientation, the containers that group them, and the
 * text that labels an unnamed control. Snapshots carry page prose in `visibleText`, so the full
 * tree mostly repeats it, along with structural refs and link URLs agents rarely use.
 */

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "iframe",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "scrollbar",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

/** Wrappers that add depth but no meaning; a cell's name only repeats its content. */
const TRANSPARENT_ROLES = new Set(["cell", "none", "paragraph", "presentation", "rowgroup"]);
/** Wrappers that only mean something when named. */
const UNNAMED_TRANSPARENT_ROLES = new Set(["generic", "group"]);

const MAX_LABEL_CHARS = 80;
/** Container names are usually their content run together. */
const MAX_CONTAINER_NAME_CHARS = 60;

type Node = {
  readonly role: string;
  readonly named: boolean;
  /** The line after `- `, without the trailing `:` that opens children. */
  readonly body: string;
  readonly pointer: boolean;
  readonly children: Node[];
  readonly props: string[];
};

type Out = { readonly line: string; readonly children: ReadonlyArray<Out> };

const cut = (text: string, max: number) => {
  if (text.length <= max) return text;
  // Half an emoji serializes to a lone surrogate escape, which provider JSON parsers reject.
  const last = text.charCodeAt(max - 1);
  return `${text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max)}…`;
};

/** Index just past a leading double-quoted name, or `start` when there is none. */
const nameEnd = (body: string, start: number) => {
  if (body[start] !== " " || body[start + 1] !== '"') return start;
  for (let i = start + 2; i < body.length; i++) {
    if (body[i] === "\\") i++;
    else if (body[i] === '"') return i + 1;
  }
  return body.length;
};

const parseNode = (body: string): Node => {
  const role = /^[A-Za-z]+/.exec(body)?.[0] ?? "text";
  const end = nameEnd(body, role.length);
  const rest = body.slice(end);
  const attrs = /^(?:\s*\[[^\]]*\])*/.exec(rest)?.[0] ?? "";
  const opensChildren = rest.slice(attrs.length).trimEnd() === ":";
  return {
    role,
    named: end > role.length,
    body: opensChildren ? body.slice(0, end) + attrs : body,
    pointer: attrs.includes("[cursor=pointer]"),
    children: [],
    props: [],
  };
};

const parse = (tree: string): Node[] => {
  const roots: Node[] = [];
  const stack: Array<{ depth: number; node: Node }> = [];
  for (const line of tree.split("\n")) {
    const match = /^( *)- (.*)$/.exec(line);
    if (!match) continue;
    const depth = match[1]!.length;
    const body = match[2]!;
    while (stack.length > 0 && stack.at(-1)!.depth >= depth) stack.pop();
    const parent = stack.at(-1)?.node;
    if (body.startsWith("/")) {
      parent?.props.push(body);
      continue;
    }
    const node = parseNode(body);
    (parent?.children ?? roots).push(node);
    stack.push({ depth, node });
  }
  return roots;
};

/** The node's line with layout noise removed; only actionable nodes keep their refs. */
const render = (node: Node, keepRef: boolean, label = false) => {
  let line = node.body.replace(/ \[cursor=pointer\]/g, "");
  if (!keepRef) line = line.replace(/ \[ref=[^\]]*\]/g, "");
  if (!keepRef && node.named && node.children.length > 0) {
    const end = nameEnd(line, node.role.length);
    const name = line.slice(node.role.length + 2, end - 1);
    if (name.length > MAX_CONTAINER_NAME_CHARS) {
      line = `${node.role} "${cut(name, MAX_CONTAINER_NAME_CHARS).replace(/\\$/, "")}"${line.slice(end)}`;
    }
  }
  if (label) {
    const colon = line.indexOf(": ", nameEnd(line, node.role.length));
    line =
      colon === -1
        ? cut(line, MAX_LABEL_CHARS + node.role.length + 4)
        : line.slice(0, colon + 2) + cut(line.slice(colon + 2), MAX_LABEL_CHARS);
  }
  return line;
};

const isLeafText = (node: Node) =>
  node.children.length === 0 && !INTERACTIVE_ROLES.has(node.role) && node.role !== "heading";

const compactNode = (
  node: Node,
  context: { readonly insideControl: boolean; readonly keepLabels: boolean },
): Out[] => {
  const control = INTERACTIVE_ROLES.has(node.role) || (node.pointer && !context.insideControl);
  // An unnamed control is known by the text beside or inside it.
  const insideControl = context.insideControl || control;
  const labelsChildren = node.children.some(
    (child) =>
      !child.named && (INTERACTIVE_ROLES.has(child.role) || (child.pointer && !insideControl)),
  );
  const children = node.children.flatMap((child) =>
    compactNode(child, {
      insideControl,
      keepLabels: labelsChildren || (control && !node.named),
    }),
  );
  if (control) {
    const props = node.props.filter((prop) => !prop.startsWith("/url:"));
    return [
      {
        line: render(node, true),
        children: [...props.map((prop) => ({ line: prop, children: [] })), ...children],
      },
    ];
  }
  if (node.role === "heading") return [{ line: render(node, false), children }];
  if (isLeafText(node)) {
    return context.keepLabels && (node.named || node.body.includes(": "))
      ? [{ line: render(node, false, true), children: [] }]
      : [];
  }
  if (children.length === 0) return [];
  if (
    children.length === 1 ||
    TRANSPARENT_ROLES.has(node.role) ||
    (!node.named && UNNAMED_TRANSPARENT_ROLES.has(node.role))
  ) {
    return children;
  }
  return [{ line: render(node, false), children }];
};

const print = (nodes: ReadonlyArray<Out>, depth: number, lines: string[]) => {
  for (const node of nodes) {
    lines.push(`${"  ".repeat(depth)}- ${node.line}${node.children.length > 0 ? ":" : ""}`);
    print(node.children, depth + 1, lines);
  }
};

export const compactAriaTree = (tree: string): string => {
  const lines: string[] = [];
  print(
    parse(tree).flatMap((node) => compactNode(node, { insideControl: false, keepLabels: false })),
    0,
    lines,
  );
  return lines.join("\n");
};
