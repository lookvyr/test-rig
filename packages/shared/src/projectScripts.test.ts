import { describe, expect, it } from "vite-plus/test";
import type { ProjectScript } from "@t3tools/contracts";

import {
  projectScriptMenuLabel,
  settleProjectScript,
  setupProjectScript,
} from "./projectScripts.ts";

const script = (id: string, roles: Partial<ProjectScript> = {}): ProjectScript => ({
  id,
  name: id,
  command: id,
  icon: "play",
  runOnWorktreeCreate: false,
  ...roles,
});

describe("project script roles", () => {
  const scripts = [
    script("dev"),
    script("setup", { runOnWorktreeCreate: true }),
    script("clean", { runOnSettle: true }),
  ];

  it("finds the setup and on-settle actions separately", () => {
    expect(setupProjectScript(scripts)?.id).toBe("setup");
    expect(settleProjectScript(scripts)?.id).toBe("clean");
    expect(settleProjectScript([script("dev")])).toBeNull();
  });

  it("names every role an action holds", () => {
    expect(projectScriptMenuLabel(scripts[0]!)).toBe("dev");
    expect(
      projectScriptMenuLabel(script("both", { runOnWorktreeCreate: true, runOnSettle: true })),
    ).toBe("both (setup, on settle)");
  });
});
