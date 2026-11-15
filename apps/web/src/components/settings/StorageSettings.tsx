import {
  DEFAULT_WORKTREE_SETTLED_AFTER_DAYS,
  type StorageCleanupReport,
  type StorageCleanupSettings,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ChevronRightIcon } from "lucide-react";
import { useRef, useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { AdvancedSettings } from "./AdvancedSettings";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let unitIndex = -1;
  let next = value;
  do {
    next /= 1024;
    unitIndex += 1;
  } while (next >= 1024 && unitIndex < units.length - 1);
  return `${next.toFixed(next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

/** Worktree folders must be absolute and must not be home or one of its parents. */
function worktreesDirectoryProblem(value: string): string | null {
  if (value === "") return null;
  const trimmed = value.replace(/[\\/]+$/, "");
  if (!/^(?:\/|~\/|~$|[A-Za-z]:[\\/])/.test(value)) {
    return "Use an absolute path, such as ~/worktrees. New worktrees use the default folder until then.";
  }
  if (trimmed === "~" || trimmed === "" || /^[A-Za-z]:$/.test(trimmed)) {
    return "Choose a folder inside your home folder, such as ~/worktrees. New worktrees use the default folder until then.";
  }
  return null;
}

export function WorktreesDirectoryRow() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const edited = useRef(false);
  const problem = worktreesDirectoryProblem(settings.worktreesDirectory);

  return (
    <SettingsRow
      {...searchableSetting("storage-worktrees-location")}
      description="Folder where new worktrees are created, such as ~/worktrees. Existing worktrees stay where they are. Leave empty to use the Test Rig home folder."
      status={problem ? <span className="text-destructive">{problem}</span> : undefined}
      resetAction={
        settings.worktreesDirectory !== "" ? (
          <SettingResetButton
            label="worktree location"
            onClick={() => updateSettings({ worktreesDirectory: "" })}
          />
        ) : null
      }
      control={
        <Input
          key={settings.worktreesDirectory}
          aria-label="Worktree location"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Default"
          defaultValue={settings.worktreesDirectory}
          onChange={() => {
            edited.current = true;
          }}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (edited.current && value !== settings.worktreesDirectory)
              updateSettings({ worktreesDirectory: value });
            edited.current = false;
          }}
        />
      }
    />
  );
}

/** An age in days behind a switch. Saving an age can start a cleanup pass, so drafts wait for commit. */
function RetentionControl({
  label,
  value,
  onChange,
  minimum = 1,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  minimum?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  // Turning a rule on opens a draft; nothing is saved until the age is committed.
  const [enabling, setEnabling] = useState(false);
  if (savedValue !== value) {
    setSavedValue(value);
    setDraft(value);
    setEnabling(false);
  }
  const on = value !== null || enabling;

  const commit = (next: number) => {
    const days = Math.min(3650, Math.max(minimum, Math.round(next)));
    setDraft(days);
    if (days !== value) onChange(days);
  };

  return (
    <div
      className="flex items-center gap-3"
      // Ages save when focus leaves the row or on Enter, never on each step toward a value.
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        if (on && draft !== null) commit(draft);
        else setEnabling(false);
      }}
    >
      {on ? (
        <NumberField
          value={draft}
          min={minimum}
          max={3650}
          step={1}
          size="sm"
          className="w-auto"
          onValueChange={setDraft}
          onValueCommitted={(next) => {
            if (next === null) setDraft(value);
          }}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement aria-label={`Decrease ${label}`} />
            <NumberFieldInput
              aria-label={`${label} in days`}
              autoFocus={value === null}
              size={5}
              className="w-auto grow-0 text-right"
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter") {
                  if (draft !== null) commit(draft);
                  event.currentTarget.blur();
                }
              }}
            />
            <span aria-hidden="true" className="self-center pr-2 text-xs">
              days
            </span>
            <NumberFieldIncrement aria-label={`Increase ${label}`} />
          </NumberFieldGroup>
        </NumberField>
      ) : (
        <span className="text-xs text-muted-foreground">Off</span>
      )}
      <Switch
        aria-label={label}
        checked={on}
        // Keeps focus in the age field, so switching off never saves an edited age first.
        onMouseDown={(event) => event.preventDefault()}
        onCheckedChange={(enabled) => {
          if (enabled) {
            setDraft(Math.max(minimum, 8));
            setEnabling(true);
          } else {
            setEnabling(false);
            setDraft(null);
            if (value !== null) onChange(null);
          }
        }}
      />
    </div>
  );
}

const KEEP_WHEN_LABELS = {
  "any-local-files": "Any local files",
  "uncommitted-changes": "Uncommitted changes",
  "tracked-changes": "Edited tracked files",
} as const;

export function WorktreeCleanupSection() {
  const settings = usePrimarySettings((value) => value.storageCleanup);
  const updateSettings = useUpdatePrimarySettings();
  const update = (patch: Partial<StorageCleanupSettings>) =>
    updateSettings({ storageCleanup: patch });

  return (
    <SettingsSection id={searchableSetting("storage-worktrees").id} title="Cleanup">
      <SettingsRow
        title="Delete settled worktrees"
        description="Remove worktrees this many days after their threads settle. At 0 days they are removed as soon as the threads settle. Branches and thread history are kept."
        resetAction={
          settings.worktreeSettledAfterDays !== DEFAULT_WORKTREE_SETTLED_AFTER_DAYS ? (
            <SettingResetButton
              label="delete settled worktrees"
              onClick={() =>
                update({ worktreeSettledAfterDays: DEFAULT_WORKTREE_SETTLED_AFTER_DAYS })
              }
            />
          ) : null
        }
        control={
          <RetentionControl
            label="Delete settled worktrees"
            value={settings.worktreeSettledAfterDays}
            minimum={0}
            onChange={(worktreeSettledAfterDays) => update({ worktreeSettledAfterDays })}
          />
        }
      />
      <SettingsRow
        title="Delete merged worktrees"
        description="Remove worktrees whose pull request is merged and whose commits reached the remote. Checked hourly."
        control={
          <Switch
            aria-label="Delete merged worktrees"
            checked={settings.worktreeOnMerge}
            onCheckedChange={(worktreeOnMerge) => update({ worktreeOnMerge })}
          />
        }
      />
      <SettingsRow
        title="Delete inactive worktrees"
        description="Remove worktrees after their threads have been inactive for this many days, settled or not. Branches and thread history are kept."
        control={
          <RetentionControl
            label="Delete inactive worktrees"
            value={settings.worktreeAfterDays}
            onChange={(worktreeAfterDays) => update({ worktreeAfterDays })}
          />
        }
      />
      <AdvancedSettings targetIds={[searchableSetting("storage-worktree-keep-when").id]}>
        <SettingsRow
          title="Delete unchanged worktrees"
          description="Remove worktrees with no commits beyond the default branch. Checked hourly."
          control={
            <Switch
              aria-label="Delete unchanged worktrees"
              checked={settings.worktreeUnchanged}
              onCheckedChange={(worktreeUnchanged) => update({ worktreeUnchanged })}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("storage-worktree-keep-when")}
          description={
            settings.worktreeKeepWhen === "any-local-files"
              ? "Includes ignored files, except node_modules."
              : settings.worktreeKeepWhen === "tracked-changes"
                ? "Deletes untracked and ignored files, including .env."
                : "Keeps edits and untracked files. Deletes ignored files, including .env."
          }
          control={
            <Select
              value={settings.worktreeKeepWhen}
              onValueChange={(next) => {
                if (
                  next === "any-local-files" ||
                  next === "uncommitted-changes" ||
                  next === "tracked-changes"
                )
                  update({ worktreeKeepWhen: next });
              }}
            >
              <SelectTrigger size="sm" aria-label="Keep worktrees with local changes">
                <SelectValue>{KEEP_WHEN_LABELS[settings.worktreeKeepWhen]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="any-local-files">Any local files</SelectItem>
                <SelectItem value="uncommitted-changes">Uncommitted changes</SelectItem>
                <SelectItem value="tracked-changes">Edited tracked files</SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </AdvancedSettings>
    </SettingsSection>
  );
}

function CleanupResults({ report }: { report: StorageCleanupReport }) {
  return (
    <>
      {report.entries.map((entry, index) => {
        const name =
          entry.kind === "worktree"
            ? (entry.path?.split(/[\\/]/).findLast(Boolean) ?? "Worktrees")
            : entry.kind === "logs"
              ? "Rotated logs"
              : "Browser artifacts";
        return (
          <SettingsRow
            key={`${entry.path ?? entry.kind}:${entry.threadId ?? index}`}
            title={<span className="wrap-anywhere select-text">{name}</span>}
            description={
              <span className="block space-y-2 wrap-anywhere select-text">
                <span className={`block ${entry.outcome === "failed" ? "text-destructive" : ""}`}>
                  {entry.reason}
                </span>
                {(entry.projectPath || entry.path || entry.threadTitle) && (
                  <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-l border-border/60 pl-3">
                    {entry.projectPath && (
                      <>
                        <span>Project</span>
                        <code className="text-foreground/80">{entry.projectPath}</code>
                      </>
                    )}
                    {entry.path && (
                      <>
                        <span>Folder</span>
                        <code className="text-foreground/80">{entry.path}</code>
                      </>
                    )}
                    {entry.threadTitle && (
                      <>
                        <span>Thread</span>
                        <span>{entry.threadTitle}</span>
                      </>
                    )}
                  </span>
                )}
              </span>
            }
            control={
              entry.outcome === "removed" &&
              (entry.files !== null || entry.bytes !== null) && (
                <span className="text-xs text-muted-foreground">
                  {[
                    entry.files !== null
                      ? `${entry.files.toLocaleString()} ${entry.files === 1 ? "file" : "files"}`
                      : null,
                    entry.bytes !== null ? formatBytes(entry.bytes) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )
            }
          />
        );
      })}
      {report.omittedCount > 0 && (
        <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
          {report.omittedCount.toLocaleString()} more results.
        </p>
      )}
      {report.entries.length === 0 && report.omittedCount === 0 && (
        <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">Nothing needed cleanup.</p>
      )}
    </>
  );
}

function CleanupSection({
  environmentId,
}: {
  environmentId: NonNullable<ReturnType<typeof usePrimaryEnvironmentId>>;
}) {
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const settings = usePrimarySettings((value) => value.storageCleanup);
  const run = useAtomCommand(serverEnvironment.runStorageCleanup, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const query = useEnvironmentQuery(
    serverEnvironment.storageCleanupReport({ environmentId, input: {} }),
  );
  const report = query.data;
  const hasRules =
    settings.browserArtifactsAfterDays !== null ||
    settings.logsAfterDays !== null ||
    settings.worktreeAfterDays !== null ||
    settings.worktreeSettledAfterDays !== null ||
    settings.worktreeOnMerge ||
    settings.worktreeUnchanged;
  const description = !hasRules
    ? "Turn on a cleanup rule to use this."
    : report
      ? `Last run ${formatRelativeTimeLabel(report.finishedAt, nowMs)}. ${report.counts.removed} removed, ${report.counts.kept} kept${report.counts.failed > 0 ? `, ${report.counts.failed} couldn't be removed` : ""}.${report.bytesFreed > 0 ? ` ${formatBytes(report.bytesFreed)} recovered.` : ""}`
      : query.error
        ? "Could not load the last run."
        : "Cleanup hasn't run yet.";
  const deleteNow = async () => {
    if (pending) return;
    setPending(true);
    const result = await run({ environmentId, input: {} });
    setPending(false);
    if (result._tag === "Success") {
      const failure = result.value.entries.find((entry) => entry.outcome === "failed");
      if (failure)
        toastManager.add({ type: "error", title: "Cleanup failed", description: failure.reason });
    } else if (!isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: "Could not run cleanup",
        description: String(squashAtomCommandFailure(result)),
      });
    }
  };

  return (
    <SettingsSection title="Cleanup">
      <SettingsRow
        {...searchableSetting("storage-delete-now")}
        description={description}
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={pending || !hasRules}
            onClick={() => void deleteNow()}
          >
            {pending ? "Deleting…" : "Delete now"}
          </Button>
        }
      />
      {report && (
        <Collapsible>
          <CollapsibleTrigger className="group flex min-h-10 w-full items-center gap-1.5 rounded-b-xl px-3 text-left text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-panel-open:rounded-none sm:px-4">
            <ChevronRightIcon
              aria-hidden
              className="size-3.5 shrink-0 transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
            />
            Last run
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="border-t border-border/50 [&>*+*]:border-t [&>*+*]:border-border/50">
              <CleanupResults report={report} />
            </div>
          </CollapsiblePanel>
        </Collapsible>
      )}
    </SettingsSection>
  );
}

/** Retention for browser captures and rotated logs, and the manual run that covers worktrees too. */
export function StorageCleanupSections() {
  const environmentId = usePrimaryEnvironmentId();
  const settings = usePrimarySettings((value) => value.storageCleanup);
  const updateSettings = useUpdatePrimarySettings();
  const update = (patch: Partial<StorageCleanupSettings>) =>
    updateSettings({ storageCleanup: patch });

  return (
    <>
      <SettingsSection id={searchableSetting("storage-artifacts").id} title="Artifacts and logs">
        <SettingsRow
          title="Delete old browser artifacts"
          description="Delete saved browser captures after this many days. Older capture links will no longer open."
          control={
            <RetentionControl
              label="Delete old browser artifacts"
              value={settings.browserArtifactsAfterDays}
              onChange={(browserArtifactsAfterDays) => update({ browserArtifactsAfterDays })}
            />
          }
        />
        <SettingsRow
          title="Delete old rotated logs"
          description="Delete inactive rotated log files after this many days. Current logs are kept."
          control={
            <RetentionControl
              label="Delete old rotated logs"
              value={settings.logsAfterDays}
              onChange={(logsAfterDays) => update({ logsAfterDays })}
            />
          }
        />
      </SettingsSection>
      {environmentId !== null && <CleanupSection environmentId={environmentId} />}
    </>
  );
}
