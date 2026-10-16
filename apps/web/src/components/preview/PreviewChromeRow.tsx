import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ChevronDown,
  ExternalLink,
  MousePointerClick,
  PictureInPicture2,
  RotateCw,
  Square,
  Video,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

export type PreviewCaptureState = "idle" | "capturing" | "starting" | "recording" | "stopping";

interface Props {
  url: string;
  loading: boolean;
  loadProgress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  refreshDisabled: boolean;
  inputDisabled?: boolean | undefined;
  /** Bumping this value re-focuses and selects the URL input. */
  focusUrlNonce?: number | undefined;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  /** Return false to keep invalid input focused for correction. */
  onSubmit: (input: string) => boolean;
  /** When provided, renders an "Open in browser" affordance to the right. */
  onOpenInBrowser?: (() => void) | undefined;
  onCapture?: ((record: boolean) => void) | undefined;
  captureDisabled?: boolean | undefined;
  captureState?: PreviewCaptureState | undefined;
  onPictureInPicture?: (() => void) | undefined;
  pictureInPicture?: boolean | undefined;
  pictureInPictureDisabled?: boolean | undefined;
  /**
   * When provided, renders an annotation-mode toggle button to the right of
   * the URL input. Pressed while annotation mode is active (button shows in `pressed`
   * state). Disabled in `pickDisabled` mode.
   */
  onPickElement?: (() => void) | undefined;
  pickActive?: boolean | undefined;
  pickDisabled?: boolean | undefined;
  /** Optional reason string surfaced in the disabled tooltip. */
  pickDisabledReason?: string | undefined;
  /**
   * Trailing slot rendered after the URL input. Used by the preview view
   * to mount the three-dot menu (hard reload, devtools, zoom, clear data).
   */
  trailingActions?: ReactNode;
}

const NOOP = () => {};
const CAPTURE_LABELS = {
  capturing: { action: "Saving screenshot", text: "Saving…" },
  starting: { action: "Starting recording", text: "Starting…" },
  recording: { action: "Stop recording", text: "Stop" },
  stopping: { action: "Saving recording", text: "Saving…" },
} as const;

export function PreviewChromeRow({
  url,
  loading,
  loadProgress,
  canGoBack,
  canGoForward,
  refreshDisabled,
  inputDisabled,
  focusUrlNonce,
  onBack,
  onForward,
  onRefresh,
  onSubmit,
  onOpenInBrowser,
  onCapture,
  captureDisabled,
  captureState = "idle",
  onPictureInPicture,
  pictureInPicture,
  pictureInPictureDisabled,
  onPickElement,
  pickActive,
  pickDisabled,
  pickDisabledReason,
  trailingActions,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(url);
  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    if (focusUrlNonce == null) return;
    const node = inputRef.current;
    if (!node) return;
    node.focus();
  }, [focusUrlNonce]);

  const submit = (event?: FormEvent | KeyboardEvent) => {
    event?.preventDefault();
    const next = draft.trim();
    if (next.length === 0) return;
    if (onSubmit(next)) inputRef.current?.blur();
  };

  return (
    <div className="relative">
      <form onSubmit={submit} className="surface-subheader gap-1 px-2" data-surface-subheader>
        <div className="flex items-center gap-0.5" role="group" aria-label="Navigation">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={canGoBack ? onBack : NOOP}
                  disabled={!canGoBack}
                  aria-label="Back"
                  type="button"
                />
              }
            >
              <ArrowLeft />
            </TooltipTrigger>
            <TooltipPopup>Back</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={canGoForward ? onForward : NOOP}
                  disabled={!canGoForward}
                  aria-label="Forward"
                  type="button"
                />
              }
            >
              <ArrowRight />
            </TooltipTrigger>
            <TooltipPopup>Forward</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={refreshDisabled ? NOOP : onRefresh}
                  disabled={refreshDisabled}
                  aria-label={loading ? "Stop" : "Refresh"}
                  type="button"
                />
              }
            >
              <RotateCw className={cn(loading && "animate-spin")} />
            </TooltipTrigger>
            <TooltipPopup>{loading ? "Loading…" : "Refresh"}</TooltipPopup>
          </Tooltip>
        </div>

        <InputGroup variant="ghost" className="group/address h-7 flex-1 rounded-md">
          <Tooltip>
            <TooltipTrigger
              render={
                <InputGroupInput
                  ref={inputRef}
                  value={inputFocused ? draft : url}
                  className={cn(
                    onOpenInBrowser &&
                      !inputFocused &&
                      "group-hover/address:pe-7 transition-[padding]",
                  )}
                  onChange={(event) => setDraft(event.target.value)}
                  onFocus={() => {
                    setDraft(url);
                    setInputFocused(true);
                    queueMicrotask(() => inputRef.current?.select());
                  }}
                  onBlur={() => {
                    setInputFocused(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submit(event);
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setDraft(url);
                      inputRef.current?.blur();
                    }
                  }}
                  aria-label="Search Google or enter URL"
                  placeholder="Search Google or enter URL"
                  spellCheck={false}
                  disabled={inputDisabled}
                  data-preview-url-input
                  size="sm"
                />
              }
            />
          </Tooltip>
          {onOpenInBrowser && !inputFocused ? (
            <InputGroupAddon
              align="inline-end"
              className="pointer-events-none absolute inset-y-0 right-0 opacity-0 transition-opacity group-hover/address:pointer-events-auto group-hover/address:opacity-100"
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={onOpenInBrowser}
                      aria-label="Open in system browser"
                      type="button"
                    />
                  }
                >
                  <ExternalLink />
                </TooltipTrigger>
                <TooltipPopup>Open in system browser</TooltipPopup>
              </Tooltip>
            </InputGroupAddon>
          ) : null}
        </InputGroup>

        {onPickElement ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={pickActive ? "secondary" : "ghost"}
                  size="icon-xs"
                  onClick={onPickElement}
                  disabled={pickDisabled}
                  aria-label={pickActive ? "Cancel annotation" : "Annotate preview"}
                  aria-pressed={pickActive ? "true" : "false"}
                  type="button"
                />
              }
            >
              <MousePointerClick className={cn(pickActive && "text-primary")} />
            </TooltipTrigger>
            <TooltipPopup>
              {pickDisabled && pickDisabledReason
                ? pickDisabledReason
                : pickActive
                  ? "Cancel annotation (Esc)"
                  : "Annotate elements, regions, and drawings"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {onCapture ? (
          captureState === "idle" ? (
            <Menu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <MenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label="Capture screenshot or video"
                          type="button"
                          disabled={captureDisabled}
                        />
                      }
                    />
                  }
                >
                  <Camera />
                  <ChevronDown className="size-3" />
                </TooltipTrigger>
                <TooltipPopup>Capture screenshot or video</TooltipPopup>
              </Tooltip>
              <MenuPopup align="end" sideOffset={6}>
                <MenuItem onClick={() => onCapture(false)} disabled={captureDisabled}>
                  <Camera />
                  Screenshot
                </MenuItem>
                <MenuItem onClick={() => onCapture(true)} disabled={captureDisabled}>
                  <Video />
                  Record video
                </MenuItem>
              </MenuPopup>
            </Menu>
          ) : (
            <Button
              variant="secondary"
              size="xs"
              onClick={() => onCapture(true)}
              aria-label={CAPTURE_LABELS[captureState].action}
              type="button"
              disabled={captureState !== "recording"}
            >
              {captureState === "recording" ? (
                <Square className="fill-destructive text-destructive" />
              ) : captureState === "capturing" ? (
                <Camera />
              ) : (
                <Video />
              )}
              {CAPTURE_LABELS[captureState].text}
            </Button>
          )
        ) : null}
        {onPictureInPicture ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={pictureInPicture ? "secondary" : "ghost"}
                  size="icon-xs"
                  onClick={onPictureInPicture}
                  aria-label={
                    pictureInPicture ? "Close floating preview" : "Float preview over chat"
                  }
                  aria-pressed={pictureInPicture ? "true" : "false"}
                  type="button"
                  disabled={pictureInPictureDisabled}
                />
              }
            >
              <PictureInPicture2 className={cn(pictureInPicture && "text-primary")} />
            </TooltipTrigger>
            <TooltipPopup>
              {pictureInPicture ? "Close floating preview" : "Float preview over chat"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {trailingActions}
      </form>
      {loadProgress > 0 ? (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 z-10 h-0.5 rounded-r-full bg-primary transition-all duration-150 ease-out"
          style={{
            width: `${loadProgress}%`,
            boxShadow: "0 0 6px 1px var(--color-ring)",
          }}
        />
      ) : null}
    </div>
  );
}
