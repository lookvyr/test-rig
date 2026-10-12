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
  Trash2Icon,
} from "lucide-react";
import type {
  SkillLibraryDetail,
  SkillLibrarySourceDetail,
  SkillLibraryUpsertInput,
} from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
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
  ProviderAvailability,
  ProjectChoices,
  ToolsSelect,
  type ToolsProject,
} from "./ToolsAvailability";
import {
  EMPTY_SKILL_ASSIGNMENT,
  insertMarkdown,
  selectedSkillScopes,
  setSelectedSkillScopes,
  type MarkdownTool,
} from "./toolsSettings.logic";
import { SettingsPageContainer } from "./settingsLayout";

const MARKDOWN_TOOLS = [
  { tool: "bold", label: "Bold", icon: BoldIcon },
  { tool: "italic", label: "Italic", icon: ItalicIcon },
  { tool: "heading", label: "Heading", icon: Heading2Icon },
  { tool: "list", label: "List", icon: ListIcon },
  { tool: "link", label: "Link", icon: LinkIcon },
  { tool: "code", label: "Code block", icon: CodeIcon },
] as const;

export function SkillLibraryEditor({
  detail,
  projects,
  initialTab = "instructions",
  onSave,
  onDelete,
  onBack,
  readOnly = false,
  source,
  onCopy,
  onCreated,
  disabled = false,
  statusMessage,
}: {
  detail: SkillLibraryDetail | SkillLibrarySourceDetail | null;
  projects: readonly ToolsProject[];
  initialTab?: string | undefined;
  onSave: (draft: SkillLibraryUpsertInput) => Promise<SkillLibraryDetail>;
  onDelete?: (() => Promise<void>) | undefined;
  onBack: () => void;
  readOnly?: boolean;
  source?: string;
  onCopy?: (() => Promise<void>) | undefined;
  onCreated?: ((id: string) => void) | undefined;
  disabled?: boolean;
  statusMessage?: string | undefined;
}) {
  const [draft, setDraft] = useState<SkillLibraryUpsertInput>(() =>
    detail
      ? {
          ...("id" in detail ? { id: detail.id } : {}),
          name: detail.name,
          description: detail.description,
          instructions: detail.instructions,
          assignment: "assignment" in detail ? detail.assignment : EMPTY_SKILL_ASSIGNMENT,
          providers:
            "providers" in detail ? detail.providers : ["codex", "claudeAgent", "opencode"],
        }
      : {
          name: "",
          description: "",
          instructions: "",
          assignment: EMPTY_SKILL_ASSIGNMENT,
          providers: ["codex", "claudeAgent", "opencode"],
        },
  );
  const [tab, setTab] = useState(initialTab);
  const [view, setView] = useState("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  const dirty = !readOnly && JSON.stringify(draft) !== baseline;
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
  const assignment = draft.assignment;
  const mode = assignment.allProjects
    ? "all"
    : assignment.projectIds.length || assignment.scopeIds?.length
      ? "selected"
      : "none";
  const [availabilityMode, setAvailabilityMode] = useState(mode);
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
  const save = () =>
    void run(async () => {
      if (!draft.name.trim()) throw new Error("Add a skill name.");
      if (!draft.instructions.trim()) throw new Error("Add instructions for this skill.");
      if (!draft.providers.length) throw new Error("Choose at least one provider.");
      if (
        availabilityMode === "selected" &&
        assignment.projectIds.length === 0 &&
        !assignment.scopeIds?.length
      )
        throw new Error("Select a project or choose No projects.");
      const canonical = await onSave({ ...draft, name: draft.name.trim() });
      navigationAfterSave.current = true;
      setBaseline(JSON.stringify(draft));
      toastManager.add({
        type: "success",
        title: "Skill saved",
        description:
          !canonical.assignment.allProjects &&
          canonical.assignment.projectIds.length === 0 &&
          !canonical.assignment.scopeIds?.length
            ? "Saved to the library; not enabled in any project."
            : undefined,
        timeout: 3000,
      });
      if (!draft.id) onCreated?.(canonical.id);
    });
  return (
    <SettingsPageContainer className="max-w-6xl gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button size="sm" variant="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeftIcon className="size-4" />
          Back to library
        </Button>
        <div className="flex items-center gap-2">
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
          ) : (
            <>
              {onDelete ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || disabled}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2Icon className="size-4" />
                  Delete
                </Button>
              ) : null}
              <Button disabled={busy || disabled} onClick={save}>
                {busy ? "Saving…" : detail ? "Save changes" : "Save to library"}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {readOnly ? detail?.name : detail ? "Edit skill" : "New skill"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {readOnly
            ? "This skill is managed outside Test Rig. Copy it to the library to edit a separate copy."
            : "One library copy. Edits apply wherever this skill is enabled."}
        </p>
        {source ? (
          <p className="break-all font-mono text-xs text-muted-foreground">{source}</p>
        ) : null}
      </div>
      {statusMessage ? (
        <p role="status" className="text-sm text-muted-foreground">
          {statusMessage}
        </p>
      ) : null}
      <fieldset disabled={busy || disabled} className="contents">
        {!readOnly ? (
          <div className="flex gap-1 border-b pb-2">
            {["instructions", "availability"].map((value) => (
              <Button
                key={value}
                size="sm"
                variant={tab === value ? "secondary" : "ghost"}
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
              >
                {value === "instructions" ? "Instructions" : "Availability"}
              </Button>
            ))}
          </div>
        ) : null}
        {readOnly || tab === "instructions" ? (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
              <label className="block space-y-1.5 text-sm font-medium">
                Name
                <Input
                  value={draft.name}
                  readOnly={readOnly}
                  onChange={(event) => update({ name: event.currentTarget.value })}
                  placeholder="my-skill"
                  maxLength={128}
                />
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                When to use it
                <Input
                  value={draft.description}
                  readOnly={readOnly}
                  onChange={(event) => update({ description: event.currentTarget.value })}
                  placeholder="Describe the task this skill handles"
                  maxLength={2000}
                />
              </label>
            </div>
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
                      className="min-h-[min(55vh,36rem)] w-full resize-y bg-background p-5 font-mono text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    />
                  ) : null}
                  {view !== "edit" ? (
                    <div
                      className={`min-h-[min(55vh,36rem)] overflow-auto p-5 ${view === "split" ? "border-t lg:border-t-0 lg:border-l" : ""}`}
                    >
                      <PullRequestMarkdown
                        text={draft.instructions || "Write instructions to preview them here."}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            )}
            {detail?.supportingFiles.length ? (
              <p className="text-xs text-muted-foreground">
                Supporting files retained: {detail.supportingFiles.join(", ")}
              </p>
            ) : null}
            {!detail && !readOnly ? (
              <p className="text-xs text-muted-foreground">
                New skills are saved to your library without being enabled in any project. Choose
                Availability to assign this skill.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="max-w-2xl space-y-6">
            <div className="space-y-2">
              <p className="text-sm font-medium">Available in</p>
              <ToolsSelect
                label="Skill project availability"
                value={availabilityMode}
                onChange={(value) => {
                  setAvailabilityMode(value);
                  update({
                    assignment:
                      value === "all"
                        ? { ...assignment, allProjects: true, projectIds: [], scopeIds: [] }
                        : value === "none"
                          ? EMPTY_SKILL_ASSIGNMENT
                          : {
                              ...assignment,
                              allProjects: false,
                              disabledProjectIds: [],
                              disabledScopeIds: [],
                            },
                  });
                }}
                options={[
                  { value: "none", label: "No projects · save for later" },
                  { value: "all", label: "All projects" },
                  { value: "selected", label: "Selected projects" },
                ]}
              />
            </div>
            {availabilityMode === "selected" ? (
              <ProjectChoices
                projects={projects}
                selected={selectedSkillScopes(assignment, projects)}
                onChange={(scopeIds) =>
                  update({ assignment: setSelectedSkillScopes(assignment, scopeIds, projects) })
                }
              />
            ) : null}
            {availabilityMode === "all" &&
            (assignment.disabledProjectIds.length || assignment.disabledScopeIds?.length) ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Off in{" "}
                  {[...assignment.disabledProjectIds, ...(assignment.disabledScopeIds ?? [])]
                    .map(
                      (id) =>
                        projects.find(
                          (project) =>
                            project.id === id ||
                            project.memberProjectIds.some((member) => member === id),
                        )?.name ?? "Unavailable project",
                    )
                    .join(", ")}
                  .
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    update({
                      assignment: { ...assignment, disabledProjectIds: [], disabledScopeIds: [] },
                    })
                  }
                >
                  Enable in every project
                </Button>
              </div>
            ) : null}
            <ProviderAvailability
              providers={draft.providers}
              onChange={(providers) => update({ providers })}
            />
            <p className="text-xs text-muted-foreground">
              Availability applies to new or restarted agent sessions.
            </p>
          </div>
        )}
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {confirmDelete ? (
        <div className="max-w-xl space-y-3 rounded-xl border border-destructive/30 p-4">
          <p className="text-sm">
            Delete {draft.name} from the library and every assigned project?
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || disabled}
              onClick={() =>
                void run(async () => {
                  await onDelete?.();
                  navigationAfterSave.current = true;
                  onBack();
                })
              }
            >
              Delete skill
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </div>
        </div>
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
