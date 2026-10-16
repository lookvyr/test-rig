import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveMediaSource } from "./mediaSource.ts";

describe("authored reply media", () => {
  it("recognizes direct videos with signed queries and time fragments", () => {
    const source = "https://example.test/demos/walkthrough.MP4?token=abc#t=3";
    expect(resolveMediaSource(source, { threadId: undefined, imageEmbed: true })).toMatchObject({
      kind: "video",
      access: "direct",
      uri: source,
      srcFragment: "#t=3",
    });
  });

  it("keeps local media on the owning environment, including spaces and literal percent signs", () => {
    expect(
      resolveMediaSource("/tmp/demo%2520clip.mp4#t=2", {
        threadId: ThreadId.make("thread-media"),
        workspaceRoot: "/repo",
        imageEmbed: true,
      }),
    ).toMatchObject({
      kind: "video",
      access: "environment",
      resource: { _tag: "media-file", path: "/tmp/demo%20clip.mp4" },
      srcFragment: "#t=2",
    });
  });

  it("allows image endpoints while rejecting active schemes", () => {
    expect(
      resolveMediaSource("https://example.test/screenshot?id=5", {
        threadId: undefined,
        imageEmbed: true,
      }),
    ).toMatchObject({ kind: "image", access: "direct" });
    expect(
      resolveMediaSource("javascript:alert(1)", {
        threadId: undefined,
        imageEmbed: true,
      }),
    ).toBeNull();
  });
});
