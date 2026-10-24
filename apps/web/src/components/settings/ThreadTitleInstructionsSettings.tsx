import { useRef } from "react";
import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { ProjectSettingsScope, useProjectSettingsScope } from "./ProjectSettingsScope";
import { usePrimaryEnvironment } from "../../state/environments";
import { searchableSetting } from "./settingsSearch";

export function ThreadTitleInstructionsSettings() {
  const environment = usePrimaryEnvironment();
  return environment ? (
    <ProjectSettingsScope
      environmentId={environment.environmentId}
      route="/settings/general"
      label="thread title instructions"
    >
      <Instructions />
    </ProjectSettingsScope>
  ) : null;
}

function Instructions() {
  const scope = useProjectSettingsScope();
  const edited = useRef(false);
  const mixed = scope.isMixed("threadTitleInstructions");
  const value = scope.settings.threadTitleInstructions;
  const isProject = scope.projectIds !== null;
  const overridden = scope.source("threadTitleInstructions") !== "environment";
  return (
    <SettingsRow
      {...searchableSetting("thread-title-instructions")}
      description="Appended to the prompt for new and regenerated thread titles."
      status={
        isProject ? (overridden ? "Project override" : "Inherited from All projects") : undefined
      }
      resetAction={
        (isProject ? overridden : value !== "" || mixed) ? (
          <SettingResetButton
            label="thread title instructions"
            onClick={() =>
              isProject
                ? scope.clear("threadTitleInstructions")
                : scope.update({ threadTitleInstructions: "" })
            }
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
              scope.update({ threadTitleInstructions: next });
            edited.current = false;
          }}
        />
      </div>
    </SettingsRow>
  );
}
