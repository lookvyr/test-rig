import { type EnvironmentId, shouldRecommendDatabaseCompaction } from "@t3tools/contracts";
import { useState } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { SettingsSection } from "./settingsLayout";

export function DatabaseStorageNotice({
  environmentId,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}) {
  const { data, error, isPending, refresh } = useEnvironmentQuery(
    serverEnvironment.databaseStorage({ environmentId, input: {} }),
  );
  const [dismissed, setDismissed] = useState(false);
  const { copyToClipboard } = useCopyToClipboard({ target: "command" });
  const recommended = data !== null && shouldRecommendDatabaseCompaction(data);
  return (
    <SettingsSection
      title="Local database"
      headerAction={
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setDismissed(false);
            refresh();
          }}
        >
          Refresh storage
        </Button>
      }
    >
      <div className="space-y-3 px-4 py-4 text-sm sm:px-5">
        {error ? (
          <p className="text-muted-foreground">
            Could not read storage information. Refresh to retry.
          </p>
        ) : data ? (
          <>
            <p>
              {(data.databaseBytes / 1024 ** 2).toFixed(1)} MiB on {label} ·{" "}
              {(data.reclaimableBytes / 1024 ** 2).toFixed(1)} MiB unused
            </p>
            {recommended && !dismissed ? (
              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                <p className="font-medium">
                  Reclaim {(data.reclaimableBytes / 1024 ** 3).toFixed(1)} GiB of database space
                </p>
                <p className="text-muted-foreground">
                  Deleted history leaves unused pages that SQLite can reuse. To return them to disk,
                  first inspect this database with the command below. Inspection does not change
                  your data.
                </p>
                <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
                  Dismiss notice
                </Button>
              </div>
            ) : null}
            <p className="text-muted-foreground">
              Run on {label} in Terminal (PowerShell on Windows). To reclaim space, quit Test Rig
              and stop servers using this database, then add <code>--fix</code>. The doctor keeps a
              backup and verifies conversation projections before finishing.
            </p>
            <code className="block select-text break-all rounded-md bg-muted/50 p-3 text-xs">
              {data.inspectCommand}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(data.inspectCommand)}
            >
              Copy inspect command
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground">Loading database storage…</p>
        )}
      </div>
    </SettingsSection>
  );
}
