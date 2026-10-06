import { RuntimeRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";

describe("provider approval choices", () => {
  it("uses provider labels and omits unadvertised persistence actions", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={RuntimeRequestId.make("once-only")}
        isResponding={false}
        canRespond
        options={[
          { decision: "decline", label: "Reject access" },
          { decision: "accept", label: "Allow Safari once" },
        ]}
        onRespondToApproval={async () => {}}
      />,
    );
    expect(markup).toContain("Allow Safari once");
    expect(markup).toContain("Reject access");
    expect(markup).not.toContain("More approval options");
    expect(markup).not.toContain("Always allow");
  });
  it("disables primary responses when the provider cannot resume the request", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={RuntimeRequestId.make("gone")}
        isResponding={false}
        canRespond={false}
        options={[{ decision: "accept", label: "Approve" }]}
        onRespondToApproval={async () => {}}
      />,
    );
    expect(markup).toMatch(/<button[^>]*disabled/);
  });
  it("disables secondary choices when the provider cannot resume", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={RuntimeRequestId.make("gone-persistent")}
        isResponding={false}
        canRespond={false}
        options={[{ decision: "acceptAlways", label: "Always allow Safari" }]}
        onRespondToApproval={async () => {}}
      />,
    );
    expect(markup).toMatch(/<button[^>]*disabled[^>]*aria-label="More approval options"/);
  });

  it("offers secondary provider choices through the upstream menu", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={RuntimeRequestId.make("persistent")}
        isResponding={false}
        canRespond
        options={[
          { decision: "acceptAlways", label: "Always allow Safari" },
          { decision: "accept", label: "Approve" },
        ]}
        onRespondToApproval={async () => {}}
      />,
    );
    expect(markup).toContain("More approval options");
  });
});
