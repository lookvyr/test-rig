import { cn } from "~/lib/utils";
import {
  type TerminalContextDraft,
  formatTerminalContextLabel,
  isTerminalContextExpired,
} from "~/lib/terminalContext";
import { TerminalContextInlineChip } from "./TerminalContextInlineChip";

interface ComposerPendingTerminalContextsProps {
  contexts: ReadonlyArray<TerminalContextDraft>;
  className?: string;
}

interface ComposerPendingTerminalContextChipProps {
  context: TerminalContextDraft;
}

export function ComposerPendingTerminalContextChip({
  context,
}: ComposerPendingTerminalContextChipProps) {
  const label = formatTerminalContextLabel(context);
  const expired = isTerminalContextExpired(context);
  return (
    <TerminalContextInlineChip
      label={label}
      terminalLabel={context.terminalLabel}
      lineStart={context.lineStart}
      lineEnd={context.lineEnd}
      text={context.text}
      detailsMode="popover"
      expired={expired}
    />
  );
}

export function ComposerPendingTerminalContexts(props: ComposerPendingTerminalContextsProps) {
  const { contexts, className } = props;

  if (contexts.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {contexts.map((context) => (
        <ComposerPendingTerminalContextChip key={context.id} context={context} />
      ))}
    </div>
  );
}
