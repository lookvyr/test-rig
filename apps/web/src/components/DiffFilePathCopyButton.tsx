import { CheckIcon, CopyIcon } from "lucide-react";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function DiffFilePathCopyButton({ filePath }: { filePath: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "file path",
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy file path",
        description: error.message,
      });
    },
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            className="size-5 text-muted-foreground"
            variant="ghost"
            aria-label="Copy file path"
            onClick={(event) => {
              event.stopPropagation();
              copyToClipboard(filePath, undefined);
            }}
          />
        }
      >
        {isCopied ? <CheckIcon className="size-3 text-success" /> : <CopyIcon className="size-3" />}
      </TooltipTrigger>
      <TooltipPopup>{isCopied ? "Copied" : "Copy path"}</TooltipPopup>
    </Tooltip>
  );
}
