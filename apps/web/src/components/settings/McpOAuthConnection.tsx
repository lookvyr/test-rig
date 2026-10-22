import { useState } from "react";
import type {
  McpOAuthStatus,
  McpOAuthBeginResult,
  McpOAuthCompleteInput,
} from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ensureLocalApi } from "../../localApi";

export function McpOAuthConnection({
  status,
  error,
  pending,
  disabled,
  onBegin,
  onComplete,
  onSignOut,
  onRefresh,
}: {
  status: McpOAuthStatus | null;
  error: string | null;
  pending: boolean;
  disabled: boolean;
  onBegin: () => Promise<McpOAuthBeginResult>;
  onComplete: (input: McpOAuthCompleteInput) => Promise<void>;
  onSignOut: () => Promise<void>;
  onRefresh: () => void;
}) {
  const [flow, setFlow] = useState<{ flowId: string; authorizationUrl: string } | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError("");
    try {
      await action();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Sign-in could not be completed.");
    } finally {
      setBusy(false);
      onRefresh();
    }
  };
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Shared sign-in</p>
          <p role="status" className="text-xs text-muted-foreground">
            {pending
              ? "Checking sign-in…"
              : error || !status
                ? "Sign-in status unavailable"
                : status.state === "signed-in"
                  ? "Signed in"
                  : status.state === "expired"
                    ? "Sign-in expired"
                    : "Signed out"}
          </p>
        </div>
        <Button size="xs" variant="ghost" disabled={busy} onClick={onRefresh}>
          {error ? "Retry" : "Refresh"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Sign in once for Codex, Claude, and OpenCode in this environment. Servers that do not
        require sign-in can be used while signed out.
      </p>
      {error || actionError || status?.error ? (
        <p role="alert" className="text-xs text-destructive">
          {actionError || error || status?.error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || busy || pending}
          onClick={() =>
            run(async () => {
              const started = await onBegin();
              setFlow(
                started.flowId && started.authorizationUrl
                  ? { flowId: started.flowId, authorizationUrl: started.authorizationUrl }
                  : null,
              );
              setCallbackUrl("");
              if (started.authorizationUrl)
                await ensureLocalApi().shell.openExternal(started.authorizationUrl);
            })
          }
        >
          {status?.state === "signed-in" ? "Sign in again" : "Sign in"}
        </Button>
        {status?.state === "signed-in" || status?.state === "expired" ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || busy}
            onClick={() =>
              run(async () => {
                await onSignOut();
                setFlow(null);
              })
            }
          >
            Sign out
          </Button>
        ) : null}
      </div>
      {flow && status?.state !== "signed-in" ? (
        <div className="space-y-2 border-t pt-3">
          <a
            href={flow.authorizationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary underline"
          >
            Continue sign-in in your browser
          </a>
          <p className="text-xs text-muted-foreground">
            After signing in, return here and refresh. If the browser cannot reach the callback
            page, copy its full address and paste it below to finish on this environment.
          </p>
          <Input
            aria-label="Sign-in callback URL"
            placeholder="Paste the full callback URL"
            value={callbackUrl}
            disabled={disabled || busy}
            onChange={(event) => setCallbackUrl(event.target.value)}
          />
          <Button
            size="xs"
            variant="outline"
            disabled={disabled || busy || !callbackUrl.trim()}
            onClick={() =>
              run(async () => {
                await onComplete({ flowId: flow.flowId, callbackUrl: callbackUrl.trim() });
                setCallbackUrl("");
                setFlow(null);
              })
            }
          >
            Complete sign-in
          </Button>
        </div>
      ) : null}
    </div>
  );
}
