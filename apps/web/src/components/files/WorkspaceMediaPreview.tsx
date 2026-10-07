import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { mediaFileReference } from "@t3tools/client-runtime/media-reference";
import { useMemo, useState } from "react";

import { useAssetUrlRefresh, useAssetUrlState } from "~/assets/assetUrls";
import { MediaActions } from "~/components/media/MediaActions";
import { MediaVideoPlayer } from "~/components/media/MediaVideoPlayer";
import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { AudioPreview } from "./AudioPreview";
import { FileSurfaceFailure, FileSurfaceLoading } from "./fileSurfaceChrome";

/** Signed workspace media uses the same streaming and playback controls as attachments. */
export function WorkspaceMediaPreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly name: string;
  readonly kind: "image" | "audio" | "video";
  readonly revision: string | null;
}) {
  const resource = useMemo(
    () => ({
      _tag: props.kind === "image" ? ("workspace-file" as const) : ("media-file" as const),
      threadId: props.threadRef.threadId,
      path: props.absolutePath,
    }),
    [props.kind, props.threadRef.threadId, props.absolutePath],
  );
  const assetUrl = useAssetUrlState(props.environmentId, resource);
  const refresh = useAssetUrlRefresh(props.environmentId, resource);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useWorkspaceMutationRefresh({
    mutationId: props.revision,
    resourceKey: JSON.stringify([props.environmentId, resource]),
    refresh: () => void refresh().catch(() => undefined),
  });
  const url =
    assetUrl._tag === "Success"
      ? `${assetUrl.url}${props.revision === null ? "" : `${assetUrl.url.includes("?") ? "&" : "?"}workspace-revision=${encodeURIComponent(props.revision)}`}`
      : null;
  const retry = () => {
    setFailedUrl(null);
    return refresh();
  };
  const source = {
    kind: props.kind === "video" ? ("video" as const) : ("image" as const),
    name: props.name,
    src: url,
    reference: mediaFileReference(props.absolutePath, props.workspaceRoot),
    asset: { environmentId: props.environmentId, resource },
  };

  if (props.kind === "video") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        <MediaVideoPlayer
          src={url}
          sourceFailed={assetUrl._tag === "Failure"}
          label={props.name}
          revision={props.revision}
          preload="metadata"
          className="flex h-full min-h-0 w-full max-w-5xl items-center justify-center"
          onRetry={retry}
          actionsSource={source}
        />
      </div>
    );
  }
  if (assetUrl._tag === "Failure" || (url !== null && failedUrl === url)) {
    return (
      <FileSurfaceFailure
        message={`Unable to load ${props.kind}.`}
        onRetry={() => void retry().catch(() => undefined)}
      />
    );
  }
  if (url === null) return <FileSurfaceLoading />;
  if (props.kind === "audio") {
    return <AudioPreview src={url} name={props.name} onError={() => setFailedUrl(url)} />;
  }
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      <MediaActions source={source}>
        <img
          className="max-h-full max-w-full object-contain"
          src={url}
          alt={props.name}
          onError={() => setFailedUrl(url)}
        />
      </MediaActions>
    </div>
  );
}
