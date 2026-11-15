import { useRef } from "react";
import { BranchNamingMode, DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";

import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { searchableSetting } from "./settingsSearch";

type NamingKey = "branchNamingMode" | "branchNamePrefix" | "branchNameInstructions";
const MODES = {
  static: "Static prefix",
  semantic: "Semantic prefix",
  custom: "Custom instructions",
} satisfies Record<BranchNamingMode, string>;

const MODE_KEYS = ["branchNamingMode"] as const;
const PREFIX_KEYS = ["branchNamePrefix"] as const;
const INSTRUCTIONS_KEYS = ["branchNameInstructions"] as const;

/** Branch naming rows; a project selected in the page scope stores its own overrides. */
export function BranchNamingSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const prefixEdited = useRef(false);
  const instructionsEdited = useRef(false);
  const modeMixed = useScopedSettingsMixed(MODE_KEYS);
  const prefixMixed = useScopedSettingsMixed(PREFIX_KEYS);
  const instructionsMixed = useScopedSettingsMixed(INSTRUCTIONS_KEYS);
  const mixedByKey: Record<NamingKey, boolean> = {
    branchNamingMode: modeMixed,
    branchNamePrefix: prefixMixed,
    branchNameInstructions: instructionsMixed,
  };
  // Project overrides reset from the row itself, back to the inherited value.
  const resetAction = (key: NamingKey, label: string) =>
    mixedByKey[key] || settings[key] !== DEFAULT_SERVER_SETTINGS[key] ? (
      <SettingResetButton
        label={label}
        onClick={() => updateSettings({ [key]: DEFAULT_SERVER_SETTINGS[key] })}
      />
    ) : null;

  return (
    <>
      <SettingsRow
        {...searchableSetting("worktree-branch-naming")}
        description="Choose how new worktree branches are named from your first message."
        serverScoped
        settingKeys={MODE_KEYS}
        resetAction={resetAction("branchNamingMode", "branch naming")}
        control={
          <Select
            value={modeMixed ? null : settings.branchNamingMode}
            onValueChange={(value) => {
              if (BranchNamingMode.literals.includes(value as BranchNamingMode)) {
                updateSettings({ branchNamingMode: value as BranchNamingMode });
              }
            }}
          >
            <SelectTrigger size="sm" aria-label="Worktree branch naming">
              <SelectValue>
                {(value: BranchNamingMode | null) => (value === null ? "Mixed" : MODES[value])}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {BranchNamingMode.literals.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {MODES[mode]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {!modeMixed && settings.branchNamingMode === "static" ? (
        <SettingsRow
          title="Branch prefix"
          description="For example, test-rig or test-rig/ produces test-rig/add-search. Leave empty for no prefix."
          serverScoped
          settingKeys={PREFIX_KEYS}
          resetAction={resetAction("branchNamePrefix", "branch prefix")}
          control={
            <Input
              key={`${prefixMixed}:${settings.branchNamePrefix}`}
              aria-label="Branch prefix"
              autoCapitalize="none"
              spellCheck={false}
              onChange={() => {
                prefixEdited.current = true;
              }}
              placeholder={prefixMixed ? "Mixed" : "No prefix"}
              defaultValue={prefixMixed ? "" : settings.branchNamePrefix}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (prefixEdited.current && (prefixMixed || value !== settings.branchNamePrefix))
                  updateSettings({ branchNamePrefix: value });
                prefixEdited.current = false;
              }}
            />
          }
        />
      ) : null}
      {!modeMixed && settings.branchNamingMode === "semantic" ? (
        <p className="px-3 pb-3 text-sm text-muted-foreground sm:px-4">
          The model chooses a prefix that describes the work, such as feat/add-search,
          fix/login-timeout, or refactor/auth.
        </p>
      ) : null}
      {!modeMixed && settings.branchNamingMode === "custom" ? (
        <SettingsRow
          title="Branch naming instructions"
          description="Appended to the naming prompt. The model returns the complete branch name; no prefix or suffix is added."
          serverScoped
          settingKeys={INSTRUCTIONS_KEYS}
          resetAction={resetAction("branchNameInstructions", "branch naming instructions")}
        >
          <div className="mt-3 max-w-2xl pb-3.5">
            <Textarea
              key={`${instructionsMixed}:${settings.branchNameInstructions}`}
              aria-label="Branch naming instructions"
              onChange={() => {
                instructionsEdited.current = true;
              }}
              rows={4}
              defaultValue={instructionsMixed ? "" : settings.branchNameInstructions}
              placeholder={
                instructionsMixed
                  ? "Mixed. Enter instructions to apply to all selected targets."
                  : "Use the issue ID followed by a short description."
              }
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (
                  instructionsEdited.current &&
                  (instructionsMixed || value !== settings.branchNameInstructions)
                )
                  updateSettings({ branchNameInstructions: value });
                instructionsEdited.current = false;
              }}
            />
          </div>
        </SettingsRow>
      ) : null}
    </>
  );
}

/** Branch naming rows on the Worktrees page; they follow the page scope. */
export function BranchNamingSection() {
  return <BranchNamingSettings />;
}
