import { createContext, useContext } from "react";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { Options } from "react-markdown";
import ChatMarkdown from "../ChatMarkdown";
import { cn } from "~/lib/utils";

export const PullRequestMarkdownContext = createContext<{
  remarkPlugins: NonNullable<Options["remarkPlugins"]>;
  lineBreaks: boolean;
  threadRef: ScopedThreadRef | null;
  repository: string | null;
} | null>(null);

export function PullRequestMarkdown({
  text,
  cwd,
  threadRef,
  lineBreaks,
  className,
  onTaskListChange,
}: {
  text: string;
  cwd: string;
  environmentId: EnvironmentId;
  threadRef?: ScopedThreadRef | null;
  lineBreaks?: boolean;
  className?: string;
  onTaskListChange?: ((input: { markerOffset: number; checked: boolean }) => void) | undefined;
}) {
  const context = useContext(PullRequestMarkdownContext);
  return (
    <div className={cn("min-w-0 text-sm", className)}>
      <ChatMarkdown
        text={text}
        cwd={cwd}
        threadRef={threadRef ?? context?.threadRef ?? undefined}
        {...(context ? { extraRemarkPlugins: context.remarkPlugins } : {})}
        lineBreaks={lineBreaks ?? context?.lineBreaks ?? false}
        parseRawHtml
        onTaskListChange={onTaskListChange}
      />
    </div>
  );
}
