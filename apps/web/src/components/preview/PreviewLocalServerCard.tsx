import { BrowserMockup } from "./BrowserMockup";
import type { PreviewableServer } from "./useDiscoveredLocalServers";

interface Props {
  server: PreviewableServer;
  onOpen: () => void;
  /** Present only for a server this environment may stop. */
  onStop?: () => void;
}

export function PreviewLocalServerCard({ server, onOpen, onStop }: Props) {
  const subtitle = describeServer(server);
  return (
    <div className="flex w-full items-center hover:bg-accent/40">
      <button
        type="button"
        onClick={onOpen}
        className="group flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <BrowserMockup className="size-7 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{subtitle}</span>
          <span className="truncate text-xs text-muted-foreground">
            {server.host}:{server.port}
          </span>
        </div>
        {server.listening ? <PulsingDot /> : <DimDot />}
      </button>
      {onStop ? (
        <button
          type="button"
          onClick={onStop}
          aria-label={`Stop the server on port ${server.port}`}
          className="mr-2 shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Stop
        </button>
      ) : null}
    </div>
  );
}

function describeServer(server: PreviewableServer): string {
  if (server.processName) return server.processName;
  if (server.listening) return "Listening";
  if (server.source === "configured") return "Configured";
  return "Recently seen";
}

function PulsingDot() {
  return (
    <span aria-label="Listening" className="relative inline-flex size-2 shrink-0">
      <span className="absolute inset-0 animate-status-ping rounded-full bg-success opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-success" />
    </span>
  );
}

function DimDot() {
  return (
    <span
      aria-label="Not currently listening"
      className="size-2 shrink-0 rounded-full bg-muted-foreground/40"
    />
  );
}
