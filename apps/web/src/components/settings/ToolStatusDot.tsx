import type { McpOAuthStatus, McpRuntimeStatus, McpServerConfig } from "@t3tools/contracts";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type ToolTone = "ok" | "warn" | "error" | "idle" | "off";

export interface McpServerState {
  readonly tone: ToolTone;
  readonly label: string;
  readonly detail: string | null;
  readonly needsSignIn: boolean;
}

/** One summary for a server across its live sessions and its shared sign-in. */
export function mcpServerState(
  config: McpServerConfig,
  statuses: readonly McpRuntimeStatus[],
  oauth: McpOAuthStatus | null,
  available: boolean,
): McpServerState {
  const http = config.transport.type === "http";
  if (!config.enabled) return { tone: "off", label: "Off", detail: null, needsSignIn: false };
  if (http && oauth?.state === "expired")
    return { tone: "warn", label: "Sign-in expired", detail: null, needsSignIn: true };
  if (statuses.some((status) => status.state === "needs-auth"))
    return { tone: "warn", label: "Sign in needed", detail: null, needsSignIn: http };
  const failed = statuses.find((status) => status.state === "failed");
  if (failed)
    return { tone: "error", label: "Connection failed", detail: failed.error, needsSignIn: false };
  const connected = statuses.filter((status) => status.state === "connected");
  if (connected.length > 0) {
    const tools = Math.max(...connected.map((status) => status.toolCount ?? 0));
    return {
      tone: "ok",
      label: "Connected",
      detail: tools > 0 ? `${tools} ${tools === 1 ? "tool" : "tools"}` : null,
      needsSignIn: false,
    };
  }
  if (statuses.some((status) => status.state === "connecting"))
    return { tone: "warn", label: "Connecting", detail: null, needsSignIn: false };
  if (http && oauth?.state === "signed-in")
    return { tone: "ok", label: "Signed in", detail: null, needsSignIn: false };
  return {
    tone: "idle",
    label: available ? "Not running" : "Status unavailable",
    detail: null,
    needsSignIn: false,
  };
}

const TONE_CLASS: Record<ToolTone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  error: "bg-destructive",
  idle: "bg-muted-foreground/40",
  off: "bg-muted-foreground/25",
};

/** A status dot; hovering it names the state. */
export function ToolStatusDot({ state }: { state: McpServerState }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-label={state.label}
            className="relative z-10 -m-1.5 inline-flex size-5 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <span className={cn("size-1.5 rounded-full", TONE_CLASS[state.tone])} />
      </TooltipTrigger>
      <TooltipPopup side="top" align="start">
        <span className="block">{state.label}</span>
        {state.detail ? (
          <span className="block max-w-72 truncate font-mono text-[11px] text-muted-foreground">
            {state.detail}
          </span>
        ) : null}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Skills have no connection; a hollow square marks the row. */
export function SkillGlyph() {
  return (
    <span className="-m-1.5 inline-flex size-5 shrink-0 items-center justify-center" aria-hidden>
      <span className="size-1.5 rounded-[2px] border border-muted-foreground" />
    </span>
  );
}
