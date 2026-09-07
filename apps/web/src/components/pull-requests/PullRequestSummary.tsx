import type { GitGetPullRequestDetailsResult, GitPullRequestFile } from "@t3tools/contracts";
import { ChevronRightIcon, ExternalLinkIcon, FileIcon, FolderIcon } from "lucide-react";
import { useMemo } from "react";
import { cn } from "../../lib/utils";

type PullRequestCheck = GitGetPullRequestDetailsResult["checks"][number];
const CHECK_LABELS = [
  "passed",
  "failed",
  "running",
  "pending",
  "skipped",
  "neutral",
  "cancelled",
  "unknown",
] as const;
type CheckState = (typeof CHECK_LABELS)[number];

export function pullRequestCheckState(check: PullRequestCheck): CheckState {
  const value = (check.conclusion || check.status).toLowerCase().replaceAll("-", "_");
  switch (value) {
    case "success":
      return "passed";
    case "failure":
    case "error":
    case "timed_out":
    case "action_required":
    case "startup_failure":
      return "failed";
    case "in_progress":
      return "running";
    case "queued":
    case "pending":
    case "waiting":
    case "requested":
      return "pending";
    case "skipped":
      return "skipped";
    case "neutral":
      return "neutral";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

function checkTone(state: CheckState) {
  return state === "passed"
    ? "text-success-foreground"
    : state === "failed"
      ? "text-destructive"
      : state === "running" || state === "pending"
        ? "text-warning-foreground"
        : "text-muted-foreground";
}

export function PullRequestChecks({
  checks,
}: {
  checks: GitGetPullRequestDetailsResult["checks"];
}) {
  const counts = new Map<CheckState, number>();
  for (const check of checks) {
    const state = pullRequestCheckState(check);
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  if (checks.length === 0)
    return (
      <section className="space-y-2">
        <h3 className="text-xs font-medium">Checks</h3>
        <p className="text-xs text-muted-foreground">No checks reported.</p>
      </section>
    );
  return (
    <details className="group/checks rounded-md border">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 rounded-md px-3 py-3 text-xs focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 font-medium">
          <ChevronRightIcon className="size-3.5 shrink-0 group-open/checks:rotate-90" />
          Checks
        </span>
        <span className="flex flex-1 flex-wrap justify-end gap-x-3 gap-y-1 tabular-nums">
          {CHECK_LABELS.filter((state, index) => index < 4 || counts.has(state)).map((state) => (
            <span
              key={state}
              className={cn(counts.has(state) ? checkTone(state) : "text-muted-foreground")}
            >
              {counts.get(state) ?? 0} {state}
            </span>
          ))}
        </span>
      </summary>
      <ul className="divide-y border-t">
        {checks.map((check, index) => (
          <li
            // Provider check names can repeat and carry no ID; these rows have no local state.
            // oxlint-disable-next-line react/no-array-index-key
            key={`${check.name}:${check.url}:${index}`}
            className="flex items-start gap-3 px-3 py-2.5 text-xs"
          >
            <span className="min-w-0 flex-1 break-words">
              {check.url ? (
                <a
                  href={check.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-start gap-1.5 rounded hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="min-w-0 break-words">{check.name}</span>
                  <ExternalLinkIcon aria-hidden className="mt-0.5 size-3 shrink-0" />
                </a>
              ) : (
                check.name
              )}
            </span>
            <span
              className={cn(
                "max-w-[40%] shrink-0 text-right capitalize",
                checkTone(pullRequestCheckState(check)),
              )}
            >
              {(check.conclusion || check.status || "Unknown").toLowerCase().replaceAll("_", " ")}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

interface FileTreeDirectory {
  kind: "directory";
  name: string;
  path: string;
  children: FileTreeNode[];
  fileCount: number;
}
type FileTreeNode =
  | FileTreeDirectory
  | { kind: "file"; name: string; path: string; file: GitPullRequestFile };

export function buildPullRequestFileTree(files: readonly GitPullRequestFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const directories = new Map<string, FileTreeDirectory>();
  for (const file of files) {
    const segments = file.path.split("/");
    let children = root;
    let path = "";
    for (const name of segments.slice(0, -1)) {
      path = path ? `${path}/${name}` : name;
      let directory = directories.get(path);
      if (!directory) {
        directory = { kind: "directory", name, path, children: [], fileCount: 0 };
        directories.set(path, directory);
        children.push(directory);
      }
      directory.fileCount += 1;
      children = directory.children;
    }
    children.push({ kind: "file", name: segments.at(-1) ?? file.path, path: file.path, file });
  }
  const sort = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1,
    );
    for (const node of nodes) {
      if (node.kind !== "directory") continue;
      sort(node.children);
      const child = node.children.length === 1 ? node.children[0] : undefined;
      if (child?.kind === "directory") {
        node.name = `${node.name}/${child.name}`;
        node.path = child.path;
        node.children = child.children;
      }
    }
  };
  sort(root);
  return root;
}

function FileTree({ nodes, depth = 0 }: { nodes: readonly FileTreeNode[]; depth?: number }) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <li key={node.path}>
          {node.kind === "directory" ? (
            <details open={depth === 0} className="[&[open]>summary>svg:first-child]:rotate-90">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded py-1.5 text-xs hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <ChevronRightIcon className="size-3 shrink-0" />
                <FolderIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 break-all font-mono">{node.name}</span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  {node.fileCount}{" "}
                  <span className="sr-only">{node.fileCount === 1 ? "file" : "files"}</span>
                </span>
              </summary>
              <div className="ml-3 border-l pl-3">
                <FileTree nodes={node.children} depth={depth + 1} />
              </div>
            </details>
          ) : (
            <div
              className="flex items-center gap-1.5 py-1.5 pl-4.5 text-xs"
              title={
                node.file.previousPath
                  ? `${node.path} (renamed from ${node.file.previousPath})`
                  : node.path
              }
            >
              <FileIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
              <span className="sr-only">{node.file.status}</span>
              <span className="shrink-0 tabular-nums text-success-foreground">
                +{node.file.additions}
              </span>
              <span className="shrink-0 tabular-nums text-destructive">−{node.file.deletions}</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function PullRequestFiles({ details }: { details: GitGetPullRequestDetailsResult }) {
  const tree = useMemo(() => buildPullRequestFileTree(details.files), [details.files]);
  const pr = details.pullRequest;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <h3 className="mr-auto font-medium">
          Changed files <span className="text-muted-foreground">({pr.changedFiles})</span>
        </h3>
        <span className="tabular-nums text-success-foreground">+{pr.additions}</span>
        <span className="tabular-nums text-destructive">−{pr.deletions}</span>
      </div>
      {details.files.length ? (
        <FileTree nodes={tree} />
      ) : (
        <p className="text-xs text-muted-foreground">No changed files reported.</p>
      )}
      {details.files.length < pr.changedFiles && (
        <p className="text-xs text-muted-foreground">
          Showing {details.files.length} of {pr.changedFiles} files. Open in GitHub for the complete
          list.
        </p>
      )}
    </section>
  );
}
