import { AdvancedSettings } from "./AdvancedSettings";
import { useEffect, useRef, useState } from "react";
import type { SourceControlWritingStyleMode } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveSourceControlWriterModelSelection } from "@t3tools/shared/serverSettings";

import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { ScopedSwitch } from "./ScopedSwitch";

const MODE_OPTIONS: Record<SourceControlWritingStyleMode, { label: string; description: string }> =
  {
    repo_conventions: {
      label: "Repository conventions",
      description: "In each project, matches recent change descriptions and change request titles.",
    },
    conventional_commits: {
      label: "Conventional Commits",
      description:
        "Uses Conventional Commit prefixes for change descriptions; change request titles and descriptions stay concise.",
    },
    custom: {
      label: "Default",
      description: "Uses Test Rig's concise default source control writing style.",
    },
  };

const INSTRUCTION_OPTIONS = [
  {
    key: "commitInstructions",
    label: "Commit messages",
    placeholder: "For example: Start with an imperative verb and keep the body to two bullets.",
  },
  {
    key: "changeRequestTitleInstructions",
    label: "PR titles",
    placeholder: "For example: Use sentence case and avoid Conventional Commit prefixes.",
  },
  {
    key: "changeRequestDescriptionInstructions",
    label: "PR descriptions",
    placeholder: "For example: Lead with user impact and list only checks that were actually run.",
  },
] as const;

type InstructionKey = (typeof INSTRUCTION_OPTIONS)[number]["key"];

function instructionDrafts(style: {
  readonly commitInstructions: string;
  readonly changeRequestTitleInstructions: string;
  readonly changeRequestDescriptionInstructions: string;
}) {
  return {
    commitInstructions: style.commitInstructions,
    changeRequestTitleInstructions: style.changeRequestTitleInstructions,
    changeRequestDescriptionInstructions: style.changeRequestDescriptionInstructions,
  };
}

/** Repository behavior for the page scope: how merges are written. */
export function RepositoriesSettingsSection() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsSection title="Repositories">
      <SettingsRow
        {...searchableSetting("auto-pull")}
        description="Keep the default branch current on clean checkouts by pulling when the remote is ahead and you have no local commits or edits."
        resetAction={
          settings.defaultAutoPull !== DEFAULT_UNIFIED_SETTINGS.defaultAutoPull ? (
            <SettingResetButton
              label="automatically pull"
              onClick={() =>
                updateSettings({ defaultAutoPull: DEFAULT_UNIFIED_SETTINGS.defaultAutoPull })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.defaultAutoPull}
            onCheckedChange={(checked) => updateSettings({ defaultAutoPull: Boolean(checked) })}
            aria-label="Automatically pull"
          />
        }
      />
      <SettingsRow
        {...searchableSetting("remove-agent-credits")}
        serverScoped
        settingKeys={["removeAgentCreditsOnMerge"]}
        description="Strip agent co-author lines and generated-by footers from the merge commit message when merging a pull request."
        resetAction={
          settings.removeAgentCreditsOnMerge !==
          DEFAULT_UNIFIED_SETTINGS.removeAgentCreditsOnMerge ? (
            <SettingResetButton
              label="remove agent credits when merging"
              onClick={() =>
                updateSettings({
                  removeAgentCreditsOnMerge: DEFAULT_UNIFIED_SETTINGS.removeAgentCreditsOnMerge,
                })
              }
            />
          ) : null
        }
        control={
          <ScopedSwitch
            settingKeys={["removeAgentCreditsOnMerge"]}
            checked={settings.removeAgentCreditsOnMerge}
            onCheckedChange={(checked) =>
              updateSettings({ removeAgentCreditsOnMerge: Boolean(checked) })
            }
            aria-label="Remove agent credits when merging"
          />
        }
      />
    </SettingsSection>
  );
}

export function SourceControlWritingSettingsSection() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { environment } = useSettingsScope();
  const serverProviders = environment?.serverConfig?.providers ?? EMPTY_SERVER_PROVIDERS;
  const style = settings.sourceControlWritingStyle;
  const defaults = DEFAULT_UNIFIED_SETTINGS.sourceControlWritingStyle;
  const [activeInstruction, setActiveInstruction] = useState<InstructionKey>("commitInstructions");
  const [drafts, setDrafts] = useState(() => instructionDrafts(style));
  const dirtyFieldsRef = useRef(new Set<InstructionKey>());
  const isSourceControlWritingStyleDirty = style.mode !== defaults.mode;

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      let changed = false;
      for (const option of INSTRUCTION_OPTIONS) {
        if (!dirtyFieldsRef.current.has(option.key) && next[option.key] !== style[option.key]) {
          next[option.key] = style[option.key];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [
    style.commitInstructions,
    style.changeRequestTitleInstructions,
    style.changeRequestDescriptionInstructions,
  ]);

  const activeOption = INSTRUCTION_OPTIONS.find((option) => option.key === activeInstruction)!;
  const saveInstruction = (key: InstructionKey, value: string) => {
    const trimmed = value.trim();
    dirtyFieldsRef.current.delete(key);
    setDrafts((current) => ({ ...current, [key]: trimmed }));
    if (trimmed !== style[key]) {
      updateSettings({ sourceControlWritingStyle: { [key]: trimmed } });
    }
  };

  const defaultModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const usesDedicatedModel = settings.sourceControlWriterModelSelection !== null;
  const resolvedSourceControlWriterSelection = resolveSourceControlWriterModelSelection(
    settings,
    serverProviders,
  );
  const activeSelection =
    resolvedSourceControlWriterSelection === settings.textGenerationModelSelection
      ? defaultModelSelection
      : resolvedSourceControlWriterSelection;
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
  );
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    serverProviders,
    activeSelection.instanceId,
    activeSelection.model,
  );

  return (
    <SettingsSection title="Commits & pull requests">
      <SettingsRow
        title="Source control writing style"
        serverScoped
        settingKeys={["sourceControlWritingStyle"]}
        description={MODE_OPTIONS[style.mode].description}
        resetAction={
          isSourceControlWritingStyleDirty ? (
            <SettingResetButton
              label="source control writing style"
              onClick={() =>
                updateSettings({
                  sourceControlWritingStyle: {
                    mode: defaults.mode,
                  },
                })
              }
            />
          ) : null
        }
        control={
          <Select
            value={style.mode}
            onValueChange={(value) => {
              updateSettings({
                sourceControlWritingStyle: {
                  mode: value as SourceControlWritingStyleMode,
                },
              });
            }}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label="Source control writing style">
              <SelectValue>{MODE_OPTIONS[style.mode].label}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(Object.keys(MODE_OPTIONS) as SourceControlWritingStyleMode[]).map((mode) => (
                <SelectItem key={mode} hideIndicator value={mode}>
                  {MODE_OPTIONS[mode].label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />

      <SettingsRow
        title="Additional writing instructions"
        serverScoped
        settingKeys={["sourceControlWritingStyle"]}
        description="Use these to fine-tune generated text. They take precedence when they conflict with the selected writing style."
      >
        <div className="mt-3 max-w-2xl space-y-3 pb-3.5">
          <ToggleGroup
            aria-label="Writing instruction type"
            size="sm"
            variant="outline"
            value={[activeInstruction]}
            onValueChange={(value) => {
              const next = value[0];
              if (INSTRUCTION_OPTIONS.some((option) => option.key === next)) {
                setActiveInstruction(next as InstructionKey);
              }
            }}
          >
            {INSTRUCTION_OPTIONS.map((option) => (
              <Toggle key={option.key} value={option.key}>
                {option.label}
              </Toggle>
            ))}
          </ToggleGroup>
          <Textarea
            value={drafts[activeInstruction]}
            onChange={(event) => {
              dirtyFieldsRef.current.add(activeInstruction);
              setDrafts((current) => ({
                ...current,
                [activeInstruction]: event.target.value,
              }));
            }}
            onBlur={(event) => saveInstruction(activeInstruction, event.target.value)}
            maxLength={4_000}
            rows={4}
            placeholder={activeOption.placeholder}
            aria-label={`${activeOption.label} additional writing instructions`}
          />
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>Applies to the projects selected above.</span>
            <div className="flex items-center gap-2">
              <span>{drafts[activeInstruction].length.toLocaleString()} / 4,000</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={drafts[activeInstruction].length === 0}
                onClick={() => saveInstruction(activeInstruction, "")}
              >
                Clear
              </Button>
            </div>
          </div>
        </div>
      </SettingsRow>

      <AdvancedSettings targetIds={[]}>
        <SettingsRow
          title="Follow change request templates"
          serverScoped
          settingKeys={["sourceControlWritingStyle"]}
          description="Structures change request descriptions using the current repository's template when one is available."
          resetAction={
            style.followChangeRequestTemplates !== defaults.followChangeRequestTemplates ? (
              <SettingResetButton
                label="change request templates"
                onClick={() =>
                  updateSettings({
                    sourceControlWritingStyle: {
                      followChangeRequestTemplates: defaults.followChangeRequestTemplates,
                    },
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={style.followChangeRequestTemplates}
              onCheckedChange={(checked) =>
                updateSettings({
                  sourceControlWritingStyle: {
                    followChangeRequestTemplates: Boolean(checked),
                  },
                })
              }
              aria-label="Follow change request templates"
            />
          }
        />

        <SettingsRow
          title="Source control writer model"
          serverScoped
          settingKeys={["sourceControlWriterModelSelection"]}
          description="Optional model override for change descriptions, change request titles and descriptions, and branch or bookmark names. Off uses the global text generation model."
          control={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {usesDedicatedModel ? (
                <ProviderModelPicker
                  activeInstanceId={activeSelection.instanceId}
                  model={activeSelection.model}
                  lockedProvider={null}
                  instanceEntries={instanceEntries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  triggerVariant="outline"
                  triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                  triggerAriaLabel="Source control writer model"
                  onInstanceModelChange={(instanceId, model) => {
                    updateSettings({
                      sourceControlWriterModelSelection: createModelSelection(instanceId, model),
                    });
                  }}
                />
              ) : null}
              <Switch
                checked={usesDedicatedModel}
                onCheckedChange={(checked) =>
                  updateSettings({
                    sourceControlWriterModelSelection: checked
                      ? createModelSelection(
                          defaultModelSelection.instanceId,
                          defaultModelSelection.model,
                          defaultModelSelection.options,
                        )
                      : null,
                  })
                }
                aria-label="Use a separate source control writer model"
              />
            </div>
          }
        />
      </AdvancedSettings>
    </SettingsSection>
  );
}
