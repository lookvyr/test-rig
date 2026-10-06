import { useRef } from "react";
import { BranchNamingMode, DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";

import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { useProjectSettingsScope } from "./ProjectSettingsScope";
import { searchableSetting } from "./settingsSearch";

type NamingKey = "branchNamingMode" | "branchNamePrefix" | "branchNameInstructions";
const MODES = {
  static: "Static prefix",
  semantic: "Semantic prefix",
  custom: "Custom instructions",
} satisfies Record<BranchNamingMode, string>;

export function BranchNamingSettings() {
  const scope = useProjectSettingsScope();
  const { settings } = scope;
  const prefixEdited = useRef(false);
  const instructionsEdited = useRef(false);
  const modeMixed = scope.isMixed("branchNamingMode");
  const prefixMixed = scope.isMixed("branchNamePrefix");
  const instructionsMixed = scope.isMixed("branchNameInstructions");
  const resetAction = (key: NamingKey, label: string) => {
    const isProject = scope.projectIds !== null;
    const hasOverride = scope.source(key) !== "environment";
    const changed = scope.isMixed(key) || settings[key] !== DEFAULT_SERVER_SETTINGS[key];
    return (isProject ? hasOverride : changed) ? (
      <SettingResetButton
        label={label}
        onClick={() => {
          if (isProject) scope.clear(key);
          else scope.update({ [key]: DEFAULT_SERVER_SETTINGS[key] });
        }}
      />
    ) : null;
  };
  const status = (key: NamingKey) => {
    if (scope.projectIds === null) return undefined;
    const source = scope.source(key);
    return source === "environment"
      ? "Inherited from All projects"
      : source === "project"
        ? "Project override"
        : "Some checkouts override this setting";
  };

  return (
    <>
      <SettingsRow
        {...searchableSetting("worktree-branch-naming")}
        description="Choose how new worktree branches are named from your first message."
        status={status("branchNamingMode")}
        resetAction={resetAction("branchNamingMode", "branch naming")}
        control={
          <Select
            value={modeMixed ? null : settings.branchNamingMode}
            onValueChange={(value) => {
              if (BranchNamingMode.literals.includes(value as BranchNamingMode)) {
                scope.update({ branchNamingMode: value as BranchNamingMode });
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
          status={status("branchNamePrefix")}
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
                  scope.update({ branchNamePrefix: value });
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
          status={status("branchNameInstructions")}
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
                  scope.update({ branchNameInstructions: value });
                instructionsEdited.current = false;
              }}
            />
          </div>
        </SettingsRow>
      ) : null}
    </>
  );
}
