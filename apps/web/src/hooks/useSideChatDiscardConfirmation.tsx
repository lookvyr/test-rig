import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  ensureClientSettingsHydrated,
  getClientSettings,
  useUpdateClientSettings,
} from "./useSettings";

export function useSideChatDiscardConfirmation(threadKey: string) {
  const updateSettings = useUpdateClientSettings();
  const generation = useRef(0);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const settle = useCallback((confirmed: boolean) => {
    pending.current?.(confirmed);
    pending.current = null;
    setOpen(false);
  }, []);

  useEffect(
    () => () => {
      generation.current += 1;
      settle(false);
    },
    [threadKey, settle],
  );

  const confirm = useCallback(async () => {
    const requestGeneration = generation.current;
    await ensureClientSettingsHydrated();
    if (requestGeneration !== generation.current) return false;
    if (!getClientSettings().confirmSideChatDiscard) return true;
    if (pending.current) return false;
    setDontAskAgain(false);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
    });
  }, []);

  const dialog = (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard side chat?</AlertDialogTitle>
          <AlertDialogDescription>
            Running work, including all subagents, will stop. This temporary conversation, its
            subagents, and its draft will be removed. File changes remain in the checkout.
          </AlertDialogDescription>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <Checkbox checked={dontAskAgain} onCheckedChange={setDontAskAgain} />
            Don’t ask again
          </label>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => settle(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (dontAskAgain) updateSettings({ confirmSideChatDiscard: false });
              settle(true);
            }}
          >
            Discard side chat
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
  return { confirm, dialog };
}
