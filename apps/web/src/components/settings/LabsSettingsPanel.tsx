import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import {
  useClientSettings,
  usePrimarySettings,
  useUpdateClientSettings,
  useUpdatePrimarySettings,
} from "../../hooks/useSettings";
import { primaryServerConfigAtom } from "../../state/server";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { ScopedSwitch } from "./ScopedSwitch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

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

/** Sidebar toggle for folding busy threads into a Working section. */
export function SidebarWorkingShelfRow() {
  const workingShelfEnabled = useClientSettings((settings) => settings.sidebarWorkingShelfEnabled);
  const updateSettings = useUpdateClientSettings();
  return (
    <SettingsRow
      {...searchableSetting("sidebar-working-shelf")}
      description="Move busy threads into a collapsed Working section. They return to the top when they finish or need your attention. Pinned threads stay visible."
      resetAction={
        !workingShelfEnabled ? (
          <SettingResetButton
            label="Working section"
            onClick={() => updateSettings({ sidebarWorkingShelfEnabled: true })}
          />
        ) : null
      }
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
  );
}

/** Thread auto-settlement rows: on merge, and after a stretch of inactivity. */
export function AutoSettleRows() {
  const sidebarAutoSettleAfterDays = useScopedSettings(
    (settings) => settings.sidebarAutoSettleAfterDays,
  );
  const sidebarAutoSettleOnMerge = useScopedSettings(
    (settings) => settings.sidebarAutoSettleOnMerge,
  );
  const keepPullRequests = useScopedSettings(
    (settings) => settings.sidebarAutoSettleKeepPullRequests,
  );
  const updatePrimarySettings = useUpdateScopedSettings();
  return (
    <>
      <SettingsRow
        {...searchableSetting("auto-settle-merged-threads")}
        serverScoped
        settingKeys={["sidebarAutoSettleOnMerge"]}
        description="Settle idle threads when their pull request is merged. Closed pull requests also settle when automatic settlement is enabled."
        control={
          <ScopedSwitch
            settingKeys={["sidebarAutoSettleOnMerge"]}
            checked={sidebarAutoSettleOnMerge}
            onCheckedChange={(checked) =>
              updatePrimarySettings({ sidebarAutoSettleOnMerge: Boolean(checked) })
            }
            aria-label="Auto-settle merged threads"
          />
        }
      />
      <SettingsRow
        {...searchableSetting("auto-settle-inactive-threads")}
        serverScoped
        settingKeys={["sidebarAutoSettleAfterDays"]}
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
          serverScoped
          settingKeys={["sidebarAutoSettleAfterDays"]}
          description="Any new activity un-settles a thread automatically."
          control={
            <AutoSettleDaysInput
              value={sidebarAutoSettleAfterDays}
              onCommit={(days) => updatePrimarySettings({ sidebarAutoSettleAfterDays: days })}
            />
          }
        />
      ) : null}
      {sidebarAutoSettleAfterDays !== null ? (
        <SettingsRow
          {...searchableSetting("auto-settle-keep-pull-requests")}
          serverScoped
          settingKeys={["sidebarAutoSettleKeepPullRequests"]}
          description="Inactivity never settles a thread that has a pull request."
          control={
            <ScopedSwitch
              settingKeys={["sidebarAutoSettleKeepPullRequests"]}
              checked={keepPullRequests}
              onCheckedChange={(checked) =>
                updatePrimarySettings({ sidebarAutoSettleKeepPullRequests: Boolean(checked) })
              }
              aria-label="Keep threads with a pull request"
            />
          }
        />
      ) : null}
    </>
  );
}

export function LabsSettingsPanel() {
  const redesignEnabled = useClientSettings((settings) => settings.redesignEnabled);
  const planModeEnabled = useClientSettings((settings) => settings.planModeEnabled);
  const updateSettings = useUpdateClientSettings();

  return (
    <SettingsPageContainer>
      <SettingsSection title="Beta">
        <SettingsRow
          {...searchableSetting("new-design")}
          description="The new design is on by default. Turn it off to return to the classic look."
          resetAction={
            !redesignEnabled ? (
              <SettingResetButton
                label="new design"
                onClick={() => updateSettings({ redesignEnabled: true })}
              />
            ) : null
          }
          control={
            <Switch
              checked={redesignEnabled}
              onCheckedChange={(checked) => updateSettings({ redesignEnabled: Boolean(checked) })}
              aria-label="New design"
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
        <FastWorktreeCheckoutRow />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

/** Shows only when the primary environment is a Mac, since only macOS servers honor it. */
function FastWorktreeCheckoutRow() {
  const supported =
    useAtomValue(primaryServerConfigAtom)?.environment.capabilities.fastWorktreeCheckout === true;
  const enabled = usePrimarySettings((settings) => settings.fastWorktreeCheckout);
  const updatePrimarySettings = useUpdatePrimarySettings();
  if (!supported) return null;
  return (
    <SettingsRow
      {...searchableSetting("worktree-fast-checkout")}
      description="On a Mac, clone new worktrees from a checkout cached in the Test Rig home folder instead of writing every file. Uses Git’s normal checkout when it can’t. Turning it off deletes the cache."
      control={
        <Switch
          checked={enabled}
          onCheckedChange={(checked) =>
            updatePrimarySettings({ fastWorktreeCheckout: Boolean(checked) })
          }
          aria-label="Fast worktree checkout"
        />
      }
    />
  );
}
