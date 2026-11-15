import { useRef } from "react";
import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const KEYS = ["threadTitleInstructions"] as const;

/** Instructions appended to title generation; a project can override them from the page scope. */
export function ThreadTitleInstructionsSettings() {
  const value = useScopedSettings((settings) => settings.threadTitleInstructions);
  const mixed = useScopedSettingsMixed(KEYS);
  const updateSettings = useUpdateScopedSettings();
  const edited = useRef(false);
  return (
    <SettingsRow
      {...searchableSetting("thread-title-instructions")}
      description="Appended to the prompt for new and regenerated thread titles."
      serverScoped
      settingKeys={KEYS}
      resetAction={
        value !== "" || mixed ? (
          <SettingResetButton
            label="thread title instructions"
            onClick={() => updateSettings({ threadTitleInstructions: "" })}
          />
        ) : null
      }
    >
      <div className="mt-3 max-w-2xl pb-3.5">
        <Textarea
          key={`${mixed}:${value}`}
          aria-label="Thread title instructions"
          rows={4}
          defaultValue={mixed ? "" : value}
          placeholder={
            mixed
              ? "Mixed. Enter instructions to apply to all selected targets."
              : "Keep titles to a few words. Lead with the main subject."
          }
          onChange={() => {
            edited.current = true;
          }}
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (edited.current && (mixed || next !== value))
              updateSettings({ threadTitleInstructions: next });
            edited.current = false;
          }}
        />
      </div>
    </SettingsRow>
  );
}
