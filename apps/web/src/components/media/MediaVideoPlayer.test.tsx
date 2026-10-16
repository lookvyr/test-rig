import { act } from "react";
import type { ReactElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { MediaVideoPlayer } from "./MediaVideoPlayer";

vi.mock("./MediaActions", () => ({
  MediaActions: ({ children }: { children: ReactElement }) => children,
}));

describe("reply video presentation", () => {
  let tree: ReactTestRenderer | undefined;
  const video = {
    videoWidth: 900,
    videoHeight: 1600,
    duration: 65,
    currentTime: 0,
    paused: true,
    ended: false,
    seeking: false,
    autoplay: false,
    played: { length: 0 },
    src: "https://example.test/demo.mp4?token=1",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    pause: vi.fn(),
  };
  beforeEach(() => {
    vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    video.currentTime = 0;
    video.duration = 65;
    video.paused = true;
    video.pause.mockClear();
  });
  afterEach(() => {
    act(() => tree?.unmount());
    vi.unstubAllGlobals();
  });

  it("fits portrait media to its natural ratio and retains that shape through failure", () => {
    act(() => {
      tree = create(
        <MediaVideoPlayer
          src={video.src}
          label="Mobile flow"
          inline
          actionsSource={{ kind: "video", name: "Mobile flow", src: video.src }}
        />,
        {
          createNodeMock: (element) => (element.type === "video" ? video : null),
        },
      );
    });
    act(() => tree!.root.findByType("video").props.onLoadedMetadata({ currentTarget: video }));
    expect(tree!.root.findByType("video").props.style.aspectRatio).toBe(900 / 1600);
    expect(tree!.root.findByType("video").props.controls).toBe(true);
    act(() => tree!.root.findByType("video").props.onError());
    expect(tree!.root.findByProps({ role: "alert" }).props.style.aspectRatio).toBe(900 / 1600);
  });

  it("keeps a playing source and playhead while its signed URL refreshes", () => {
    const props = { src: video.src, label: "Demo", inline: true };
    act(() => {
      tree = create(<MediaVideoPlayer {...props} />, {
        createNodeMock: (element) => (element.type === "video" ? video : null),
      });
    });
    video.paused = false;
    video.currentTime = 12;
    act(() => tree!.root.findByType("video").props.onPlay());
    act(() =>
      tree!.update(<MediaVideoPlayer {...props} src="https://example.test/demo.mp4?token=2" />),
    );
    expect(tree!.root.findByType("video").props.src).toBe(video.src);
    expect(video.currentTime).toBe(12);
  });
});
