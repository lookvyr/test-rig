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
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
  },
};
