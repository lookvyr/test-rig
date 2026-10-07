import {
  DEFAULT_SERVER_SETTINGS,
  type ScopedProjectRef,
  type ResolvedServerSettings,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../state/server";
import { readProject } from "../state/entities";
import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { hasExplicitComposerModelSelection } from "./chatThreadActions";
import { readT3ProjectFile } from "./t3ProjectFileDefaults";

/** Resolve the destination environment and project before configuring a draft. */
export async function resolveDraftProjectDefaults(projectRef: ScopedProjectRef) {
  const project = readProject(projectRef);
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(projectRef.environmentId);
  const settings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
  const resolved = resolveProjectSettings(settings, projectRef.projectId, project);
  const projectFile =
    project && resolved.settings.defaultThreadEnvMode === null
      ? await readT3ProjectFile(projectRef.environmentId, project.workspaceRoot)
      : null;
  return resolveProjectSettings(settings, projectRef.projectId, project, projectFile).settings;
}

/** Retarget the same composer session, retaining its content and deliberate choices. */
export function retargetDraftProject(input: {
  draftId: DraftId;
  projectRef: ScopedProjectRef;
  logicalProjectKey: string;
  defaults: ResolvedServerSettings;
  scratch: boolean;
}) {
  const store = useComposerDraftStore.getState();
  const currentDraft = store.getComposerDraft(input.draftId);
  const envMode = input.scratch ? "local" : input.defaults.defaultThreadEnvMode;
  store.setLogicalProjectDraftThreadId(input.logicalProjectKey, input.projectRef, input.draftId, {
    branch: null,
    worktreePath: null,
    envMode,
    startFromOrigin: envMode === "worktree" && input.defaults.newWorktreesStartFromOrigin,
    runtimeMode: input.defaults.defaultRuntimeMode,
  });
  if (!hasExplicitComposerModelSelection(currentDraft)) {
    store.applyStickyState(input.draftId);
    const sticky = store.stickyActiveProvider
      ? store.stickyModelSelectionByProvider[store.stickyActiveProvider]
      : null;
    const selection = input.defaults.defaultModelSelection ?? sticky;
    if (selection) store.setModelSelection(input.draftId, selection, { replaceOptions: true });
  }
}
