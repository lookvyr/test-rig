import type { PreviewForwardedShortcut } from "./keybindings.ts";
import type { PreviewCaptureFailureEncoded } from "./previewCapture.ts";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { BrowserProfileId } from "./browserProfile.ts";
import type {
  GitGetPullRequestStatsInput,
  GitGetPullRequestStatsResult,
  GitListPullRequestsInput,
  GitListPullRequestsResult,
  GitGetPullRequestDetailsInput,
  GitGetPullRequestDetailsResult,
} from "./pullRequests.ts";
import type {
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  VcsPullInput,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitResolvePullRequestResult,
  VcsStatusInput,
  VcsStatusSubscriptionInput,
  VcsStatusResult,
} from "./git.ts";
import type {
  ReviewDiffFileContentsInput,
  ReviewDiffFileContentsResult,
  ReviewDiffPreviewInput,
  ReviewDiffPreviewResult,
} from "./review.ts";
import type { FilesystemBrowseInput, FilesystemBrowseResult } from "./filesystem.ts";
import type { AssetCreateUrlInput, AssetCreateUrlResult } from "./assets.ts";
import type {
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import type {
  TerminalAttachInput,
  TerminalAttachStreamEvent,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalMetadataStreamEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal.ts";
import * as Schema from "effect/Schema";
import type {
  DiscoveredLocalServerList,
  PreviewCloseInput,
  PreviewEvent,
  PreviewListInput,
  PreviewListResult,
  PreviewAdjustInput,
  PreviewClearProfileInput,
  PreviewOpenInput,
  PreviewReportProfilesInput,
  PreviewReportStatusInput,
  PreviewResizeInput,
  PreviewSessionSnapshot,
} from "./preview.ts";
import type {
  ClientOrchestrationCommand,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamItem,
  OrchestrationSubscribeThreadInput,
  OrchestrationThreadStreamItem,
} from "./orchestration.ts";
import { EnvironmentId } from "./baseSchemas.ts";
import { AdvertisedEndpoint } from "./remoteAccess.ts";
import type { ClientSettings } from "./settings.ts";
import type {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlPublishRepositoryInput,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
} from "./sourceControl.ts";

export interface ContextMenuItem<T extends string = string> {
  separatorBefore?: boolean;
  checked?: boolean;
  id: T;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Renders as a non-interactive section header label. Web fallback only — stripped on desktop native menus. */
  header?: boolean;
  /** Icon keyword resolved by the web fallback. Stripped on desktop native menus. */
  icon?: string;
  children?: readonly ContextMenuItem<T>[];
}

export interface ContextMenuItemSchemaType {
  readonly id: string;
  readonly label: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly header?: boolean;
  readonly icon?: string;
  readonly children?: readonly ContextMenuItemSchemaType[];
}

export const ContextMenuItemSchema: Schema.Codec<ContextMenuItemSchemaType> = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  destructive: Schema.optionalKey(Schema.Boolean),
  disabled: Schema.optionalKey(Schema.Boolean),
  header: Schema.optionalKey(Schema.Boolean),
  icon: Schema.optionalKey(Schema.String),
  children: Schema.optionalKey(
    Schema.Array(
      Schema.suspend((): Schema.Codec<ContextMenuItemSchemaType> => ContextMenuItemSchema),
    ),
  ),
});

export type DesktopRuntimeArch = "arm64" | "x64" | "other";
export type DesktopTheme = "light" | "dark" | "system";
export type DesktopUpdateChannel = "latest" | "nightly";
export type DesktopAppStageLabel = "Alpha" | "Dev" | "Nightly";

export const DesktopRuntimeArchSchema = Schema.Literals(["arm64", "x64", "other"]);
export const DesktopThemeSchema = Schema.Literals(["light", "dark", "system"]);
export const DesktopUpdateChannelSchema = Schema.Literals(["latest", "nightly"]);
export const DesktopAppStageLabelSchema = Schema.Literals(["Alpha", "Dev", "Nightly"]);

export interface DesktopAppBranding {
  baseName: string;
  stageLabel: DesktopAppStageLabel;
  displayName: string;
}

export const DesktopAppBrandingSchema = Schema.Struct({
  baseName: Schema.String,
  stageLabel: DesktopAppStageLabelSchema,
  displayName: Schema.String,
});

export interface DesktopRuntimeInfo {
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
}

export const DesktopRuntimeInfoSchema = Schema.Struct({
  hostArch: DesktopRuntimeArchSchema,
  appArch: DesktopRuntimeArchSchema,
  runningUnderArm64Translation: Schema.Boolean,
});

// Stable id for the Windows-native primary backend. Desktop side wraps
// this with a brand inside DesktopBackendManager; web side keeps it as
// a plain string so the env-runtime can compare against it without
// importing brand machinery from the desktop package.
export const PRIMARY_LOCAL_ENVIRONMENT_ID = "primary";

export interface DesktopEnvironmentBootstrap {
  // Stable backend instance id (e.g. "primary" or "wsl:ubuntu"). The
  // web env runtime keys local environments off this so projects
  // routed to a specific backend reopen against the same one.
  id: string;
  label: string;
  // Concrete WSL distro used by the current backend run. This stays separate
  // from id because a default-tracking instance keeps the stable
  // "wsl:default" IPC target while each run launches a specific distro.
  runningDistro?: string | null;
  httpBaseUrl: string | null;
  wsBaseUrl: string | null;
  bootstrapToken?: string;
}

export const DesktopEnvironmentBootstrapSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  runningDistro: Schema.optionalKey(Schema.NullOr(Schema.String)),
  httpBaseUrl: Schema.NullOr(Schema.String),
  wsBaseUrl: Schema.NullOr(Schema.String),
  bootstrapToken: Schema.optionalKey(Schema.String),
});

export type DesktopServerExposureMode = "local-only" | "network-accessible";

export const DesktopServerExposureModeSchema = Schema.Literals([
  "local-only",
  "network-accessible",
]);

export interface DesktopServerExposureState {
  mode: DesktopServerExposureMode;
  endpointUrl: string | null;
  advertisedHost: string | null;
}

export const DesktopServerExposureStateSchema = Schema.Struct({
  mode: DesktopServerExposureModeSchema,
  endpointUrl: Schema.NullOr(Schema.String),
  advertisedHost: Schema.NullOr(Schema.String),
});

export interface PickFolderOptions {
  initialPath?: string | null;
  // When set, the desktop dialog opens against the named backend's
  // filesystem instead of the primary's. Used by callers that already
  // know which local environment they're targeting (e.g. opening a
  // project that lives inside WSL). Omitting it keeps the historical
  // behavior so non-WSL users never see a different picker.
  targetEnvironmentId?: string;
}

export const PickFolderOptionsSchema = Schema.Struct({
  initialPath: Schema.optionalKey(Schema.NullOr(Schema.String)),
  targetEnvironmentId: Schema.optionalKey(Schema.String),
});

/**
 * A file returned by the desktop theme-file picker. Oversized files carry an
 * empty text so the renderer can reject them by size without the main
 * process ever holding their contents.
 */
export interface PickedThemeFile {
  name: string;
  size: number;
  text: string;
}

export const PickedThemeFileSchema = Schema.Struct({
  name: Schema.String,
  size: Schema.Number,
  text: Schema.String,
});

export interface DesktopWslDistro {
  name: string;
  isDefault: boolean;
  version: 1 | 2;
}

export const DesktopWslDistroSchema = Schema.Struct({
  name: Schema.String,
  isDefault: Schema.Boolean,
  version: Schema.Literals([1, 2]),
});

export interface DesktopWslState {
  // True when the user has opted the WSL backend in; the actual backend
  // process is registered with the desktop pool independently of this
  // flag and may take a moment to come up after the user enables it.
  enabled: boolean;
  // null means "track the current WSL default distro".
  distro: string | null;
  available: boolean;
  // When true (and `enabled` is also true) the desktop runs only the
  // WSL backend as the primary; the Windows-side Node backend is not
  // started. Toggling this requires an app restart because the
  // primary backend's spec is captured once at layer init.
  wslOnly: boolean;
  distros: readonly DesktopWslDistro[];
  // Reason the dual-mode WSL backend last failed preflight (no node, wrong
  // version, missing build tools), or null. Surfaced inline in Connections
  // settings. Always null in wsl-only mode — that path shows a dialog and
  // falls back to Windows instead.
  preflightError: string | null;
}

export const DesktopWslStateSchema = Schema.Struct({
  enabled: Schema.Boolean,
  distro: Schema.NullOr(Schema.String),
  available: Schema.Boolean,
  wslOnly: Schema.Boolean,
  distros: Schema.Array(DesktopWslDistroSchema),
  preflightError: Schema.NullOr(Schema.String),
});

export type DesktopPreviewNavStatus =
  | { kind: "Idle" }
  | { kind: "Loading"; url: string; title: string }
  | { kind: "Success"; url: string; title: string }
  | {
      kind: "LoadFailed";
      url: string;
      title: string;
      code: number;
      description: string;
    };

export type DesktopPreviewColorScheme = "system" | "light" | "dark";

export const DesktopPreviewColorSchemeSchema: Schema.Codec<DesktopPreviewColorScheme> =
  Schema.Literals(["system", "light", "dark"]);

export const FAVICON_DATA_URL_MAX_LENGTH = 8192;
export const FAVICON_CAPTURED_AT_MAX = 8_640_000_000_000_000;

export interface DesktopPreviewFavicon {
  dataUrl: string;
  pageUrl: string;
  capturedAt: number;
}

export interface DesktopPreviewTabState {
  tabId: string;
  webContentsId: number | null;
  navStatus: DesktopPreviewNavStatus;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomFactor: number;
  pictureInPicture: boolean;
  colorScheme: DesktopPreviewColorScheme;
  audioMuted: boolean;
  /** Chromium reports playback even when audioMuted is true. */
  audible: boolean;
  controller: "human" | "agent" | "none";
  /** A screenshot or stream of the guest is pending, so the client keeps it painting while hidden. */
  capturing: boolean;
  favicon?: DesktopPreviewFavicon;
  updatedAt: string;
}

export const DesktopPreviewTabIdSchema = Schema.String.check(Schema.isTrimmed()).check(
  Schema.isNonEmpty(),
);

export interface DesktopPreviewPointerEvent {
  tabId: string;
  phase: "move" | "click";
  x: number;
  y: number;
  sequence: number;
  createdAt: string;
}

export interface DesktopPreviewOpenLinkEvent {
  tabId: string;
  url: string;
  background: boolean;
}

export const DesktopPreviewRecordingInputSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("pointer"),
    phase: Schema.Literals(["move", "down", "up", "click"]),
    x: Schema.Finite,
    y: Schema.Finite,
    width: Schema.Finite.check(Schema.isGreaterThan(0)),
    height: Schema.Finite.check(Schema.isGreaterThan(0)),
  }),
  Schema.Struct({
    type: Schema.Literal("key"),
    label: Schema.NullOr(Schema.String.check(Schema.isMaxLength(100))),
    held: Schema.Boolean,
    width: Schema.Finite.check(Schema.isGreaterThan(0)),
  }),
  Schema.Struct({ type: Schema.Literal("clear") }),
]);
export type DesktopPreviewRecordingInput = typeof DesktopPreviewRecordingInputSchema.Type;
export interface DesktopPreviewRecordingInputEvent {
  readonly tabId: string;
  readonly input: DesktopPreviewRecordingInput;
}

export interface DesktopPreviewWebviewConfig {
  partition: string;
  /** Sandboxed with contextIsolation off so the picker preload can read the React DevTools hook. */
  webPreferences: string;
  /** Absolute file:// preload URL; null requires disabling element picking. */
  preloadUrl: string | null;
}

export const DesktopPreviewWebviewConfigSchema: Schema.Codec<DesktopPreviewWebviewConfig> =
  Schema.Struct({
    partition: Schema.String,
    webPreferences: Schema.String,
    preloadUrl: Schema.NullOr(Schema.String),
  });

export interface DesktopPreviewAnnotationTheme {
  colorScheme: "light" | "dark";
  radius: string;
  background: string;
  foreground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  border: string;
  input: string;
  ring: string;
  fontSans: string;
  fontMono: string;
}

export const DesktopPreviewAnnotationThemeSchema: Schema.Codec<DesktopPreviewAnnotationTheme> =
  Schema.Struct({
    colorScheme: Schema.Literals(["light", "dark"]),
    radius: Schema.String,
    background: Schema.String,
    foreground: Schema.String,
    popover: Schema.String,
    popoverForeground: Schema.String,
    primary: Schema.String,
    primaryForeground: Schema.String,
    muted: Schema.String,
    mutedForeground: Schema.String,
    accent: Schema.String,
    accentForeground: Schema.String,
    border: Schema.String,
    input: Schema.String,
    ring: Schema.String,
    fontSans: Schema.String,
    fontMono: Schema.String,
  });

export interface DesktopPreviewRecordingFrame {
  tabId: string;
  data: string;
  width: number;
  height: number;
  receivedAt: string;
}

export interface DesktopPreviewRecordingArtifact {
  id: string;
  tabId: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export const DesktopPreviewRecordingArtifactSchema: Schema.Codec<DesktopPreviewRecordingArtifact> =
  Schema.Struct({
    id: Schema.String,
    tabId: DesktopPreviewTabIdSchema,
    path: Schema.String,
    mimeType: Schema.String,
    sizeBytes: Schema.Int,
    createdAt: Schema.String,
  });

export interface DesktopPreviewScreenshotArtifact {
  id: string;
  tabId: string;
  path: string;
  mimeType: "image/png";
  sizeBytes: number;
  createdAt: string;
}

export const DesktopPreviewScreenshotArtifactSchema: Schema.Codec<DesktopPreviewScreenshotArtifact> =
  Schema.Struct({
    id: Schema.String,
    tabId: DesktopPreviewTabIdSchema,
    path: Schema.String,
    mimeType: Schema.Literal("image/png"),
    sizeBytes: Schema.Int,
    createdAt: Schema.String,
  });

export interface PickedElementStackFrame {
  functionName: string | null;
  fileName: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
}

export const PickedElementStackFrameSchema: Schema.Codec<PickedElementStackFrame> = Schema.Struct({
  functionName: Schema.NullOr(Schema.String),
  fileName: Schema.NullOr(Schema.String),
  lineNumber: Schema.NullOr(Schema.Number),
  columnNumber: Schema.NullOr(Schema.Number),
});

export interface PickedElementPayload {
  pageUrl: string;
  pageTitle: string | null;
  tagName: string;
  selector: string | null;
  htmlPreview: string;
  componentName: string | null;
  source: PickedElementStackFrame | null;
  stack: ReadonlyArray<PickedElementStackFrame>;
  styles: string;
  pickedAt: string;
}

export const PickedElementPayloadSchema: Schema.Codec<PickedElementPayload> = Schema.Struct({
  pageUrl: Schema.String,
  pageTitle: Schema.NullOr(Schema.String),
  tagName: Schema.String,
  selector: Schema.NullOr(Schema.String),
  htmlPreview: Schema.String,
  componentName: Schema.NullOr(Schema.String),
  source: Schema.NullOr(PickedElementStackFrameSchema),
  stack: Schema.Array(PickedElementStackFrameSchema),
  styles: Schema.String,
  pickedAt: Schema.String,
});

export interface PreviewAnnotationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const PreviewAnnotationRectSchema: Schema.Codec<PreviewAnnotationRect> = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});

export interface PreviewAnnotationPoint {
  x: number;
  y: number;
}

export const PreviewAnnotationPointSchema: Schema.Codec<PreviewAnnotationPoint> = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
});

export interface PreviewAnnotationElementTarget {
  id: string;
  element: PickedElementPayload;
  rect: PreviewAnnotationRect;
}

export const PreviewAnnotationElementTargetSchema: Schema.Codec<PreviewAnnotationElementTarget> =
  Schema.Struct({
    id: Schema.String,
    element: PickedElementPayloadSchema,
    rect: PreviewAnnotationRectSchema,
  });

export interface PreviewAnnotationRegionTarget {
  id: string;
  rect: PreviewAnnotationRect;
}

export const PreviewAnnotationRegionTargetSchema: Schema.Codec<PreviewAnnotationRegionTarget> =
  Schema.Struct({
    id: Schema.String,
    rect: PreviewAnnotationRectSchema,
  });

export interface PreviewAnnotationStrokeTarget {
  id: string;
  color: string;
  width: number;
  points: ReadonlyArray<PreviewAnnotationPoint>;
  bounds: PreviewAnnotationRect;
}

export const PreviewAnnotationStrokeTargetSchema: Schema.Codec<PreviewAnnotationStrokeTarget> =
  Schema.Struct({
    id: Schema.String,
    color: Schema.String,
    width: Schema.Number,
    points: Schema.Array(PreviewAnnotationPointSchema),
    bounds: PreviewAnnotationRectSchema,
  });

export interface PreviewAnnotationStyleChange {
  targetId: string;
  selector: string | null;
  property: string;
  previousValue: string;
  value: string;
}

export const PreviewAnnotationStyleChangeSchema: Schema.Codec<PreviewAnnotationStyleChange> =
  Schema.Struct({
    targetId: Schema.String,
    selector: Schema.NullOr(Schema.String),
    property: Schema.String,
    previousValue: Schema.String,
    value: Schema.String,
  });

export interface PreviewAnnotationScreenshot {
  dataUrl: string;
  width: number;
  height: number;
  cropRect: PreviewAnnotationRect;
}

export const PreviewAnnotationScreenshotSchema: Schema.Codec<PreviewAnnotationScreenshot> =
  Schema.Struct({
    dataUrl: Schema.String,
    width: Schema.Number,
    height: Schema.Number,
    cropRect: PreviewAnnotationRectSchema,
  });

export interface PreviewAnnotationPayload {
  id: string;
  pageUrl: string;
  pageTitle: string | null;
  comment: string;
  elements: ReadonlyArray<PreviewAnnotationElementTarget>;
  regions: ReadonlyArray<PreviewAnnotationRegionTarget>;
  strokes: ReadonlyArray<PreviewAnnotationStrokeTarget>;
  styleChanges: ReadonlyArray<PreviewAnnotationStyleChange>;
  screenshot: PreviewAnnotationScreenshot | null;
  createdAt: string;
}

export const PreviewAnnotationPayloadSchema: Schema.Codec<PreviewAnnotationPayload> = Schema.Struct(
  {
    id: Schema.String,
    pageUrl: Schema.String,
    pageTitle: Schema.NullOr(Schema.String),
    comment: Schema.String,
    elements: Schema.Array(PreviewAnnotationElementTargetSchema),
    regions: Schema.Array(PreviewAnnotationRegionTargetSchema),
    strokes: Schema.Array(PreviewAnnotationStrokeTargetSchema),
    styleChanges: Schema.Array(PreviewAnnotationStyleChangeSchema),
    screenshot: Schema.NullOr(PreviewAnnotationScreenshotSchema),
    createdAt: Schema.String,
  },
);

export type PreviewAnnotationSubmission = "attach" | "send";
export const PreviewAnnotationSubmissionSchema: Schema.Codec<PreviewAnnotationSubmission> =
  Schema.Literals(["attach", "send"]);

export interface PreviewAnnotationSubmissionResult {
  annotation: PreviewAnnotationPayload;
  submission: PreviewAnnotationSubmission;
  screenshotFailed?: boolean;
}
export const PreviewAnnotationSubmissionResultSchema: Schema.Codec<PreviewAnnotationSubmissionResult> =
  Schema.Struct({
    annotation: PreviewAnnotationPayloadSchema,
    submission: PreviewAnnotationSubmissionSchema,
    screenshotFailed: Schema.optionalKey(Schema.Boolean),
  });

export const DesktopPreviewTabInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
});

/** Apply zoom and color scheme at creation to avoid flashing browser defaults. */
export const DesktopPreviewCreateTabInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  zoomFactor: Schema.optional(Schema.Number.check(Schema.isGreaterThan(0))),
  colorScheme: Schema.optional(DesktopPreviewColorSchemeSchema),
  serverTab: Schema.optional(
    Schema.Struct({ threadId: TrimmedNonEmptyString, tabId: TrimmedNonEmptyString }),
  ),
});

export interface DesktopPreviewTabDefaults {
  readonly zoomFactor?: number | undefined;
  readonly colorScheme?: DesktopPreviewColorScheme | undefined;
  readonly serverTab?: { readonly threadId: string; readonly tabId: string } | undefined;
}

export const DesktopPreviewRegisterWebviewInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  webContentsId: Schema.Int.check(Schema.isGreaterThan(0)),
});

export const DesktopPreviewNavigateInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  url: Schema.String,
});

export const DesktopPreviewConfigInputSchema = Schema.Struct({
  environmentId: EnvironmentId,
  /** Main must derive the partition to ensure its session has UA rewrites and permission handlers. */
  profileId: Schema.optional(BrowserProfileId),
});

export const DesktopPreviewClearDataInputSchema = Schema.Struct({
  environmentId: EnvironmentId,
  /** Omit to clear every profile; otherwise only this profile's partition. */
  profileId: Schema.optional(BrowserProfileId),
});

export const DesktopPreviewSetColorSchemeInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  colorScheme: DesktopPreviewColorSchemeSchema,
});

export const DesktopPreviewSetZoomFactorInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  zoomFactor: Schema.Number.check(Schema.isGreaterThan(0)),
});

export const DesktopPreviewSetAudioMutedInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  audioMuted: Schema.Boolean,
});

export const DesktopPreviewAnnotationThemeInputSchema = Schema.Struct({
  theme: DesktopPreviewAnnotationThemeSchema,
});

export const DesktopPreviewAnnotationSendEnabledInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  enabled: Schema.Boolean,
});

export const DesktopPreviewArtifactInputSchema = Schema.Struct({
  path: Schema.String.check(Schema.isTrimmed()).check(Schema.isNonEmpty()),
});

export const DesktopPreviewRecordingSaveInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  mimeType: Schema.String.check(Schema.isTrimmed()).check(Schema.isNonEmpty()),
  data: Schema.Uint8Array,
});

export interface DesktopBridge {
  pasteAsText?: () => Promise<void>;
  getAppBranding: () => DesktopAppBranding | null;
  // One bootstrap per pool instance currently registered with bootstrap
  // info (omits instances whose backend hasn't produced a config yet).
  // The primary backend is identified by id === PRIMARY_LOCAL_ENVIRONMENT_ID.
  getLocalEnvironmentBootstraps: () => readonly DesktopEnvironmentBootstrap[];
  getLocalEnvironmentBearerToken: () => Promise<string>;
  getClientSettings: () => Promise<ClientSettings | null>;
  setClientSettings: (settings: ClientSettings) => Promise<void>;
  getConnectionCatalog?: () => Promise<string | null>;
  setConnectionCatalog?: (catalog: string) => Promise<boolean>;
  clearConnectionCatalog?: () => Promise<void>;
  getServerExposureState: () => Promise<DesktopServerExposureState>;
  setServerExposureMode: (mode: DesktopServerExposureMode) => Promise<DesktopServerExposureState>;
  getAdvertisedEndpoints: () => Promise<readonly AdvertisedEndpoint[]>;
  getWslState: () => Promise<DesktopWslState>;
  setWslBackendEnabled: (enabled: boolean) => Promise<DesktopWslState>;
  setWslDistro: (distro: string | null) => Promise<DesktopWslState>;
  setWslOnly: (enabled: boolean) => Promise<DesktopWslState>;
  pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
  /**
   * Multi-select JSON file picker that opens in the VS Code extensions
   * directory when one exists. Optional: older desktop builds lack it, and
   * web callers fall back to a plain file input.
   */
  pickThemeFiles?: () => Promise<readonly PickedThemeFile[] | null>;
  confirm: (message: string) => Promise<boolean>;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  getWindowFullscreenState: () => boolean;
  /** The app window's own zoom, which scales every CSS pixel the renderer lays out. */
  getWindowZoomFactor: () => number;
  onWindowFullscreenStateChange: (listener: (fullscreen: boolean) => void) => () => void;
  /**
   * Desktop-only preview surface. Present iff the renderer is hosted by the
   * Electron desktop build; web builds have `preview === undefined`.
   */
  preview?: DesktopPreviewBridge;
}

/** Renderer callback invoked by Electron with a fresh user gesture before display-media capture. */
export const DESKTOP_PREVIEW_RECORDING_CAPTURE_TRIGGER = "__t3DesktopPreviewRecordingCapture";

export interface DesktopPreviewBridge {
  setForwardedShortcuts: (shortcuts: ReadonlyArray<PreviewForwardedShortcut>) => Promise<void>;
  createTab: (tabId: string, defaults?: DesktopPreviewTabDefaults) => Promise<void>;
  closeTab: (tabId: string) => Promise<void>;
  registerWebview: (tabId: string, webContentsId: number) => Promise<void>;
  navigate: (tabId: string, url: string) => Promise<void>;
  goBack: (tabId: string) => Promise<void>;
  goForward: (tabId: string) => Promise<void>;
  refresh: (tabId: string) => Promise<void>;
  zoomIn: (tabId: string) => Promise<void>;
  zoomOut: (tabId: string) => Promise<void>;
  resetZoom: (tabId: string) => Promise<void>;
  setZoomFactor: (tabId: string, zoomFactor: number) => Promise<void>;
  hardReload: (tabId: string) => Promise<void>;
  setColorScheme: (tabId: string, colorScheme: DesktopPreviewColorScheme) => Promise<void>;
  setAudioMuted: (tabId: string, audioMuted: boolean) => Promise<void>;
  openDevTools: (tabId: string) => Promise<void>;
  clearCookies: (environmentId: EnvironmentId, profileId?: string) => Promise<void>;
  clearCache: (environmentId: EnvironmentId, profileId?: string) => Promise<void>;
  getPreviewConfig: (
    environmentId: EnvironmentId,
    profileId?: string,
  ) => Promise<DesktopPreviewWebviewConfig>;
  setAnnotationTheme: (theme: DesktopPreviewAnnotationTheme) => Promise<void>;
  setAnnotationSendEnabled: (tabId: string, enabled: boolean) => Promise<void>;
  /** Resolves with the annotation and attach/send intent, or null on cancellation. Rejects if activation fails. */
  pickElement: (tabId: string) => Promise<PreviewAnnotationSubmissionResult | null>;
  cancelPickElement: (tabId: string) => Promise<void>;
  captureScreenshot: (
    tabId: string,
  ) => Promise<DesktopPreviewScreenshotArtifact | PreviewCaptureFailureEncoded>;
  revealArtifact: (path: string) => Promise<void>;
  copyArtifactToClipboard: (path: string) => Promise<void>;
  pictureInPicture: {
    open: (tabId: string) => Promise<void>;
    close: (tabId: string) => Promise<void>;
  };
  recording: {
    onInput: (listener: (event: DesktopPreviewRecordingInputEvent) => void) => () => void;
    startScreencast: (tabId: string) => Promise<void | PreviewCaptureFailureEncoded>;
    stopScreencast: (tabId: string) => Promise<void>;
    save: (
      tabId: string,
      mimeType: string,
      data: Uint8Array,
    ) => Promise<DesktopPreviewRecordingArtifact>;
  };
  onStateChange: (listener: (tabId: string, state: DesktopPreviewTabState) => void) => () => void;
  onPointerEvent: (listener: (event: DesktopPreviewPointerEvent) => void) => () => void;
  onOpenLink: (listener: (event: DesktopPreviewOpenLinkEvent) => void) => () => void;
}

/**
 * APIs bound to the local app shell, not to any particular backend environment.
 *
 * These capabilities describe the desktop/browser host that the user is
 * currently running: dialogs, external-link opening, context menus, and
 * app-level settings/config access. They must not be used as a proxy for
 * "whatever environment the user is targeting", because in a multi-environment
 * world the local shell and a selected backend environment are distinct
 * concepts.
 */
export interface LocalApi {
  dialogs: {
    pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  persistence: {
    getClientSettings: () => Promise<ClientSettings | null>;
    setClientSettings: (settings: ClientSettings) => Promise<void>;
  };
}

/**
 * APIs bound to a specific backend environment connection.
 *
 * These operations must always be routed with explicit environment context.
 * They represent remote stateful capabilities such as orchestration, terminal,
 * project, VCS, and provider operations. In multi-environment mode, each environment gets
 * its own instance of this surface, and callers should resolve it by
 * `environmentId` rather than reaching through the local desktop bridge.
 */
export interface EnvironmentApi {
  terminal: {
    open: (input: typeof TerminalOpenInput.Encoded) => Promise<TerminalSessionSnapshot>;
    attach: (
      input: typeof TerminalAttachInput.Encoded,
      callback: (event: TerminalAttachStreamEvent) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
    write: (input: typeof TerminalWriteInput.Encoded) => Promise<void>;
    resize: (input: typeof TerminalResizeInput.Encoded) => Promise<void>;
    clear: (input: typeof TerminalClearInput.Encoded) => Promise<void>;
    restart: (input: typeof TerminalRestartInput.Encoded) => Promise<TerminalSessionSnapshot>;
    close: (input: typeof TerminalCloseInput.Encoded) => Promise<void>;
    onMetadata: (
      callback: (event: TerminalMetadataStreamEvent) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  projects: {
    listEntries: (input: ProjectListEntriesInput) => Promise<ProjectListEntriesResult>;
    readFile: (input: ProjectReadFileInput) => Promise<ProjectReadFileResult>;
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
  };
  filesystem: {
    browse: (input: FilesystemBrowseInput) => Promise<FilesystemBrowseResult>;
  };
  assets: {
    createUrl: (input: AssetCreateUrlInput) => Promise<AssetCreateUrlResult>;
  };
  sourceControl: {
    lookupRepository: (
      input: SourceControlRepositoryLookupInput,
    ) => Promise<SourceControlRepositoryInfo>;
    cloneRepository: (
      input: SourceControlCloneRepositoryInput,
    ) => Promise<SourceControlCloneRepositoryResult>;
    publishRepository: (
      input: SourceControlPublishRepositoryInput,
    ) => Promise<SourceControlPublishRepositoryResult>;
  };
  vcs: {
    listRefs: (input: VcsListRefsInput) => Promise<VcsListRefsResult>;
    createWorktree: (input: VcsCreateWorktreeInput) => Promise<VcsCreateWorktreeResult>;
    removeWorktree: (input: VcsRemoveWorktreeInput) => Promise<void>;
    createRef: (input: VcsCreateRefInput) => Promise<VcsCreateRefResult>;
    switchRef: (input: VcsSwitchRefInput) => Promise<VcsSwitchRefResult>;
    init: (input: VcsInitInput) => Promise<void>;
    pull: (input: VcsPullInput) => Promise<VcsPullResult>;
    refreshStatus: (input: VcsStatusInput) => Promise<VcsStatusResult>;
    onStatus: (
      input: VcsStatusSubscriptionInput,
      callback: (status: VcsStatusResult) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  git: {
    getPullRequestStats: (
      input: GitGetPullRequestStatsInput,
    ) => Promise<GitGetPullRequestStatsResult>;
    listPullRequests: (input: GitListPullRequestsInput) => Promise<GitListPullRequestsResult>;
    getPullRequestDetails: (
      input: GitGetPullRequestDetailsInput,
    ) => Promise<GitGetPullRequestDetailsResult>;
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>;
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput,
    ) => Promise<GitPreparePullRequestThreadResult>;
  };
  review: {
    getDiffPreview: (input: ReviewDiffPreviewInput) => Promise<ReviewDiffPreviewResult>;
    getDiffFileContents: (
      input: ReviewDiffFileContentsInput,
    ) => Promise<ReviewDiffFileContentsResult>;
  };
  orchestration: {
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>;
    getTurnDiff: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>;
    getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Promise<OrchestrationGetFullThreadDiffResult>;
    getArchivedShellSnapshot: () => Promise<OrchestrationShellSnapshot>;
    subscribeShell: (
      callback: (event: OrchestrationShellStreamItem) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
    subscribeThread: (
      input: OrchestrationSubscribeThreadInput,
      callback: (event: OrchestrationThreadStreamItem) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  preview: {
    open: (input: typeof PreviewOpenInput.Encoded) => Promise<PreviewSessionSnapshot>;
    resize: (input: typeof PreviewResizeInput.Encoded) => Promise<PreviewSessionSnapshot>;
    adjust: (input: typeof PreviewAdjustInput.Encoded) => Promise<PreviewSessionSnapshot>;
    close: (input: typeof PreviewCloseInput.Encoded) => Promise<void>;
    list: (input: typeof PreviewListInput.Encoded) => Promise<PreviewListResult>;
    clearProfile: (input: typeof PreviewClearProfileInput.Encoded) => Promise<void>;
    reportProfiles: (input: typeof PreviewReportProfilesInput.Encoded) => Promise<void>;
    reportStatus: (input: typeof PreviewReportStatusInput.Encoded) => Promise<void>;
    onEvent: (
      callback: (event: PreviewEvent) => void,
      options?: { onResubscribe?: () => void },
    ) => () => void;
    subscribePorts: (
      callback: (servers: DiscoveredLocalServerList) => void,
      options?: { onResubscribe?: () => void },
    ) => () => void;
  };
}
