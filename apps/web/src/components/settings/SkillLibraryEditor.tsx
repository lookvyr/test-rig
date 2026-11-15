import { useEffect, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  BoldIcon,
  CodeIcon,
  Heading2Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
} from "lucide-react";
import type {
  ProjectId,
  SkillLibraryAssignment,
  SkillLibraryDetail,
  SkillLibrarySourceDetail,
  SkillLibraryUpsertInput,
} from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { PullRequestMarkdown } from "../pull-requests/PullRequestMarkdown";
import {
  ProviderToggles,
  ToolField,
  type ToolToggle,
  type ToolsProject,
} from "./ToolsAvailability";
import { ToolsProjectsDialog } from "./ToolsProjectsDialog";
import { SkillGlyph } from "./ToolStatusDot";
import { assignmentSummary, insertMarkdown, type MarkdownTool } from "./toolsSettings.logic";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

const MARKDOWN_TOOLS = [
  { tool: "bold", label: "Bold", icon: BoldIcon },
  { tool: "italic", label: "Italic", icon: ItalicIcon },
  { tool: "heading", label: "Heading", icon: Heading2Icon },
  { tool: "list", label: "List", icon: ListIcon },
  { tool: "link", label: "Link", icon: LinkIcon },
  { tool: "code", label: "Code block", icon: CodeIcon },
] as const;

type SkillPatch = Partial<Pick<SkillLibraryUpsertInput, "assignment">>;

/**
 * One skill's page. Name, description and instructions wait for Save;
 * the switch, projects and providers save at once for a saved skill.
 */
export function SkillLibraryEditor({
  detail,
  projects,
  unavailableProjectIds,
  initialAssignment,
  onSave,
  onPatch,
  onToggle,
  onDelete,
  onBack,
  readOnly = false,
  source,
  onCopy,
  onCreated,
  disabled = false,
}: {
  detail: SkillLibraryDetail | SkillLibrarySourceDetail | null;
  projects: readonly ToolsProject[];
  unavailableProjectIds?: readonly ProjectId[] | undefined;
  initialAssignment?: SkillLibraryAssignment;
  onSave: (draft: SkillLibraryUpsertInput) => Promise<SkillLibraryDetail>;
  onPatch?: ((change: SkillPatch) => Promise<void>) | undefined;
  /** Switch and provider changes on a saved skill; they show at once and save in the background. */
  onToggle?: ((change: ToolToggle) => void) | undefined;
  onDelete?: (() => Promise<void>) | undefined;
  onBack: () => void;
  readOnly?: boolean;
  source?: string;
  onCopy?: (() => Promise<void>) | undefined;
  onCreated?: ((id: string) => void) | undefined;
  disabled?: boolean;
}) {
  const saved = detail && "id" in detail ? detail : null;
  const [draft, setDraft] = useState<SkillLibraryUpsertInput>(() =>
    detail
      ? {
          ...(saved ? { id: saved.id } : {}),
          name: detail.name,
          description: detail.description,
          instructions: detail.instructions,
          assignment: saved?.assignment ?? initialAssignment ?? ALL_PROJECTS,
          providers: saved?.providers ?? ["codex", "claudeAgent"],
        }
      : {
          name: "",
          description: "",
          instructions: "",
          assignment: initialAssignment ?? ALL_PROJECTS,
          providers: ["codex", "claudeAgent"],
        },
  );
  const [view, setView] = useState("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingProjects, setEditingProjects] = useState(false);
  const textOf = (value: Pick<SkillLibraryUpsertInput, "name" | "description" | "instructions">) =>
    JSON.stringify([value.name, value.description, value.instructions]);
  const [baseline, setBaseline] = useState(() => textOf(draft));
  const isNew = !saved && !readOnly;
  const dirty =
    !readOnly && (isNew ? textOf(draft) !== textOf(EMPTY_TEXT) : textOf(draft) !== baseline);
  // A saved skill's projects and providers come from the stored copy; a new one keeps them locally.
  const assignment = saved && onPatch ? saved.assignment : draft.assignment;
  const providers = saved && onPatch ? saved.providers : draft.providers;
  const navigationAfterSave = useRef(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !navigationAfterSave.current,
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  useEffect(() => {
    if (!dirty && !busy && blocker.status === "blocked") blocker.proceed();
  }, [dirty, busy, blocker]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const update = (patch: Partial<SkillLibraryUpsertInput>) => {
    navigationAfterSave.current = false;
    setDraft({ ...draft, ...patch });
  };
  const format = (tool: MarkdownTool) => {
    const element = textarea.current;
    if (!element) return;
    const result = insertMarkdown(
      draft.instructions,
      element.selectionStart,
      element.selectionEnd,
      tool,
    );
    update({ instructions: result.text });
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(result.start, result.end);
    });
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The skill could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const patch = (change: SkillPatch) =>
    saved && onPatch ? run(() => onPatch(change)) : Promise.resolve(update(change));
  const save = () =>
    void run(async () => {
      if (!draft.name.trim()) throw new Error("Add a skill name.");
      if (!draft.instructions.trim()) throw new Error("Add instructions for this skill.");
      if (!providers.length) throw new Error("Choose at least one provider.");
      const canonical = await onSave({ ...draft, name: draft.name.trim(), assignment, providers });
      navigationAfterSave.current = true;
      setBaseline(textOf(draft));
      toastManager.add({ type: "success", title: "Skill saved", timeout: 2000 });
      if (!draft.id) onCreated?.(canonical.id);
    });
  const discard = () => {
    if (!saved) return;
    setDraft({
      ...draft,
      name: saved.name,
      description: saved.description,
      instructions: saved.instructions,
    });
    setError("");
  };
  return (
    <SettingsPageContainer className="gap-8 pb-24">
      <div className="space-y-4 px-3 sm:px-4">
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2.5 w-fit text-muted-foreground"
          onClick={onBack}
          disabled={busy}
        >
          <ArrowLeftIcon className="size-4" />
          Tools
        </Button>
        <div className="flex items-center gap-3">
          <SkillGlyph />
          <h1 className="mr-auto min-w-0 truncate text-2xl font-semibold tracking-tight">
            {readOnly ? detail?.name : saved ? saved.name : "New skill"}
          </h1>
          {readOnly ? (
            <Button
              onClick={() =>
                void run(async () => {
                  await onCopy?.();
                  toastManager.add({
                    type: "success",
                    title: "Skill copied to library",
                    timeout: 3000,
                  });
                })
              }
              disabled={busy || disabled || !onCopy}
            >
              Copy to library
            </Button>
          ) : saved && onToggle ? (
            <Switch
              aria-label={`${saved.enabled ? "Disable" : "Enable"} ${saved.name}`}
              checked={saved.enabled}
              disabled={disabled}
              onCheckedChange={(enabled) => onToggle?.({ enabled })}
            />
          ) : null}
        </div>
        {source ? (
          <p className="break-all font-mono text-xs text-muted-foreground">{source}</p>
        ) : null}
      </div>
      <fieldset disabled={busy || disabled} className="contents">
        <SettingsSection title="Details" hideTitle>
          <ToolField label="Name">
            <Input
              aria-label="Skill name"
              value={draft.name}
              readOnly={readOnly}
              onChange={(event) => update({ name: event.currentTarget.value })}
              placeholder="my-skill"
              maxLength={128}
              autoFocus={isNew}
            />
          </ToolField>
          <ToolField label="Description">
            <Input
              aria-label="Skill description"
              value={draft.description}
              readOnly={readOnly}
              onChange={(event) => update({ description: event.currentTarget.value })}
              placeholder="When to use it"
              maxLength={2000}
            />
          </ToolField>
        </SettingsSection>
        <SettingsSection title="Instructions" variant="plain">
          {readOnly ? (
            <div className="min-h-80 rounded-xl border p-5">
              <PullRequestMarkdown text={draft.instructions} />
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 p-2">
                <div className="flex gap-0.5" aria-label="Markdown formatting">
                  {MARKDOWN_TOOLS.map(({ tool, label, icon: Icon }) => (
                    <Button
                      key={tool}
                      size="icon-sm"
                      variant="ghost"
                      aria-label={label}
                      title={label}
                      disabled={view === "preview"}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => format(tool)}
                    >
                      <Icon className="size-4" />
                    </Button>
                  ))}
                </div>
                <div className="flex gap-0.5">
                  {["edit", "preview", "split"].map((value) => (
                    <Button
                      key={value}
                      size="xs"
                      variant={view === value ? "secondary" : "ghost"}
                      className={value === "split" ? "hidden lg:inline-flex" : undefined}
                      aria-pressed={view === value}
                      onClick={() => setView(value)}
                    >
                      {value === "edit" ? "Edit" : value === "preview" ? "Preview" : "Split"}
                    </Button>
                  ))}
                </div>
              </div>
              <div className={view === "split" ? "grid lg:grid-cols-2" : ""}>
                {view !== "preview" ? (
                  <textarea
                    ref={textarea}
                    aria-label="Skill instructions Markdown"
                    value={draft.instructions}
                    onChange={(event) => update({ instructions: event.currentTarget.value })}
                    spellCheck={false}
                    placeholder={"# Instructions\n\nWhat should the agent do?"}
                    className="min-h-[min(50vh,32rem)] w-full resize-y bg-background p-5 font-mono text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  />
                ) : null}
                {view !== "edit" ? (
                  <div
                    className={`min-h-[min(50vh,32rem)] overflow-auto p-5 ${view === "split" ? "border-t lg:border-t-0 lg:border-l" : ""}`}
                  >
                    <PullRequestMarkdown text={draft.instructions || "Nothing to preview yet."} />
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </SettingsSection>
        {readOnly ? null : (
          <SettingsSection title="Availability">
            <ToolField label="Projects">
              <button
                type="button"
                onClick={() => setEditingProjects(true)}
                className="rounded-md px-2 py-1 text-sm text-muted-foreground tabular-nums outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {assignmentSummary(assignment, projects)}
              </button>
            </ToolField>
            <ToolField label="Providers">
              <ProviderToggles
                providers={providers}
                onChange={(next) =>
                  saved && onToggle ? onToggle({ providers: next }) : update({ providers: next })
                }
              />
            </ToolField>
          </SettingsSection>
        )}
      </fieldset>
      {error ? (
        <p role="alert" className="px-3 text-sm text-destructive sm:px-4">
          {error}
        </p>
      ) : null}
      {onDelete && !readOnly ? (
        <div className="flex items-center gap-2 px-3 sm:px-4">
          {confirmDelete ? (
            <>
              <span className="text-sm">Delete {saved?.name}?</span>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy || disabled}
                onClick={() =>
                  void run(async () => {
                    await onDelete();
                    navigationAfterSave.current = true;
                    onBack();
                  })
                }
              >
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="-ml-2.5 text-destructive hover:text-destructive"
              disabled={disabled}
              onClick={() => setConfirmDelete(true)}
            >
              Delete skill
            </Button>
          )}
        </div>
      ) : null}
      {isNew || dirty ? (
        <div className="sticky bottom-4 z-20 mx-3 flex items-center justify-end gap-2 rounded-xl border bg-popover/95 p-2 shadow-lg backdrop-blur sm:mx-4">
          <Button variant="ghost" disabled={busy} onClick={() => (isNew ? onBack() : discard())}>
            {isNew ? "Cancel" : "Discard"}
          </Button>
          <Button disabled={busy || disabled} onClick={save}>
            {busy ? "Saving…" : isNew ? "Create skill" : "Save"}
          </Button>
        </div>
      ) : null}
      {editingProjects ? (
        <ToolsProjectsDialog
          toolName={draft.name || "New skill"}
          projects={projects}
          unavailableProjectIds={unavailableProjectIds}
          assignment={assignment}
          onClose={() => setEditingProjects(false)}
          onSave={(next) => patch({ assignment: next })}
        />
      ) : null}
      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>Your changes to this skill have not been saved.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => blocker.reset?.()}>
              Keep editing
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => blocker.proceed?.()}>
              Discard changes
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </SettingsPageContainer>
  );
}

const ALL_PROJECTS: SkillLibraryAssignment = {
  allProjects: true,
  projectIds: [],
  disabledProjectIds: [],
};
const EMPTY_TEXT = { name: "", description: "", instructions: "" };
