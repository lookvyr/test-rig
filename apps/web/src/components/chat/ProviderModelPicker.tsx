import {
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { buttonVariants } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { ModelPickerContent } from "./ModelPickerContent";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { ModelEsque, getCompactModelName, getDisplayModelName } from "./providerIconUtils";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { ComposerControl, ComposerControlChevron } from "./ComposerControl";
import { DockedPickerContext } from "./ComposerModelEffort";

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  /**
   * The instance currently selected in the composer. Drives the trigger
   * icon, label and the default-highlighted combobox row.
   */
  activeInstanceId: ProviderInstanceId;
  model: string;
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null;
  /** Instance entries rendered in the sidebar + used to resolve display name. */
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings?: ResolvedKeybindingsConfig;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  activeProviderIconClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  terminalOpen?: boolean;
  open?: boolean;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  triggerAriaLabel?: string;
  onOpenChange?: (open: boolean) => void;
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
  /** Shown after the model name inside the same trigger, such as the effort level. */
  triggerSuffix?: ReactNode;
  /** Names every trait for the tooltip and screen readers. */
  triggerDetail?: string | null;
  popupAlign?: "start" | "end";
  /**
   * Docks an effort column beside the list and a footer under both. The popup then stays open
   * after a model pick, moving focus to that model's levels, until Escape or an outside press.
   */
  effortColumn?: ReactNode;
  footer?: ReactNode;
}) {
  const [uncontrolledIsMenuOpen, setUncontrolledIsMenuOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const docked = props.effortColumn !== undefined;
  const isMenuOpen = props.open ?? uncontrolledIsMenuOpen;

  // Resolve the active instance entry by exact routing key. The composer
  // resolves fallbacks before rendering this component; if the selected
  // instance disappears, do not infer a replacement from its driver kind.
  const activeEntry = useMemo(() => {
    return (
      props.instanceEntries.find((entry) => entry.instanceId === props.activeInstanceId) ?? null
    );
  }, [props.activeInstanceId, props.instanceEntries]);

  const activeInstanceId = props.activeInstanceId;
  const selectedInstanceOptions = props.modelOptionsByInstance.get(activeInstanceId) ?? [];
  // If the current slug belongs to a different instance (for example after
  // a provider switch or disable), prefer the active instance's first
  // option so the trigger icon and label stay in sync instead of showing
  // a stale foreign slug.
  const selectedModel =
    selectedInstanceOptions.find((option) => option.slug === props.model) ??
    selectedInstanceOptions[0];
  const unavailable = !activeEntry?.enabled || !activeEntry.isAvailable;
  const triggerTitle = unavailable
    ? "Provider unavailable"
    : selectedModel
      ? getCompactModelName(selectedModel)
      : props.model;
  const triggerLabel = unavailable
    ? `${activeEntry?.displayName ?? activeInstanceId} is unavailable`
    : selectedModel
      ? getDisplayModelName(selectedModel)
      : props.model;
  const duplicateDriverCount = props.instanceEntries.filter(
    (entry) => activeEntry !== null && entry.driverKind === activeEntry.driverKind,
  ).length;
  const showInstanceBadge = Boolean(activeEntry?.accentColor) || duplicateDriverCount > 1;

  const setIsMenuOpen = (open: boolean) => {
    props.onOpenChange?.(open);
    if (props.open === undefined) {
      setUncontrolledIsMenuOpen(open);
    }
  };

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const { documentElement, body } = document;
    const previousDocumentOverscrollBehavior = documentElement.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;

    documentElement.style.overscrollBehavior = "contain";
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    const shouldAllowOverlayScroll = (target: EventTarget | null) => {
      return (
        target instanceof Element &&
        target.closest("[data-model-picker-content], [data-model-picker-effort]")
      );
    };
    const preventBackgroundWheel = (event: WheelEvent) => {
      if (shouldAllowOverlayScroll(event.target)) {
        return;
      }
      event.preventDefault();
    };
    const preventBackgroundTouchMove = (event: TouchEvent) => {
      if (shouldAllowOverlayScroll(event.target)) {
        return;
      }
      event.preventDefault();
    };

    document.addEventListener("wheel", preventBackgroundWheel, { capture: true, passive: false });
    document.addEventListener("touchmove", preventBackgroundTouchMove, {
      capture: true,
      passive: false,
    });

    return () => {
      document.removeEventListener("wheel", preventBackgroundWheel, { capture: true });
      document.removeEventListener("touchmove", preventBackgroundTouchMove, { capture: true });
      documentElement.style.overscrollBehavior = previousDocumentOverscrollBehavior;
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
    };
  }, [isMenuOpen]);

  /** Focuses the selected level in the effort column, else its first row. */
  const focusEffort = () => {
    const column = popupRef.current?.querySelector("[data-model-picker-effort]");
    const row =
      column?.querySelector<HTMLElement>('[data-effort-row][aria-checked="true"]:not(:disabled)') ??
      column?.querySelector<HTMLElement>("[data-effort-row]:not(:disabled)");
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  };

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return;
    props.onInstanceModelChange(instanceId, model);
    if (!docked) {
      setIsMenuOpen(false);
      return;
    }
    // The column renders the new model's levels on commit.
    window.requestAnimationFrame(focusEffort);
  };

  const picker = (
    <ModelPickerContent
      activeInstanceId={activeInstanceId}
      model={props.model}
      lockedProvider={props.lockedProvider}
      lockedContinuationGroupKey={props.lockedContinuationGroupKey ?? null}
      instanceEntries={props.instanceEntries}
      {...(props.keybindings ? { keybindings: props.keybindings } : {})}
      modelOptionsByInstance={props.modelOptionsByInstance}
      terminalOpen={props.terminalOpen ?? false}
      onRequestClose={() => setIsMenuOpen(false)}
      {...(props.getModelDisabledReason
        ? { getModelDisabledReason: props.getModelDisabledReason }
        : {})}
      onInstanceModelChange={handleInstanceModelChange}
      {...(docked ? { docked, onFocusEffort: focusEffort } : {})}
    />
  );

  return (
    <Popover
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <PopoverTrigger
        render={
          <ComposerControl
            aria-label={props.triggerAriaLabel}
            variant={props.triggerVariant ?? "ghost"}
            data-chat-provider-model-picker="true"
            className={cn(
              "min-w-0 justify-between whitespace-nowrap",
              props.compact ? "max-w-42 shrink-0" : "max-w-48 shrink sm:max-w-56",
              props.triggerClassName,
            )}
            disabled={props.disabled}
          />
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {activeEntry ? (
            <ProviderInstanceIcon
              driverKind={activeEntry.driverKind}
              displayName={activeEntry.displayName}
              accentColor={activeEntry.accentColor}
              showBadge={showInstanceBadge}
              className="size-4"
              iconClassName={cn("size-4", props.activeProviderIconClassName)}
              indicatorBackground="var(--input)"
              badgeClassName={cn(
                "right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3",
                "px-0.5 text-[7px]",
              )}
            />
          ) : null}
          <Tooltip>
            <TooltipTrigger render={<span className="min-w-0 flex-1 overflow-hidden truncate" />}>
              {triggerTitle}
            </TooltipTrigger>
            <TooltipPopup side="top">
              {[triggerLabel, props.triggerDetail].filter(Boolean).join(" · ")}
            </TooltipPopup>
          </Tooltip>
          {props.triggerSuffix}
        </span>
        <span aria-hidden="true" className="flex items-center">
          <ComposerControlChevron />
        </span>
      </PopoverTrigger>
      <PopoverPopup
        ref={popupRef}
        align={props.popupAlign ?? "start"}
        {...(docked ? { side: "top" as const } : {})}
        className="border-0 bg-transparent p-0 shadow-none before:hidden [-webkit-backdrop-filter:none]! [--viewport-inline-padding:0] [backdrop-filter:none]!"
        viewportClassName="rounded-lg !overflow-hidden p-0"
      >
        {docked ? (
          <DockedPickerContext value={{ modelLabel: triggerTitle }}>
            <div className="dropdown-glass model-picker-surface flex max-h-(--available-height) flex-col overflow-hidden rounded-lg text-popover-foreground [clip-path:inset(0_round_var(--radius-lg))]">
              {/* One fixed height, so a model with more options never resizes the popup. */}
              <div className="flex h-86.5 min-h-0 max-sm:h-auto max-sm:flex-col">
                {picker}
                <div
                  data-model-picker-effort
                  className="flex min-h-0 w-48 flex-col border-l border-border/70 bg-muted/40 sm:shrink-0 max-sm:h-64 max-sm:w-full max-sm:border-t max-sm:border-l-0"
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" || event.altKey || event.ctrlKey || event.metaKey)
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    popupRef.current
                      ?.querySelector<HTMLInputElement>("[data-model-picker-content] input")
                      ?.focus();
                  }}
                >
                  {props.effortColumn}
                </div>
              </div>
              {props.footer}
            </div>
          </DockedPickerContext>
        ) : (
          picker
        )}
      </PopoverPopup>
    </Popover>
  );
});
