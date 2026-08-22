// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

const removedPaths = [
  "app.json",
  "apps/mobile",
  "experiments/messages-glass-lab",
  ".github/workflows/mobile-eas-preview.yml",
  ".github/workflows/mobile-eas-production.yml",
  ".github/workflows/mobile-showcase-screenshots.yml",
  ".mcp.json",
  ".codex/config.toml",
  "scripts/mobile-native-static-check.ts",
  "scripts/mobile-native-static-check.test.ts",
  "scripts/mobile-showcase.ts",
  "scripts/mobile-showcase.config.ts",
  "scripts/mobile-showcase-environment.ts",
  "scripts/mobile-showcase.test.ts",
  ".agents/skills/test-t3-mobile",
  ".agents/skills/ios-debugger-agent",
  ".agents/skills/ios-simulator-browser",
  "docs/operations/mobile-app-store-screenshots.md",
  "assets/dev/blueprint-ios-1024.png",
  "assets/nightly/nightly-ios-1024.png",
  "assets/prod/black-ios-1024.png",
  "patches/@expo%2Fmetro-config@56.0.14.patch",
  "patches/@legendapp__list@3.3.3.patch",
  "patches/@react-native-menu__menu@2.0.0.patch",
  "patches/@react-native__gradle-plugin@0.85.3.patch",
  "patches/@react-navigation%2Fnative-stack@7.17.6.patch",
  "patches/expo-modules-jsi@56.0.10.patch",
  "patches/react-native-gesture-handler@2.31.2.patch",
  "patches/react-native-keyboard-controller@1.21.13.patch",
  "patches/react-native-nitro-modules@0.35.9.patch",
  "patches/react-native-screens@4.25.2.patch",
] as const;

const activationFiles = [
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  ".github/workflows/ci.yml",
  ".gitignore",
  "scripts/release-smoke.ts",
] as const;

describe("mobile surface boundary", () => {
  it("keeps the native mobile application and its release tooling absent", () => {
    const violations = removedPaths.filter((path) =>
      NodeFS.existsSync(NodePath.join(repoRoot, path)),
    );

    expect(violations).toEqual([]);
  });

  it("keeps native mobile build hooks out of active workspace configuration", () => {
    const forbiddenNeedles = [
      "@t3tools/mobile",
      "apps/mobile",
      "screenshots:mobile",
      "lint:mobile",
      "@expo/metro-config",
      "react-native-screens",
      ".showcase/",
      "artifacts/app-store/screenshots/",
    ];
    const violations = activationFiles.flatMap((path) => {
      const contents = NodeFS.readFileSync(NodePath.join(repoRoot, path), "utf8");
      return forbiddenNeedles
        .filter((needle) => contents.includes(needle))
        .map((needle) => `${path}: ${needle}`);
    });

    expect(violations).toEqual([]);
  });
});
