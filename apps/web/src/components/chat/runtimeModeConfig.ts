import type { RuntimeMode } from "@t3tools/contracts";
import { LockIcon, LockOpenIcon, type LucideIcon, PenLineIcon, SparklesIcon } from "lucide-react";

/** Names, descriptions, and icons for each permission mode, in the order every picker lists them. */
export const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: LucideIcon }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  auto: {
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
    icon: SparklesIcon,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
};

/**
 * The modes a new thread, setting or scheduled task can pick. The manual modes stay in
 * `runtimeModeConfig` only so a thread already running in one still shows its name.
 */
export const runtimeModeOptions: ReadonlyArray<RuntimeMode> = ["auto", "full-access"];

/** The pickable modes, plus the thread's current one when it is a retired manual mode. */
export function runtimeModeOptionsFor(current: RuntimeMode): ReadonlyArray<RuntimeMode> {
  return runtimeModeOptions.includes(current)
    ? runtimeModeOptions
    : [current, ...runtimeModeOptions];
}
