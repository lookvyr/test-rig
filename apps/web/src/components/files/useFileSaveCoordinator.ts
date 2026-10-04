import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useMemo } from "react";

import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { FileSaveCoordinator } from "./fileSaveCoordinator";
import { confirmProjectFileQueryData } from "./projectFilesQueryState";

export function useFileSaveCoordinator({
  environmentId,
  cwd,
  relativePath,
  onPendingChange,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  onPendingChange: (relativePath: string, pending: boolean) => void;
}): FileSaveCoordinator {
  const writeFile = useAtomCommand(projectEnvironment.writeFile);
  const coordinator = useMemo(
    () =>
      new FileSaveCoordinator({
        debounceMs: 500,
        onPendingChange: (pending) => onPendingChange(relativePath, pending),
        persist: (nextContents) =>
          writeFile({
            environmentId,
            input: { cwd, relativePath, contents: nextContents },
          }),
        onConfirmed: (confirmedContents) => {
          confirmProjectFileQueryData(environmentId, cwd, relativePath, confirmedContents);
        },
      }),
    [cwd, environmentId, onPendingChange, relativePath, writeFile],
  );

  useEffect(() => {
    coordinator.activate();
    return () => coordinator.dispose();
  }, [coordinator]);
  return coordinator;
}
