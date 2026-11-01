import { useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ServerConfig,
} from "@t3tools/contracts";
import { useEffect } from "react";

import { useClientSettings, useClientSettingsHydrated } from "~/hooks/useSettings";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { previewEnvironment } from "~/state/preview";
import { environmentSession, sessionHasScope } from "~/state/session";

/**
 * Keeps every operable server browser on this client's browser profiles, so agents can list
 * and open them and the server can clear their storage.
 */
export function BrowserProfileReporter() {
  const serverConfigs = useServerConfigs();
  return (
    <>
      {[...serverConfigs]
        .filter(([, config]) => config.environment.capabilities.serverBrowser)
        .map(([environmentId, config]) => (
          <EnvironmentProfileReporter
            key={environmentId}
            environmentId={environmentId}
            config={config}
          />
        ))}
    </>
  );
}

function EnvironmentProfileReporter(props: {
  readonly environmentId: EnvironmentId;
  readonly config: ServerConfig;
}) {
  const { environmentId, config } = props;
  const hydrated = useClientSettingsHydrated();
  const profiles = useClientSettings((settings) => settings.browserProfiles);
  const defaultProfileId = useClientSettings((settings) => settings.browserDefaultProfileId);
  const recordingFrameRate = useClientSettings((settings) => settings.browserRecordingFrameRate);
  const operable = sessionHasScope(
    useAtomValue(environmentSession.sessionStateAtom(environmentId)),
    AuthOrchestrationOperateScope,
  );

  // A new server config means a restarted server, which has forgotten earlier reports.
  useEffect(() => {
    // Reports need the user's real profiles, which arrive with client settings.
    if (!hydrated || !operable) return;
    void runAtomCommand(
      appAtomRegistry,
      previewEnvironment.reportProfiles,
      { environmentId, input: { profiles, defaultProfileId, recordingFrameRate } },
      { reportFailure: false },
    );
  }, [hydrated, operable, environmentId, config, profiles, defaultProfileId, recordingFrameRate]);

  return null;
}
