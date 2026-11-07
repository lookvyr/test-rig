import { MessageSquarePlusIcon } from "lucide-react";
import { Button } from "../ui/button";

export function PullRequestAddToChatButton({
  onClick,
  compact = false,
}: {
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <Button
      size={compact ? "icon-xs" : "xs"}
      variant="ghost"
      className="shrink-0"
      aria-label="Add to chat"
      title={compact ? "Add to chat" : undefined}
      onClick={onClick}
    >
      <MessageSquarePlusIcon className="size-3" />
      {!compact && "Add to chat"}
    </Button>
  );
}
