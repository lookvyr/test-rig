import { ChevronRightIcon, FileIcon, FolderIcon, SearchIcon, XIcon } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/utils";
import { buildReviewFileTree, flattenReviewFileTree, type ReviewFile } from "./reviewFileTree";

export type { ReviewFile } from "./reviewFileTree";

const NO_COLLAPSED_DIRECTORIES: ReadonlySet<string> = new Set();

function statusPresentation(status: string) {
  switch (status.toLowerCase()) {
    case "a":
    case "added":
    case "add":
    case "untracked":
    case "?":
      return { label: "Added", badge: "A", tone: "text-success-foreground" };
    case "d":
    case "deleted":
    case "delete":
    case "removed":
      return { label: "Deleted", badge: "D", tone: "text-destructive" };
    case "r":
    case "renamed":
    case "rename":
      return { label: "Renamed", badge: "R", tone: "text-muted-foreground" };
    case "c":
    case "copied":
    case "copy":
      return { label: "Copied", badge: "C", tone: "text-success-foreground" };
    case "u":
    case "unmerged":
      return { label: "Unmerged", badge: "U", tone: "text-destructive" };
    default:
      return {
        label: status === "modified" || status === "M" ? "Modified" : status,
        badge: "M",
        tone: "text-warning-foreground",
      };
  }
}

export function ReviewFileNavigator({
  files,
  selectedPath,
  onSelectFile,
  onActivateFile,
  compact = false,
}: {
  files: readonly ReviewFile[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onActivateFile?: (path: string) => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(NO_COLLAPSED_DIRECTORIES);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const tree = useMemo(() => buildReviewFileTree(files, query), [files, query]);
  const searching = query.trim().length > 0;
  const rows = useMemo(
    () => flattenReviewFileTree(tree, searching ? NO_COLLAPSED_DIRECTORIES : collapsed),
    [tree, searching, collapsed],
  );
  const totals = useMemo(
    () =>
      files.reduce(
        (sum, file) => ({
          additions: sum.additions + (file.additions ?? 0),
          deletions: sum.deletions + (file.deletions ?? 0),
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );
  const tabStop =
    rows.find((row) => row.key === focusedKey)?.key ??
    rows.find((row) => row.node.kind === "file" && row.node.path === selectedPath)?.key ??
    rows[0]?.key;

  function toggleDirectory(path: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function focusRow(index: number) {
    const row = rows[index];
    if (!row) return;
    buttons.current.get(row.key)?.focus();
    if (row.node.kind === "file") onSelectFile(row.node.path);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const row = rows[index];
    if (!row) return;
    const { node } = row;
    switch (event.key) {
      case "ArrowDown":
        focusRow(Math.min(rows.length - 1, index + 1));
        break;
      case "ArrowUp":
        focusRow(Math.max(0, index - 1));
        break;
      case "Home":
        focusRow(0);
        break;
      case "End":
        focusRow(rows.length - 1);
        break;
      case "ArrowRight":
        if (node.kind === "directory") {
          if (!searching && collapsed.has(node.path)) toggleDirectory(node.path);
          else focusRow(index + 1);
        }
        break;
      case "ArrowLeft":
        if (node.kind === "directory" && !searching && !collapsed.has(node.path))
          toggleDirectory(node.path);
        else if (row.parentPath)
          focusRow(
            rows.findIndex(
              (entry) => entry.node.kind === "directory" && entry.node.path === row.parentPath,
            ),
          );
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <nav aria-label="Changed files" className="flex h-full min-h-0 min-w-0 flex-col text-xs">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 tabular-nums">
        <span className="mr-auto font-medium">
          Files <span className="text-muted-foreground">{files.length}</span>
        </span>
        <span className="text-success-foreground">+{totals.additions}</span>
        <span className="text-destructive">−{totals.deletions}</span>
      </div>
      <div className="relative mx-2 mb-2">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-2 left-2 size-3.5 text-muted-foreground"
        />
        <input
          type="text"
          aria-label="Filter changed files"
          placeholder="Find a file…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              event.stopPropagation();
            }
            if (event.key === "ArrowDown" && rows.length) {
              event.preventDefault();
              focusRow(0);
            }
          }}
          className="h-7.5 w-full rounded-md border bg-background pr-7 pl-7 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear file filter"
            onClick={() => setQuery("")}
            className="absolute top-1 right-1 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <XIcon aria-hidden className="size-3.5" />
          </button>
        )}
      </div>
      <div
        role="tree"
        aria-label="Changed file tree"
        className="min-h-0 flex-1 overflow-auto px-1 pb-2"
      >
        {rows.map(({ key, node, depth, position, siblingCount }, index) => {
          const directory = node.kind === "directory";
          const status = directory ? null : statusPresentation(node.file.status);
          const selected = !directory && selectedPath === node.path;
          return (
            <button
              key={key}
              ref={(element) => {
                if (element) buttons.current.set(key, element);
                else buttons.current.delete(key);
              }}
              type="button"
              role="treeitem"
              aria-level={depth + 1}
              aria-posinset={position}
              aria-setsize={siblingCount}
              aria-expanded={directory ? searching || !collapsed.has(node.path) : undefined}
              aria-selected={directory ? undefined : selected}
              aria-label={
                directory
                  ? `${node.name}, ${node.fileCount} files`
                  : `${node.path}, ${status?.label}`
              }
              tabIndex={tabStop === key ? 0 : -1}
              title={
                !directory && node.file.oldPath
                  ? `${node.path} (renamed from ${node.file.oldPath})`
                  : node.path
              }
              onFocus={() => setFocusedKey(key)}
              onClick={() => {
                if (directory) {
                  if (!searching) toggleDirectory(node.path);
                } else {
                  onSelectFile(node.path);
                  onActivateFile?.(node.path);
                }
              }}
              onKeyDown={(event) => handleKeyDown(event, index)}
              style={{ paddingLeft: 6 + depth * 12 }}
              className={cn(
                "flex w-full items-center gap-1.5 rounded pr-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                compact ? "h-7" : "h-8",
                selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                directory && "text-muted-foreground",
              )}
            >
              {directory ? (
                <ChevronRightIcon
                  aria-hidden
                  className={cn(
                    "size-3 shrink-0",
                    (searching || !collapsed.has(node.path)) && "rotate-90",
                  )}
                />
              ) : (
                <span className="w-3 shrink-0" />
              )}
              {directory ? (
                <FolderIcon aria-hidden className="size-3.5 shrink-0" />
              ) : (
                <FileIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              {directory ? (
                <span className="shrink-0 text-[10px] tabular-nums">{node.fileCount}</span>
              ) : (
                <>
                  {node.file.additions === null && node.file.deletions === null ? (
                    <span className="text-[10px] text-muted-foreground">Binary</span>
                  ) : (
                    <span aria-hidden className="flex shrink-0 gap-1 text-[10px] tabular-nums">
                      <span className="text-success-foreground">+{node.file.additions ?? 0}</span>
                      <span className="text-destructive">−{node.file.deletions ?? 0}</span>
                    </span>
                  )}
                  <span
                    aria-hidden
                    className={cn("w-2 shrink-0 text-center text-[10px] font-medium", status?.tone)}
                  >
                    {status?.badge}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
      {rows.length === 0 && (
        <p role="status" className="px-3 py-3 text-muted-foreground">
          {searching ? "No files match your search." : "No changed files."}
        </p>
      )}
    </nav>
  );
}
