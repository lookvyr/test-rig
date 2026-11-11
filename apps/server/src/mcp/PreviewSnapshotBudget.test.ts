/**
 * Token budgets for the browser tools. Every snapshot lands in the agent's context and is
 * replayed on each later request, so a regression here multiplies across a whole browser flow.
 * Raise a budget only when the extra bytes buy the agent something it needs.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { Tool } from "effect/unstable/ai";

import * as ServerBrowserPage from "../preview/ServerBrowserPage.ts";
import { advertisedJsonSchema } from "./advertisedJsonSchema.ts";
import { snapshotMetadata } from "./PreviewSnapshot.ts";
import { PreviewToolkit } from "./toolkits/preview/tools.ts";

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

// A typical app screen: navigation, a form, a list of rows with unnamed checkboxes, and prose.
const appPage = `
  <nav><a href="/">Home</a> <a href="/projects">Projects</a> <a href="/settings">Settings</a>
    <a href="/help">Help</a> <button aria-label="Account">S</button></nav>
  <main>
    <h1>Tasks</h1>
    <p>${"Plan the week and track what is left. ".repeat(12)}</p>
    <form><input aria-label="New task" placeholder="What needs to be done?">
      <select aria-label="Priority"><option>Low</option><option>High</option></select>
      <button>Add</button></form>
    <ul>${Array.from(
      { length: 25 },
      (_, i) =>
        `<li><input type="checkbox"><span>Task number ${i + 1}</span> <a href="/tasks/${i + 1}">Edit</a> <button>Delete</button></li>`,
    ).join("")}</ul>
    <footer><p>${"Terms apply. ".repeat(10)}</p><a href="/privacy">Privacy</a></footer>
  </main>`;

const routineLogs = {
  consoleEntries: [
    ...Array.from({ length: 15 }, (_, i) => ({
      level: "log",
      text: `[app] render ${i}`,
      timestamp: `2026-11-11T00:00:${String(i).padStart(2, "0")}.000Z`,
    })),
    { level: "error", text: "Failed to load avatar", timestamp: "2026-11-11T00:00:20.000Z" },
  ],
  networkEntries: Array.from({ length: 40 }, (_, i) => ({
    url: `https://app.example.test/assets/chunk-${i}.js`,
    method: "GET",
    status: 200,
    failed: false,
    timestamp: `2026-11-11T00:00:${String(i).padStart(2, "0")}.000Z`,
  })),
  actionTimeline: Array.from({ length: 6 }, (_, i) => ({
    id: String(i),
    action: "click",
    status: "succeeded" as const,
    startedAt: `2026-11-11T00:01:0${i}.000Z`,
    completedAt: `2026-11-11T00:01:0${i}.500Z`,
  })),
};

describe("browser tool token budgets", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("keeps a typical app snapshot small while every control has a ref", async () => {
    await page.setContent(appPage);
    const snapshot = await ServerBrowserPage.snapshot({
      page,
      cdp: await context.newCDPSession(page),
      renderScale: 1,
      ...routineLogs,
    });
    const metadata = snapshotMetadata(snapshot);
    const tree = String(metadata.accessibilityTree);
    // 25 rows of checkbox, link, and button, plus the nav, form, and footer controls.
    expect(tree.match(/\[ref=/g)).toHaveLength(25 * 3 + 5 + 3 + 1);
    expect(tree).toMatch(/- checkbox \[ref=[^\]]+\]\n\s+- text: Task number 1\n/);
    expect(tree).not.toMatch(/\/url:|\[box=|\[cursor=/);
    expect(metadata.consoleEntries?.map(({ text }) => text)).toEqual(["Failed to load avatar"]);
    expect(metadata).not.toHaveProperty("networkEntries");
    expect(metadata).not.toHaveProperty("actionTimeline");
    // About 6.9 KB (roughly 2K tokens) when written.
    expect(bytes(metadata)).toBeLessThan(8_000);
  });

  it("keeps the browser tool definitions within budget", () => {
    const definitions = Object.values(PreviewToolkit.tools).map((tool) => ({
      name: tool.name,
      description: Tool.getDescription(tool),
      inputSchema: advertisedJsonSchema(tool),
    }));
    // About 11 KB when written.
    expect(bytes(definitions)).toBeLessThan(12_000);
  });
});
