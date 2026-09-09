import { MarkdownPre, nodeToPlainText, remarkPreserveCodeMeta } from "./MarkdownCodeBlock";
import { useAtomValue } from "@effect/atom-react";
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  GlobeIcon,
  Maximize2Icon,
  Minimize2Icon,
} from "lucide-react";
import type { EnvironmentId, ScopedThreadRef, ServerProviderSkill } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import React, {
  Children,
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
  isValidElement,
  useCallback,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Components, Options as ReactMarkdownOptions } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { renderSkillInlineMarkdownChildren } from "./chat/SkillInlineText";
import { CHAT_FILE_TAG_CHIP_CLASS_NAME, FileTagChipContent } from "./chat/FileTagChip";
import {
  resolveExternalWebLinkHost,
  showExternalLinkContextMenu,
} from "./chat/externalLinkContextMenu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { Button } from "./ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import { ScrollArea } from "./ui/scroll-area";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { useOpenInPreferredEditor } from "../editorPreferences";
import { useTheme } from "../hooks/useTheme";
import { getClientSettings } from "../hooks/useSettings";
import {
  chatMarkdownClipboardPayload,
  serializeTableElementToCsv,
  serializeTableElementToMarkdown,
} from "../markdown-clipboard";
import { remarkNormalizeListItemIndentation } from "../markdown-list-indentation";
import {
  normalizeMarkdownLinkDestination,
  resolveInlineCodeFileLinkMeta,
  resolveMarkdownFileLinkMeta,
  rewriteMarkdownFileUriHref,
  resolveMarkdownBrowserScreenshotFileName,
  type MarkdownFileLinkMeta,
} from "../markdown-links";
import { readLocalApi } from "../localApi";
import { cn } from "../lib/utils";
import { useRightPanelStore } from "../rightPanelStore";
import { useActiveEnvironmentId } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { assetEnvironment } from "../state/assets";
import { useAssetUrlState } from "../assets/assetUrls";
import { usePreparedConnection } from "../state/session";
import { previewEnvironment } from "../state/preview";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { isPreviewSupportedInRuntime } from "../previewStateStore";
import {
  isBrowserPreviewFile,
  openFileInPreview,
  openUrlInPreview,
  BrowserPreviewUnavailableError,
} from "../browser/openFileInPreview";

function MarkdownBrowserScreenshot({
  environmentId,
  fileName,
  alt = "Browser screenshot",
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & { environmentId: EnvironmentId; fileName: string }) {
  const resource = useMemo(() => ({ _tag: "browser-screenshot" as const, fileName }), [fileName]);
  const image = useAssetUrlState(environmentId, resource);
  if (image._tag === "Failure") return <span>{alt} (screenshot unavailable)</span>;
  return (
    <img
      {...props}
      alt={alt}
      src={image._tag === "Success" ? image.url : undefined}
      loading="lazy"
    />
  );
}

interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  threadRef?: ScopedThreadRef | undefined;
  onTaskListChange?: ((input: { markerOffset: number; checked: boolean }) => void) | undefined;
  isStreaming?: boolean;
  skills?: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  className?: string;
  /** Treat single newlines as hard breaks — chat-style user input. */
  lineBreaks?: boolean;
}

const EMPTY_MARKDOWN_SKILLS: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">> = [];

interface MarkdownActionFailureContext {
  readonly operation: string;
  readonly target?: string;
  readonly format?: "markdown" | "csv";
  readonly language?: string;
  readonly fenceTitle?: string;
  readonly copyTarget?: string;
}

function reportMarkdownActionFailure(context: MarkdownActionFailureContext, cause: unknown): void {
  console.error("[chat-markdown] action failed", context, cause);
}

function findTaskListMarkerOffset(markdown: string, listItemStart: number): number | null {
  const firstLineEnd = markdown.indexOf("\n", listItemStart);
  const firstLine = markdown.slice(
    listItemStart,
    firstLineEnd === -1 ? markdown.length : firstLineEnd,
  );
  const match = firstLine.match(/^(?:\s*(?:[-+*]|\d+[.)])\s+)(\[[ xX]\])/);
  if (!match?.[1]) return null;
  return listItemStart + firstLine.indexOf(match[1]);
}
const CHAT_MARKDOWN_SANITIZE_SCHEMA = {
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
} satisfies Parameters<typeof rehypeSanitize>[0];

const CHAT_MARKDOWN_REMARK_PLUGINS = [
  remarkGfm,
  remarkNormalizeListItemIndentation,
  remarkPreserveCodeMeta,
  remarkTagInlineCode,
] satisfies NonNullable<ReactMarkdownOptions["remarkPlugins"]>;

const CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS = [
  remarkGfm,
  remarkNormalizeListItemIndentation,
  remarkBreaks,
  remarkPreserveCodeMeta,
  remarkTagInlineCode,
] satisfies NonNullable<ReactMarkdownOptions["remarkPlugins"]>;

const CHAT_MARKDOWN_REHYPE_PLUGINS = [
  rehypeRaw,
  [rehypeSanitize, CHAT_MARKDOWN_SANITIZE_SCHEMA],
] satisfies NonNullable<ReactMarkdownOptions["rehypePlugins"]>;

type MarkdownAstNode = {
  type?: string;
  data?: { hProperties?: Record<string, unknown> };
  children?: MarkdownAstNode[];
};

/**
 * Fenced code also lands on the `code` component, and inline vs block is no
 * longer distinguishable there once both render `<code>` — so inline spans are
 * tagged on the mdast, where the distinction still exists. Code inside a link
 * label stays untagged: linkifying it would nest an anchor inside the link's
 * anchor and steal its clicks.
 */
function remarkTagInlineCode() {
  return (tree: MarkdownAstNode) => {
    const visit = (node: MarkdownAstNode, insideLink: boolean) => {
      if (node.type === "inlineCode" && !insideLink) {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            dataInlineCode: "",
          },
        };
      }
      const childInsideLink = insideLink || node.type === "link" || node.type === "linkReference";
      node.children?.forEach((child) => visit(child, childInsideLink));
    };

    visit(tree, false);
  };
}

function MarkdownTable({ children, ...props }: React.ComponentProps<"table">) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [expanded, setExpanded] = useState(() => getClientSettings().wordWrap);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandLabel = expanded ? "Collapse table cells" : "Expand table cells";
  const copyLabel = copied ? "Copied" : "Copy table";

  function toggleExpanded() {
    const table = tableRef.current;
    if (!table) return;

    if (!expanded) {
      const rows = [...table.rows];
      const columnWidths = rows.reduce<number[]>((widths, row) => {
        [...row.cells].forEach((cell, columnIndex) => {
          widths[columnIndex] = Math.max(
            widths[columnIndex] ?? 0,
            cell.getBoundingClientRect().width,
          );
        });
        return widths;
      }, []);

      [...(table.tHead?.rows[0]?.cells ?? [])].forEach((cell, columnIndex) => {
        cell.style.minWidth = `${columnWidths[columnIndex] ?? cell.getBoundingClientRect().width}px`;
      });
    }

    setExpanded((value) => !value);
  }

  const handleCopy = useCallback((format: "markdown" | "csv") => {
    const table = containerRef.current?.querySelector("table");
    if (!table || typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    const text =
      format === "markdown"
        ? serializeTableElementToMarkdown(table)
        : serializeTableElementToCsv(table);
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      })
      .catch((cause) => {
        reportMarkdownActionFailure({ operation: "copy-table", format }, cause);
      });
  }, []);

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className="chat-markdown-table-container"
      data-expanded={expanded ? "true" : "false"}
    >
      <ScrollArea
        chainVerticalScroll
        scrollFade
        hideScrollbars
        className="w-full max-w-full rounded-none"
      >
        <table ref={tableRef} {...props}>
          {children}
        </table>
      </ScrollArea>
      <div className="chat-markdown-table-footer select-none">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="chat-markdown-chrome-action"
                aria-pressed={expanded}
                onClick={toggleExpanded}
                aria-label={expandLabel}
              />
            }
          >
            {expanded ? <Minimize2Icon className="size-3" /> : <Maximize2Icon className="size-3" />}
          </TooltipTrigger>
          <TooltipPopup side="top">{expandLabel}</TooltipPopup>
        </Tooltip>
        <Menu>
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="chat-markdown-chrome-action"
                      aria-label={copyLabel}
                    />
                  }
                />
              }
            >
              {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            </TooltipTrigger>
            <TooltipPopup side="top">{copyLabel}</TooltipPopup>
          </Tooltip>
          <MenuPopup align="end">
            <MenuItem onClick={() => handleCopy("markdown")}>Copy as Markdown</MenuItem>
            <MenuItem onClick={() => handleCopy("csv")}>Copy as CSV</MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
}

function MarkdownDetails({
  children,
  open = false,
}: Pick<React.ComponentProps<"details">, "children" | "open">) {
  const [isOpen, setIsOpen] = useState(open);
  const childNodes = Children.toArray(children);
  const summaryIndex = childNodes.findIndex(
    (child) => isValidElement(child) && child.type === "summary",
  );
  const summaryNode = summaryIndex >= 0 ? childNodes[summaryIndex] : null;
  const summary =
    isValidElement<{ children?: ReactNode }>(summaryNode) && summaryNode.props.children
      ? summaryNode.props.children
      : "Details";
  const content = childNodes.filter((_, index) => index !== summaryIndex);

  return (
    <Collapsible
      defaultOpen={open}
      onOpenChange={setIsOpen}
      className="chat-markdown-details my-2 border-y border-border/60"
      data-markdown-details=""
      data-markdown-details-open={isOpen ? "true" : "false"}
    >
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 py-2 text-left text-sm font-medium text-foreground data-panel-open:[&_svg]:rotate-90"
        data-markdown-details-summary=""
      >
        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground transition-transform"
          aria-hidden
        />
        <span>{summary}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="pb-3 ps-6 text-foreground/80" data-markdown-details-content="">
          {content}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

interface MarkdownFileLinkProps {
  href: string;
  targetPath: string;
  iconPath: string;
  displayPath: string;
  workspaceRelativePath: string | null;
  line?: number | undefined;
  label: string;
  copyMarkdown: string;
  theme: "light" | "dark";
  threadRef?: ScopedThreadRef | undefined;
  onOpen: (targetPath: string) => Promise<AtomCommandResult<unknown, unknown>>;
  onOpenInBrowser?: (() => Promise<AtomCommandResult<unknown, unknown>>) | undefined;
  className?: string | undefined;
}

const MARKDOWN_LINK_HREF_PATTERN = /\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const MARKDOWN_FILE_LINK_CLASS_NAME =
  "chat-markdown-file-link cursor-pointer transition-colors hover:bg-accent/70";

function pathParentSegments(path: string): string[] {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments.slice(0, -1);
}

function buildFileLinkParentSuffixByPath(filePaths: ReadonlyArray<string>): Map<string, string> {
  const groups = new Map<string, Set<string>>();
  for (const filePath of filePaths) {
    const pathSegments = filePath
      .replaceAll("\\", "/")
      .split("/")
      .filter((segment) => segment.length > 0);
    const basename = pathSegments[pathSegments.length - 1];
    if (!basename) continue;
    const group = groups.get(basename) ?? new Set<string>();
    group.add(filePath);
    groups.set(basename, group);
  }

  const suffixByPath = new Map<string, string>();
  for (const group of groups.values()) {
    const uniquePaths = [...group];
    if (uniquePaths.length < 2) continue;

    const parentSegmentsByPath = new Map(
      uniquePaths.map((filePath) => [filePath, pathParentSegments(filePath)]),
    );
    const minUniqueDepthByPath = new Map<string, number>();

    for (const filePath of uniquePaths) {
      const segments = parentSegmentsByPath.get(filePath) ?? [];
      let resolvedDepth = segments.length;
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const candidate = segments.slice(-depth).join("/");
        const collision = uniquePaths.some((otherPath) => {
          if (otherPath === filePath) return false;
          const otherSegments = parentSegmentsByPath.get(otherPath) ?? [];
          return otherSegments.slice(-depth).join("/") === candidate;
        });
        if (!collision) {
          resolvedDepth = depth;
          break;
        }
      }
      minUniqueDepthByPath.set(filePath, resolvedDepth);
    }

    for (const filePath of uniquePaths) {
      const segments = parentSegmentsByPath.get(filePath) ?? [];
      if (segments.length === 0) continue;
      const minUniqueDepth = minUniqueDepthByPath.get(filePath) ?? 1;
      const suffixDepth = Math.min(segments.length, Math.max(minUniqueDepth, 2));
      suffixByPath.set(filePath, segments.slice(-suffixDepth).join("/"));
    }
  }

  return suffixByPath;
}

const FENCED_CODE_SEGMENT_PATTERN = /(```[\s\S]*?(?:```|$))/;
const INLINE_CODE_SPAN_PATTERN = /`([^`\n]+)`/g;

function extractInlineCodeSpans(text: string): string[] {
  const spans: string[] = [];
  const segments = text.split(FENCED_CODE_SEGMENT_PATTERN);
  for (let index = 0; index < segments.length; index += 2) {
    for (const match of (segments[index] ?? "").matchAll(INLINE_CODE_SPAN_PATTERN)) {
      const span = match[1]?.trim();
      if (span) spans.push(span);
    }
  }
  return spans;
}

function extractMarkdownLinkHrefs(text: string): string[] {
  const hrefs: string[] = [];
  for (const match of text.matchAll(MARKDOWN_LINK_HREF_PATTERN)) {
    const href = match[1]?.trim();
    if (!href) continue;
    hrefs.push(href);
  }
  return hrefs;
}

function normalizeMarkdownLinkHrefKey(href: string): string {
  const normalizedHref = normalizeMarkdownLinkDestination(href);
  return rewriteMarkdownFileUriHref(normalizedHref) ?? normalizedHref;
}

const MARKDOWN_LINK_FAVICON_CLASS_NAME = "block size-full shrink-0 select-none";

const MarkdownLinkIcon = memo(function MarkdownLinkIcon() {
  return (
    <span className="chat-markdown-link-favicon" aria-hidden>
      <GlobeIcon className={MARKDOWN_LINK_FAVICON_CLASS_NAME} />
    </span>
  );
});

function leadingExternalLinkTextLength(text: string): number {
  const protocol = /^(?:https?:\/\/)/i.exec(text)?.[0];
  if (protocol) return protocol.length;
  return Math.min(text.length, 1);
}

function breakableExternalLinkText(text: string): ReactNode[] {
  return Array.from(text, (character, index) => (
    <React.Fragment key={`${index}:${character}`}>
      {character}
      <wbr />
    </React.Fragment>
  ));
}

function plainHastText(node: unknown): string | null {
  if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray(node.children)) {
    return null;
  }
  const parts = node.children.map((child) => {
    if (
      child &&
      typeof child === "object" &&
      "type" in child &&
      child.type === "text" &&
      "value" in child &&
      typeof child.value === "string"
    ) {
      return child.value;
    }
    return null;
  });
  return parts.every((part) => part !== null) ? parts.join("") : null;
}

const SANITIZED_FRAGMENT_PREFIX = "user-content-";

function decodeMarkdownFragmentId(href: string): string {
  const encodedId = href.slice(1);
  try {
    return decodeURIComponent(encodedId);
  } catch {
    return encodedId;
  }
}

function normalizeSanitizedFragmentId(id: string): string {
  let normalizedId = id;
  while (normalizedId.startsWith(SANITIZED_FRAGMENT_PREFIX)) {
    normalizedId = normalizedId.slice(SANITIZED_FRAGMENT_PREFIX.length);
  }
  return normalizedId;
}

function findMarkdownFragmentTarget(anchor: HTMLAnchorElement, href: string): HTMLElement | null {
  const decodedId = decodeMarkdownFragmentId(href);
  const normalizedId = normalizeSanitizedFragmentId(decodedId);
  const matchesFragment = (element: HTMLElement) =>
    element.id === decodedId || normalizeSanitizedFragmentId(element.id) === normalizedId;
  const markdownRoot = anchor.closest<HTMLElement>(".chat-markdown");
  if (markdownRoot) {
    const localTargets = Array.from(markdownRoot.querySelectorAll<HTMLElement>("[id]"));
    const localTarget = localTargets.find(matchesFragment);
    if (localTarget) return localTarget;
  }

  return (
    document.getElementById(decodedId) ??
    Array.from(document.querySelectorAll<HTMLElement>("[id]")).find(matchesFragment) ??
    null
  );
}

function handleMarkdownFragmentClick(event: ReactMouseEvent<HTMLAnchorElement>, href: string) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  const target = findMarkdownFragmentTarget(event.currentTarget, href);
  if (!target) return;

  event.preventDefault();
  const nextUrl = new URL(window.location.href);
  nextUrl.hash = href.slice(1);
  window.history.pushState(window.history.state, "", nextUrl);
  target.scrollIntoView({ block: "nearest" });
}

function MarkdownExternalLinkContent({
  plainText,
  children,
}: {
  plainText: string | null;
  children: ReactNode;
}) {
  if (plainText) {
    const leadingLength = leadingExternalLinkTextLength(plainText);
    return (
      <>
        <span className="chat-markdown-link-leading">
          <MarkdownLinkIcon />
          {plainText.slice(0, leadingLength)}
        </span>
        {breakableExternalLinkText(plainText.slice(leadingLength))}
      </>
    );
  }

  const childNodes = Children.toArray(children);
  const firstChild = childNodes[0];

  if (typeof firstChild === "string" && firstChild.length > 0) {
    const leadingLength = leadingExternalLinkTextLength(firstChild);
    return (
      <>
        <span className="chat-markdown-link-leading">
          <MarkdownLinkIcon />
          {firstChild.slice(0, leadingLength)}
        </span>
        {breakableExternalLinkText(firstChild.slice(leadingLength))}
        {childNodes.slice(1)}
      </>
    );
  }

  return (
    <>
      <span className="chat-markdown-link-leading">
        <MarkdownLinkIcon />
        {firstChild}
      </span>
      {childNodes.slice(1)}
    </>
  );
}

const MarkdownFileLink = memo(function MarkdownFileLink({
  href,
  targetPath,
  iconPath,
  displayPath,
  workspaceRelativePath,
  line,
  label,
  copyMarkdown,
  theme,
  threadRef,
  onOpen,
  onOpenInBrowser,
  className,
}: MarkdownFileLinkProps) {
  const handleOpenInEditor = useCallback(() => {
    void (async () => {
      try {
        const result = await onOpen(targetPath);
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
          return;
        }
        reportMarkdownActionFailure(
          { operation: "open-file-in-editor", target: targetPath },
          result.cause,
        );
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open file",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      } catch (cause) {
        reportMarkdownActionFailure(
          { operation: "open-file-in-editor", target: targetPath },
          cause,
        );
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open file",
            description: cause instanceof Error ? cause.message : "An error occurred.",
          }),
        );
      }
    })();
  }, [onOpen, targetPath]);

  const handleOpenInFilePreview = useCallback(() => {
    if (!threadRef || !workspaceRelativePath) {
      handleOpenInEditor();
      return;
    }
    useRightPanelStore.getState().openFile(threadRef, workspaceRelativePath, line);
  }, [handleOpenInEditor, line, threadRef, workspaceRelativePath]);

  const handleOpenInBrowser = useCallback(() => {
    if (!onOpenInBrowser) {
      return;
    }
    void (async () => {
      try {
        const result = await onOpenInBrowser();
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
          return;
        }
        reportMarkdownActionFailure(
          { operation: "open-file-in-browser", target: targetPath },
          result.cause,
        );
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open file in browser",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      } catch (cause) {
        reportMarkdownActionFailure(
          { operation: "open-file-in-browser", target: targetPath },
          cause,
        );
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open file in browser",
            description: cause instanceof Error ? cause.message : "An error occurred.",
          }),
        );
      }
    })();
  }, [onOpenInBrowser, targetPath]);

  const handleCopy = useCallback(
    (value: string, title: string) => {
      if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Failed to copy ${title.toLowerCase()}`,
            description: "Clipboard API unavailable.",
          }),
        );
        return;
      }

      void navigator.clipboard.writeText(value).then(
        () => {
          toastManager.add({
            type: "success",
            title: `${title} copied`,
            description: value,
          });
        },
        (error) => {
          reportMarkdownActionFailure(
            { operation: "copy-file-path", target: targetPath, copyTarget: title },
            error,
          );
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: `Failed to copy ${title.toLowerCase()}`,
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        },
      );
    },
    [targetPath],
  );

  const handleContextMenu = useCallback(
    async (event: ReactMouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      try {
        const clicked = await api.contextMenu.show(
          [
            { id: "open", label: "Open in editor" },
            ...(onOpenInBrowser
              ? ([{ id: "open-in-browser", label: "Open in integrated browser" }] as const)
              : []),
            { id: "copy-relative", label: "Copy relative path" },
            { id: "copy-full", label: "Copy full path" },
          ] as const,
          { x: event.clientX, y: event.clientY },
        );

        if (clicked === "open") {
          handleOpenInEditor();
          return;
        }
        if (clicked === "open-in-browser") {
          handleOpenInBrowser();
          return;
        }
        if (clicked === "copy-relative") {
          handleCopy(displayPath, "Relative path");
          return;
        }
        if (clicked === "copy-full") {
          handleCopy(targetPath, "Full path");
        }
      } catch (cause) {
        reportMarkdownActionFailure(
          { operation: "show-file-context-menu", target: targetPath },
          cause,
        );
      }
    },
    [displayPath, handleCopy, handleOpenInBrowser, handleOpenInEditor, onOpenInBrowser, targetPath],
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={href}
            className={cn(CHAT_FILE_TAG_CHIP_CLASS_NAME, MARKDOWN_FILE_LINK_CLASS_NAME, className)}
            data-markdown-copy={copyMarkdown}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (onOpenInBrowser) {
                handleOpenInBrowser();
                return;
              }
              handleOpenInFilePreview();
            }}
            onContextMenu={handleContextMenu}
          >
            <FileTagChipContent path={iconPath} label={label} theme={theme} selectable />
          </a>
        }
      />
      <TooltipPopup
        side="top"
        className="max-w-[min(40rem,calc(100vw-2rem))] font-mono text-[11px] leading-tight"
      >
        <div className="markdown-file-link-tooltip-scroll overflow-x-auto whitespace-nowrap">
          {displayPath}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}, areMarkdownFileLinkPropsEqual);

function areMarkdownFileLinkPropsEqual(
  previous: Readonly<MarkdownFileLinkProps>,
  next: Readonly<MarkdownFileLinkProps>,
): boolean {
  return (
    previous.href === next.href &&
    previous.targetPath === next.targetPath &&
    previous.iconPath === next.iconPath &&
    previous.displayPath === next.displayPath &&
    previous.workspaceRelativePath === next.workspaceRelativePath &&
    previous.line === next.line &&
    previous.label === next.label &&
    previous.copyMarkdown === next.copyMarkdown &&
    previous.theme === next.theme &&
    previous.threadRef === next.threadRef &&
    previous.onOpen === next.onOpen &&
    previous.onOpenInBrowser === next.onOpenInBrowser &&
    previous.className === next.className
  );
}

function ChatMarkdown({
  text,
  cwd,
  threadRef,
  onTaskListChange,
  isStreaming = false,
  skills = EMPTY_MARKDOWN_SKILLS,
  className,
  lineBreaks = false,
}: ChatMarkdownProps) {
  const { resolvedTheme } = useTheme();
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });
  const preparedConnection = usePreparedConnection(threadRef?.environmentId ?? null);
  const environmentId = useActiveEnvironmentId();
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const openInPreferredEditor = useOpenInPreferredEditor(
    environmentId,
    serverConfig?.availableEditors ?? [],
  );
  const markdownFileLinkMetaByHref = useMemo(() => {
    const metaByHref = new Map<
      string,
      NonNullable<ReturnType<typeof resolveMarkdownFileLinkMeta>>
    >();
    for (const href of extractMarkdownLinkHrefs(text)) {
      const normalizedHref = normalizeMarkdownLinkHrefKey(href);
      if (metaByHref.has(normalizedHref)) continue;
      const meta = resolveMarkdownFileLinkMeta(normalizedHref, cwd);
      if (meta) {
        metaByHref.set(normalizedHref, meta);
      }
    }
    return metaByHref;
  }, [cwd, text]);
  const inlineCodeFileLinkMetaByText = useMemo(() => {
    const metaByText = new Map<string, MarkdownFileLinkMeta>();
    for (const span of extractInlineCodeSpans(text)) {
      if (metaByText.has(span)) continue;
      const meta = resolveInlineCodeFileLinkMeta(span, cwd);
      if (meta) {
        metaByText.set(span, meta);
      }
    }
    return metaByText;
  }, [cwd, text]);
  const fileLinkParentSuffixByPath = useMemo(() => {
    const filePaths = [
      ...[...markdownFileLinkMetaByHref.values()].map((meta) => meta.filePath),
      ...[...inlineCodeFileLinkMetaByText.values()].map((meta) => meta.filePath),
    ];
    return buildFileLinkParentSuffixByPath(filePaths);
  }, [inlineCodeFileLinkMetaByText, markdownFileLinkMetaByHref]);
  const markdownUrlTransform = useCallback((href: string, key: string) => {
    const screenshot = key === "src" ? resolveMarkdownBrowserScreenshotFileName(href) : null;
    if (screenshot) return `/browser-artifacts/${screenshot}`;
    return rewriteMarkdownFileUriHref(href) ?? defaultUrlTransform(href);
  }, []);
  // Re-emit highlighted content as markdown so copying out of the rendered
  // view keeps links, emphasis, lists, and code fences intact.
  const handleCopy = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !event.clipboardData) return;
    const payload = chatMarkdownClipboardPayload(selection);
    if (!payload) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", payload.text);
    event.clipboardData.setData("text/html", payload.html);
  }, []);
  const openExternalLinkInPreview = useCallback(
    (url: string) => {
      if (!threadRef) {
        return Promise.resolve(
          AsyncResult.failure<void, BrowserPreviewUnavailableError>(
            Cause.fail(
              new BrowserPreviewUnavailableError({
                message: "Thread context is unavailable.",
              }),
            ),
          ),
        );
      }
      return openUrlInPreview({ threadRef, url, openPreview });
    },
    [openPreview, threadRef],
  );
  const openMarkdownFileInPreview = useCallback(
    (path: string) => {
      if (!threadRef || preparedConnection._tag === "None") {
        return Promise.resolve(
          AsyncResult.failure<void, BrowserPreviewUnavailableError>(
            Cause.fail(
              new BrowserPreviewUnavailableError({
                message: "Environment is not connected.",
              }),
            ),
          ),
        );
      }
      return openFileInPreview({
        threadRef,
        filePath: path,
        httpBaseUrl: preparedConnection.value.httpBaseUrl,
        createAssetUrl,
        openPreview,
      });
    },
    [createAssetUrl, openPreview, preparedConnection, threadRef],
  );
  /* eslint-disable react/no-unstable-nested-components -- ReactMarkdown requires component
   * renderers that close over this message's metadata. useMemo keeps them stable until that
   * metadata changes. */
  const markdownComponents = useMemo<Components>(() => {
    const fileLinkChip = (
      fileLinkMeta: MarkdownFileLinkMeta,
      copyMarkdown: string,
      className?: string,
    ) => {
      const parentSuffix = fileLinkParentSuffixByPath.get(fileLinkMeta.filePath);
      const labelParts = [fileLinkMeta.basename];
      if (typeof parentSuffix === "string" && parentSuffix.length > 0) {
        labelParts.push(parentSuffix);
      }
      if (fileLinkMeta.line) {
        labelParts.push(
          `L${fileLinkMeta.line}${fileLinkMeta.column ? `:C${fileLinkMeta.column}` : ""}`,
        );
      }

      return (
        <MarkdownFileLink
          href={fileLinkMeta.targetPath}
          targetPath={fileLinkMeta.targetPath}
          iconPath={fileLinkMeta.filePath}
          displayPath={fileLinkMeta.displayPath}
          workspaceRelativePath={fileLinkMeta.workspaceRelativePath}
          line={fileLinkMeta.line}
          label={labelParts.join(" · ")}
          copyMarkdown={copyMarkdown}
          theme={resolvedTheme}
          threadRef={threadRef}
          onOpen={openInPreferredEditor}
          onOpenInBrowser={
            threadRef &&
            isPreviewSupportedInRuntime() &&
            isBrowserPreviewFile(fileLinkMeta.filePath)
              ? () => openMarkdownFileInPreview(fileLinkMeta.filePath)
              : undefined
          }
          className={className}
        />
      );
    };

    return {
      img({ node: _node, src, ...props }) {
        const fileName = resolveMarkdownBrowserScreenshotFileName(
          typeof src === "string" ? src : undefined,
        );
        const screenshotEnvironmentId = threadRef?.environmentId ?? environmentId;
        return fileName && screenshotEnvironmentId ? (
          <MarkdownBrowserScreenshot
            {...props}
            environmentId={screenshotEnvironmentId}
            fileName={fileName}
          />
        ) : (
          <img {...props} src={src} />
        );
      },
      p({ node: _node, children, ...props }) {
        return <p {...props}>{renderSkillInlineMarkdownChildren(children, skills)}</p>;
      },
      li({ node, children, ...props }) {
        const listItemStart = node?.position?.start.offset;
        const markerOffset =
          typeof listItemStart === "number" ? findTaskListMarkerOffset(text, listItemStart) : null;
        return (
          <li {...props} data-task-marker-offset={markerOffset ?? undefined}>
            {renderSkillInlineMarkdownChildren(children, skills)}
          </li>
        );
      },
      input({ node: _node, type, checked, disabled: _disabled, ...props }) {
        if (type !== "checkbox" || !onTaskListChange) {
          return (
            <input
              {...props}
              type={type}
              checked={checked}
              disabled={_disabled}
              readOnly={type === "checkbox"}
            />
          );
        }
        return (
          <input
            {...props}
            type="checkbox"
            name="markdown-task"
            aria-label="Toggle task"
            checked={checked}
            onChange={(event) => {
              const markerOffset = Number(
                event.currentTarget.closest("li")?.dataset.taskMarkerOffset,
              );
              if (!Number.isSafeInteger(markerOffset)) return;
              onTaskListChange({ markerOffset, checked: event.currentTarget.checked });
            }}
          />
        );
      },
      a({ node, href, children, ...props }) {
        const normalizedHref = href ? normalizeMarkdownLinkHrefKey(href) : "";
        const fileLinkMeta = normalizedHref ? markdownFileLinkMetaByHref.get(normalizedHref) : null;
        if (!fileLinkMeta) {
          const faviconHost = resolveExternalWebLinkHost(href);
          const isSameDocumentLink = href?.startsWith("#") ?? false;
          const onClick = props.onClick;
          const canOpenInPreview = Boolean(threadRef) && isPreviewSupportedInRuntime();
          const link = (
            <a
              {...props}
              href={href}
              target={isSameDocumentLink ? undefined : "_blank"}
              rel={isSameDocumentLink ? undefined : "noopener noreferrer"}
              onClick={(event) => {
                onClick?.(event);
                if (isSameDocumentLink && href) {
                  handleMarkdownFragmentClick(event, href);
                }
              }}
              onContextMenu={(event) => {
                if (!canOpenInPreview || !href || !faviconHost) return;
                event.preventDefault();
                event.stopPropagation();
                const api = readLocalApi();
                if (!api) return;
                void showExternalLinkContextMenu({
                  href,
                  position: { x: event.clientX, y: event.clientY },
                  showContextMenu: (items, position) => api.contextMenu.show(items, position),
                  openInPreview: async (target) => {
                    const result = await openExternalLinkInPreview(target);
                    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                      reportMarkdownActionFailure(
                        { operation: "open-link-in-preview", target },
                        result.cause,
                      );
                    }
                  },
                  openExternal: (target) => api.shell.openExternal(target),
                  copyLink: (target) => writeTextToClipboard(target, "link"),
                  reportFailure: (operation, cause) => {
                    reportMarkdownActionFailure({ operation, target: href }, cause);
                  },
                });
              }}
            >
              {faviconHost ? (
                <MarkdownExternalLinkContent plainText={plainHastText(node)}>
                  {children}
                </MarkdownExternalLinkContent>
              ) : (
                children
              )}
            </a>
          );
          if (!faviconHost || !href) {
            return link;
          }
          return (
            <Tooltip>
              <TooltipTrigger render={link} />
              <TooltipPopup
                side="top"
                className="max-w-[min(36rem,calc(100vw-2rem))] whitespace-normal leading-tight wrap-anywhere"
              >
                {href}
              </TooltipPopup>
            </Tooltip>
          );
        }

        return fileLinkChip(
          fileLinkMeta,
          `[${fileLinkMeta.basename}](${normalizedHref})`,
          props.className,
        );
      },
      code({ node, children, className, ...props }) {
        if (node?.properties?.dataInlineCode != null) {
          const codeText = nodeToPlainText(children);
          const fileLinkMeta =
            inlineCodeFileLinkMetaByText.get(codeText.trim()) ??
            resolveInlineCodeFileLinkMeta(codeText, cwd);
          if (fileLinkMeta) {
            return fileLinkChip(fileLinkMeta, `\`${codeText}\``);
          }
        }
        return (
          <code {...props} className={className}>
            {children}
          </code>
        );
      },
      table({ node: _node, ...props }) {
        return <MarkdownTable {...props} />;
      },
      details({ node: _node, children, open: detailsOpen }) {
        return <MarkdownDetails open={detailsOpen}>{children}</MarkdownDetails>;
      },
      pre(props) {
        return <MarkdownPre {...props} isStreaming={isStreaming} />;
      },
    };
  }, [
    cwd,
    environmentId,
    fileLinkParentSuffixByPath,
    inlineCodeFileLinkMetaByText,
    isStreaming,
    markdownFileLinkMetaByHref,
    onTaskListChange,
    openInPreferredEditor,
    openExternalLinkInPreview,
    openMarkdownFileInPreview,
    resolvedTheme,
    skills,
    text,
    threadRef,
  ]);
  /* eslint-enable react/no-unstable-nested-components */

  return (
    <div
      className={cn(
        "chat-markdown w-full min-w-0 text-sm leading-relaxed text-foreground/80",
        className,
      )}
      onCopy={handleCopy}
    >
      <ReactMarkdown
        remarkPlugins={
          lineBreaks ? CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS : CHAT_MARKDOWN_REMARK_PLUGINS
        }
        rehypePlugins={CHAT_MARKDOWN_REHYPE_PLUGINS}
        components={markdownComponents}
        urlTransform={markdownUrlTransform}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ChatMarkdown);
