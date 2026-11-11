import type { PullRequestCheck, PullRequestDetailView } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { PullRequestManagement } from "./PullRequestManagement";

const actions = ["merge", "enable-auto-merge", "close", "draft"] as const;
const check = (status: PullRequestCheck["status"]) => ({ name: "CI", status }) as PullRequestCheck;

function render(overrides: Partial<PullRequestDetailView>) {
  const detail = {
    number: 7,
    state: "open",
    isDraft: false,
    mergeability: "mergeable",
    checks: [check("success")],
    mergeReadiness: { status: "ready", reason: "GitHub merge state: CLEAN" },
    capabilities: { actions, mergeMethods: ["squash"] },
    viewerPermissions: { actions },
    mergeCapabilities: { merge: false, squash: true, rebase: false },
    ...overrides,
  } as unknown as PullRequestDetailView;
  const noop = () => {};
  return renderToStaticMarkup(
    <PullRequestManagement
      detail={detail}
      pending={false}
      hasStack={false}
      stackPending={false}
      stackError={null}
      mergeMethod="squash"
      onMergeMethodChange={noop}
      perform={async () => {}}
      onResolveConflicts={noop}
      onWork={noop}
      onAsk={noop}
      onExplain={noop}
      onFixFindings={noop}
      fixFindingsLabel="Fix findings"
    />,
  );
}

describe("PullRequestManagement", () => {
  it("renders an enabled merge button when the PR is ready", () => {
    const html = render({});
    expect(html).toMatch(/<button[^>]*>Squash and merge<\/button>/);
    expect(html).not.toMatch(/<button[^>]* disabled=""[^>]*>Squash and merge/);
  });

  it("renders a disabled merge button that names the blocker while checks fail", () => {
    const html = render({
      checks: [check("failure")],
      mergeReadiness: { status: "ready", reason: "GitHub merge state: UNSTABLE" },
    });
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Squash and merge<\/button>/);
    expect(html).toContain("Squash and merge unavailable: Checks are failing");
  });
});
