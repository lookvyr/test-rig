import { describe, expect, it } from "vite-plus/test";
import { resolveThreadDetailsCardLayout } from "./threadDetailsCardLayout";

const lane = { padding: 20, minChatWidth: 640 };
const resolve = (width: number, height: number, previewY: number | null = null) =>
  resolveThreadDetailsCardLayout({
    container: { width, height },
    lane,
    frame: previewY === null ? null : { x: width - 332, y: previewY, width: 320, height: 240 },
  });

describe("workspace card", () => {
  it("pins to the top right at a fixed width", () => {
    expect(resolve(1600, 900)).toEqual({
      x: 1308,
      y: 12,
      width: 280,
      height: 876,
    });
    expect(resolve(1344, 900)).toMatchObject({ x: 1052, width: 280 });
  });
  it("hides when a readable chat lane cannot fit beside it", () => {
    expect(resolve(984, 900)).toMatchObject({ x: 692 });
    expect(resolve(983, 900)).toBeNull();
  });
  it("keeps the card at the top right while the preview is freely dragged vertically", () => {
    for (const y of [12, 170, 250, 400, 648]) {
      expect(resolve(1600, 900, y)).toEqual({ x: 1308, y: 12, width: 280, height: 876 });
    }
  });
  it("keeps full height while a preview stays clear of the card", () => {
    expect(resolve(1344, 900, 600)).toMatchObject({ width: 280, height: 876 });
    expect(
      resolveThreadDetailsCardLayout({
        container: { width: 1600, height: 900 },
        lane,
        frame: { x: 12, y: 100, width: 320, height: 240 },
      })?.height,
    ).toBe(876);
  });
});

describe("card height beside a resized preview", () => {
  it("uses a popover when the preview leaves less than 160px for controls", () => {
    const input = { container: { width: 1584, height: 988 }, lane, overlapsDetailsCard: true };
    expect(
      resolveThreadDetailsCardLayout({
        ...input,
        frame: { x: 1260, y: 184, width: 240, height: 792 },
      }),
    ).toMatchObject({ height: 160 });
    expect(
      resolveThreadDetailsCardLayout({
        ...input,
        frame: { x: 1260, y: 183, width: 240, height: 793 },
      }),
    ).toBeNull();
  });
});
