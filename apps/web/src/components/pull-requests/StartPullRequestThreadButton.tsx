import { GitBranchIcon, HourglassIcon } from "lucide-react";
import {
  usePullRequestHandoff,
  type PullRequestHandoffInput,
} from "../../hooks/usePullRequestHandoff";
import { Button } from "../ui/button";

export function StartPullRequestThreadButton(input: PullRequestHandoffInput) {
  const { startReview, isPending, error } = usePullRequestHandoff(input);
  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        className="absolute top-3 right-11 h-7 text-muted-foreground hover:text-foreground sm:h-7"
        aria-label={isPending ? "Preparing review thread" : "Start review thread"}
        title={isPending ? "Preparing review thread…" : "Start review thread in a worktree"}
        aria-busy={isPending}
        disabled={isPending}
        onClick={() => void startReview()}
      >
        {isPending ? <HourglassIcon /> : <GitBranchIcon />}
        Review
      </Button>
      {error && (
        <p role="alert" className="px-5 pb-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
