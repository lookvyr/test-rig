import { useEffect, useState } from "react";

import {
  useClientSettings,
  usePrimarySettings,
  useUpdateClientSettings,
  useUpdatePrimarySettings,
} from "../../hooks/useSettings";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const AUTO_SETTLE_MIN_DAYS = 1;
const AUTO_SETTLE_MAX_DAYS = 90;
const AUTO_SETTLE_DEFAULT_DAYS = 3;

function AutoSettleDaysInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (days: number) => void;
}) {
  // Local draft so the field can be emptied mid-edit; the setting only moves
  // on valid input and snaps back to the persisted value on blur.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <Input
      type="number"
      min={AUTO_SETTLE_MIN_DAYS}
      max={AUTO_SETTLE_MAX_DAYS}
      className="w-full sm:w-24"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        // Number(), not parseInt: "3.5" must be rejected (not truncated to a
        // committed 3 while the field shows 3.5) — commit only when the
        // persisted value matches the displayed one.
        const parsed = Number(event.target.value);
        if (
          Number.isInteger(parsed) &&
          parsed >= AUTO_SETTLE_MIN_DAYS &&
          parsed <= AUTO_SETTLE_MAX_DAYS
        ) {
          onCommit(parsed);
        }
      }}
      onBlur={() => setDraft(String(value))}
      aria-label="Days of inactivity before auto-settle"
    />
  );
}

export function BetaSettingsPanel() {
  const sidebarAutoSettleAfterDays = usePrimarySettings(
    (settings) => settings.sidebarAutoSettleAfterDays,
  );
  const sidebarAutoSettleOnMerge = usePrimarySettings(
    (settings) => settings.sidebarAutoSettleOnMerge,
  );
  const updatePrimarySettings = useUpdatePrimarySettings();
  const planModeEnabled = useClientSettings((settings) => settings.planModeEnabled);
  const workingShelfEnabled = useClientSettings((settings) => settings.sidebarWorkingShelfEnabled);
  const updateSettings = useUpdateClientSettings();

  return (
    <SettingsPageContainer>
      <SettingsSection title="Beta features">
        <SettingsRow
          {...searchableSetting("sidebar-working-shelf")}
          description="Move busy threads into a collapsed Working section. They return to the top when they finish or need your attention. Pinned threads stay visible."
          control={
            <Switch
              checked={workingShelfEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ sidebarWorkingShelfEnabled: Boolean(checked) })
              }
              aria-label="Working section"
            />
          }
        />
        <SettingsRow
          title={searchableSetting("auto-settle-inactive-threads").title}
          description="Idle threads with no activity for this long settle automatically."
          control={
            <Switch
              checked={sidebarAutoSettleAfterDays !== null}
              onCheckedChange={(checked) =>
                updatePrimarySettings({
                  sidebarAutoSettleAfterDays: checked ? AUTO_SETTLE_DEFAULT_DAYS : null,
                })
              }
              aria-label="Auto-settle inactive threads"
            />
          }
        />
        {sidebarAutoSettleAfterDays !== null ? (
          <SettingsRow
            title="Days of inactivity before auto-settle"
            description="Any new activity un-settles a thread automatically."
            control={
              <AutoSettleDaysInput
                value={sidebarAutoSettleAfterDays}
                onCommit={(days) => updatePrimarySettings({ sidebarAutoSettleAfterDays: days })}
              />
            }
          />
        ) : null}
        <SettingsRow
          {...searchableSetting("auto-settle-merged-threads")}
          description="Settle idle threads when their pull request is merged. Closed pull requests also settle when automatic settlement is enabled."
          control={
            <Switch
              checked={sidebarAutoSettleOnMerge}
              onCheckedChange={(checked) =>
                updatePrimarySettings({ sidebarAutoSettleOnMerge: Boolean(checked) })
              }
              aria-label="Auto-settle merged pull requests"
            />
          }
        />
        <SettingsRow
          {...searchableSetting("restore-plan-mode")}
          description="Legacy feature. Brings back the Build/Plan toggle in the composer along with the /plan and /default commands and the Shift+Tab shortcut. While off, every thread runs in build mode."
          control={
            <Switch
              checked={planModeEnabled}
              onCheckedChange={(checked) => updateSettings({ planModeEnabled: Boolean(checked) })}
              aria-label="Restore plan mode (legacy)"
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
