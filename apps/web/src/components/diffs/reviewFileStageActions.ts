type FilePaths = {
  readonly path: string;
  readonly oldPath?: string | null | undefined;
  readonly status?: string;
};

function actionTargets(files: readonly FilePaths[]): readonly FilePaths[] {
  return files.map((file) => (file.status === "copied" ? { path: file.path } : file));
}

export function getReviewBulkStageActions(
  scope: "working-tree" | "unstaged" | "staged",
  scopeFiles: readonly FilePaths[],
  stagedFiles: readonly FilePaths[] | undefined,
  unstagedFiles: readonly FilePaths[] | undefined,
): ReadonlyArray<{
  label: "Stage all" | "Stage remaining" | "Unstage all";
  staged: boolean;
  files: readonly FilePaths[];
}> {
  if (scope !== "working-tree") {
    return scopeFiles.length
      ? [
          {
            label: scope === "staged" ? "Unstage all" : "Stage all",
            staged: scope !== "staged",
            files: actionTargets(scopeFiles),
          },
        ]
      : [];
  }
  if (!stagedFiles || !unstagedFiles) return [];
  return [
    ...(unstagedFiles.length
      ? [
          {
            label: stagedFiles.length ? ("Stage remaining" as const) : ("Stage all" as const),
            staged: true,
            files: actionTargets(unstagedFiles),
          },
        ]
      : []),
    ...(stagedFiles.length
      ? [{ label: "Unstage all" as const, staged: false, files: actionTargets(stagedFiles) }]
      : []),
  ];
}

export function getReviewFileStageActions(
  file: FilePaths,
  scope: "working-tree" | "unstaged" | "staged",
  stagedFiles: readonly FilePaths[] | undefined,
  unstagedFiles: readonly FilePaths[] | undefined,
): ReadonlyArray<{ label: "Stage" | "Unstage"; staged: boolean; files: readonly FilePaths[] }> {
  if (scope !== "working-tree") {
    return [
      {
        label: scope === "staged" ? "Unstage" : "Stage",
        staged: scope !== "staged",
        files: actionTargets([file]),
      },
    ];
  }
  if (!stagedFiles || !unstagedFiles) return [];
  const paths = new Set([file.path, ...(file.oldPath ? [file.oldPath] : [])]);
  const matchingFiles = (files: readonly FilePaths[]) => {
    const direct = files.filter((candidate) => candidate.path === file.path);
    if (direct.length) return direct;
    return files.filter(
      (candidate) =>
        candidate.status !== "copied" &&
        (paths.has(candidate.path) || Boolean(candidate.oldPath && paths.has(candidate.oldPath))),
    );
  };
  const toStage = actionTargets(matchingFiles(unstagedFiles));
  const toUnstage = actionTargets(matchingFiles(stagedFiles));
  return [
    ...(toStage.length ? [{ label: "Stage" as const, staged: true, files: toStage }] : []),
    ...(toUnstage.length ? [{ label: "Unstage" as const, staged: false, files: toUnstage }] : []),
  ];
}
