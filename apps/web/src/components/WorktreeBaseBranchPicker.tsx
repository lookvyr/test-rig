import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronDownIcon, GitBranchIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { usePaginatedBranches } from "../state/queries";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "./ui/combobox";
import { Switch } from "./ui/switch";

/** Select a future worktree's base without changing the project's current checkout. */
export function WorktreeBaseBranchPicker({
  environmentId,
  cwd,
  value,
  onValueChange,
  startFromOrigin,
  onStartFromOriginChange,
  disabled = false,
  id,
}: {
  environmentId: EnvironmentId;
  cwd: string | null;
  value: string;
  onValueChange: (branch: string) => void;
  startFromOrigin: boolean;
  onStartFromOriginChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const branches = usePaginatedBranches({
    environmentId,
    cwd: open ? cwd : null,
    query: deferredQuery,
  });
  const items = branches.refs.map((branch) => branch.name);
  return (
    <Combobox
      items={items}
      filteredItems={items}
      value={value || null}
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      onValueChange={(branch) => {
        if (branch) onValueChange(branch);
        setOpen(false);
      }}
    >
      <ComboboxTrigger
        id={id}
        disabled={disabled || !cwd}
        render={<Button variant="outline" size="sm" />}
        className="w-full justify-between"
      >
        <GitBranchIcon className="size-3.5" />
        <span className="flex-1 truncate text-left">{value || "Select a branch"}</span>
        <ChevronDownIcon className="size-3.5" />
      </ComboboxTrigger>
      <ComboboxPopup
        align="start"
        className="w-80"
        onKeyDownCapture={(event) => {
          // Escape from the origin switch should dismiss the picker, not the task editor.
          if (event.key === "Escape") {
            event.stopPropagation();
            event.preventDefault();
            setOpen(false);
            setQuery("");
          }
        }}
      >
        <ComboboxInput
          placeholder="Search refs…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>{branches.isPending ? "Loading refs…" : "No refs found."}</ComboboxEmpty>
        <ComboboxList>
          {(branch: string) => (
            <ComboboxItem key={branch} value={branch}>
              {branch}
            </ComboboxItem>
          )}
        </ComboboxList>
        {branches.data?.nextCursor != null ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={branches.isFetchingNextPage}
            onClick={branches.loadNext}
          >
            Load more refs
          </Button>
        ) : null}
        {branches.error ? <ComboboxStatus>{branches.error}</ComboboxStatus> : null}
        <label className="flex items-center justify-between gap-3 border-t px-3 py-2 text-xs">
          Start from origin
          <Switch checked={startFromOrigin} onCheckedChange={onStartFromOriginChange} />
        </label>
      </ComboboxPopup>
    </Combobox>
  );
}
