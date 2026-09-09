import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { MarkdownPre, remarkPreserveCodeMeta } from "../MarkdownCodeBlock";

const remarkPlugins = [remarkGfm, remarkPreserveCodeMeta];
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "dataCodeMeta"],
  },
};

const components: Components = {
  pre: MarkdownPre,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
  details: ({ children, open }) => (
    <details open={open} className="my-3 rounded-md border px-3 [&[open]]:pb-2">
      {children}
    </details>
  ),
  summary: ({ children }) => (
    <summary className="cursor-pointer py-2 font-medium focus-visible:outline-2 focus-visible:outline-ring">
      {children}
    </summary>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline">
      {children}
    </a>
  ),
  // PR content is third-party material; images load only after an explicit click.
  img: ({ src, alt }) => (
    <a href={src} target="_blank" rel="noreferrer" className="text-xs underline">
      View image: {alt || "attached image"}
    </a>
  ),
};

export function PullRequestMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown min-w-0 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
