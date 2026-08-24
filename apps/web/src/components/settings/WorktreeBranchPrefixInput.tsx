import { useEffect, useState } from "react";
import {
  DEFAULT_NEW_WORKTREE_BRANCH_PREFIX,
  MAX_NEW_WORKTREE_BRANCH_PREFIX_LENGTH,
  NewWorktreeBranchPrefix,
} from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";

import { Input } from "../ui/input";

const isNewWorktreeBranchPrefix = Schema.is(NewWorktreeBranchPrefix);

export function WorktreeBranchPrefixInput({
  value,
  onValueChange,
}: {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const normalizedDraft = draft.trim();
  const isValid = isNewWorktreeBranchPrefix(normalizedDraft);
  const commit = () => {
    if (isValid && normalizedDraft !== value) {
      onValueChange(normalizedDraft);
    }
  };

  return (
    <div className="w-full space-y-1 sm:w-56">
      <Input
        aria-describedby={isValid ? undefined : "worktree-branch-prefix-error"}
        aria-invalid={isValid ? undefined : true}
        aria-label="Worktree branch prefix"
        autoCapitalize="off"
        autoComplete="off"
        maxLength={MAX_NEW_WORKTREE_BRANCH_PREFIX_LENGTH + 1}
        onBlur={commit}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setDraft(value);
          }
        }}
        placeholder={DEFAULT_NEW_WORKTREE_BRANCH_PREFIX}
        spellCheck={false}
        value={draft}
      />
      {isValid ? null : (
        <p id="worktree-branch-prefix-error" className="text-[11px] text-destructive">
          Use 1–{MAX_NEW_WORKTREE_BRANCH_PREFIX_LENGTH} lowercase letters, numbers, dashes,
          underscores, or slashes. Each group must start and end with a letter or number.
        </p>
      )}
    </div>
  );
}
