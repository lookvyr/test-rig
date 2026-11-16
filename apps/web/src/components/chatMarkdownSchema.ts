import { THREAD_LINK_PROTOCOL } from "@t3tools/shared/threadLinks";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

export const CHAT_MARKDOWN_SANITIZE_SCHEMA: NonNullable<Parameters<typeof rehypeSanitize>[0]> = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": (defaultSchema.attributes?.["*"] ?? []).filter((attribute) => attribute !== "title"),
    code: [...(defaultSchema.attributes?.code ?? []), "dataCodeMeta", "dataInlineCode"],
  },
  protocols: {
    ...defaultSchema.protocols,
    // Thread links render as chips; the URL transform checks the rest of the link's shape.
    href: [...(defaultSchema.protocols?.href ?? []), "file", THREAD_LINK_PROTOCOL],
  },
};
