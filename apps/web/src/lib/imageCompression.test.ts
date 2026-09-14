import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createComposerImageThumbnail,
  compressImageForStash,
  compressImageToByteLimit,
  MAX_COMPRESSIBLE_SOURCE_BYTES,
  MAX_STASH_IMAGE_DATA_URL_CHARS,
} from "./imageCompression";

/**
 * jsdom has no real canvas/codec, so the re-encode path is exercised with
 * stubbed `createImageBitmap` + `OffscreenCanvas`. The encoder stub returns a
 * payload whose size scales with quality, mirroring how a real JPEG encoder
 * shrinks as quality drops — enough to verify the ladder logic and budget
 * enforcement without pulling in a native canvas.
 */

const originalCreateImageBitmap = globalThis.createImageBitmap;
const originalOffscreenCanvas = globalThis.OffscreenCanvas;

function makeFile(sizeBytes: number, type = "image/png"): File {
  return new File([new Uint8Array(sizeBytes).fill(7)], "shot.png", { type });
}

/**
 * Installs a fake bitmap + canvas whose encoded size follows `sizeForQuality`.
 * `supportsWebp: false` makes `convertToBlob` hand back a differently-typed
 * blob for WebP requests, which is how a real browser signals it cannot
 * encode that format.
 */
function stubCanvasPipeline(
  sizeForQuality: (quality: number) => number,
  options?: { supportsWebp?: boolean },
) {
  const supportsWebp = options?.supportsWebp ?? true;
  const close = vi.fn();
  const fillRect = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 4000, height: 3000, close })),
  );
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return {
          fillStyle: "",
          fillRect,
          drawImage: vi.fn(),
        };
      }
      async convertToBlob({ type, quality }: { type: string; quality: number }) {
        const resolvedType = type === "image/webp" && !supportsWebp ? "image/png" : type;
        return new Blob([new Uint8Array(sizeForQuality(quality))], { type: resolvedType });
      }
    },
  );
  return { close, fillRect };
}

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.createImageBitmap = originalCreateImageBitmap;
  globalThis.OffscreenCanvas = originalOffscreenCanvas;
});

describe("composer image thumbnails", () => {
  it.each([
    { width: 640, height: 320, cropX: 160, cropY: 0, side: 320, dimension: 256 },
    { width: 32, height: 48, cropX: 0, cropY: 8, side: 32, dimension: 32 },
  ])("centers a $width by $height image without enlarging it", async (size) => {
    const close = vi.fn();
    const bitmap = { width: size.width, height: size.height, close };
    const drawImage = vi.fn();
    const dimensions: number[][] = [];
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap),
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(width: number, height: number) {
          dimensions.push([width, height]);
        }
        getContext() {
          return { drawImage };
        }
        async convertToBlob() {
          return new Blob(["thumbnail"], { type: "image/png" });
        }
      },
    );
    expect(await createComposerImageThumbnail(makeFile(5))).toMatch(/^data:image\/png;base64,/);
    expect(dimensions).toEqual([[size.dimension, size.dimension]]);
    expect(drawImage).toHaveBeenCalledWith(
      bitmap,
      size.cropX,
      size.cropY,
      size.side,
      size.side,
      0,
      0,
      size.dimension,
      size.dimension,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("falls back when the browser cannot decode thumbnails", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    expect(await createComposerImageThumbnail(makeFile(5))).toBeNull();
  });

  it("decodes a tall original once and caches a bounded center crop", async () => {
    const close = vi.fn();
    const bitmap = { width: 2304, height: 32766, close };
    const decode = vi.fn(async () => bitmap);
    const drawImage = vi.fn();
    const dimensions: number[][] = [];
    vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(width: number, height: number) {
          dimensions.push([width, height]);
        }
        getContext() {
          return { drawImage };
        }
        async convertToBlob() {
          return new Blob(["thumbnail"], { type: "image/png" });
        }
      },
    );
    const original = new File(["original bytes"], "tall.png", { type: "image/png" });
    const [first, second] = await Promise.all([
      createComposerImageThumbnail(original),
      createComposerImageThumbnail(original),
    ]);
    expect(first).toBe("data:image/png;base64,dGh1bWJuYWls");
    expect(second).toBe(first);
    expect(await createComposerImageThumbnail(original)).toBe(first);
    expect(decode).toHaveBeenCalledExactlyOnceWith(original);
    expect(dimensions).toEqual([[256, 256]]);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 15231, 2304, 2304, 0, 0, 256, 256);
    expect(close).toHaveBeenCalledOnce();
    expect(await original.text()).toBe("original bytes");
  });

  it("releases the decoded image when thumbnail encoding fails", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 500, height: 500, close })),
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage: vi.fn() };
        }
        async convertToBlob() {
          throw new Error("encoder unavailable");
        }
      },
    );
    expect(await createComposerImageThumbnail(makeFile(5))).toBeNull();
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("compressImageForStash", () => {
  it("stores a small image verbatim without re-encoding", async () => {
    const bitmapSpy = vi.fn();
    vi.stubGlobal("createImageBitmap", bitmapSpy);

    const result = await compressImageForStash(makeFile(1024));

    expect(result.ok).toBe(true);
    expect(result.ok && result.image.recompressed).toBe(false);
    expect(result.ok && result.image.mimeType).toBe("image/png");
    expect(result.ok && result.image.dataUrl.startsWith("data:image/png")).toBe(true);
    // Untouched payloads must not pay for a decode.
    expect(bitmapSpy).not.toHaveBeenCalled();
  });

  it("re-encodes an oversized image to WebP within the budget", async () => {
    // Comfortably under budget at the very first quality step.
    const { close, fillRect } = stubCanvasPipeline(() => 120_000);

    const result = await compressImageForStash(makeFile(4_000_000));

    expect(result.ok).toBe(true);
    expect(result.ok && result.image.recompressed).toBe(true);
    expect(result.ok && result.image.mimeType).toBe("image/webp");
    expect(result.ok && result.image.dataUrl.length <= MAX_STASH_IMAGE_DATA_URL_CHARS).toBe(true);
    // sizeBytes should describe the re-encoded payload, not the 4MB original.
    expect(result.ok && result.image.sizeBytes).toBeLessThan(4_000_000);
    // WebP keeps alpha, so no white matte should be painted.
    expect(fillRect).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("falls back to JPEG with a white matte when WebP encoding is unavailable", async () => {
    const { fillRect } = stubCanvasPipeline(() => 120_000, { supportsWebp: false });

    const result = await compressImageForStash(makeFile(4_000_000));

    expect(result.ok && result.image.recompressed).toBe(true);
    expect(result.ok && result.image.mimeType).toBe("image/jpeg");
    // JPEG has no alpha, so transparent regions must be matted white.
    expect(fillRect).toHaveBeenCalled();
  });

  it("steps quality down until the encoded image fits", async () => {
    // Only the lowest quality step (0.68) lands under the budget.
    const { close } = stubCanvasPipeline((quality) => (quality <= 0.68 ? 400_000 : 3_000_000));

    const result = await compressImageForStash(makeFile(9_000_000));

    expect(result.ok && result.image.recompressed).toBe(true);
    expect(result.ok && result.image.dataUrl.length <= MAX_STASH_IMAGE_DATA_URL_CHARS).toBe(true);
    expect(close).toHaveBeenCalled();
  });

  it("reports too-large when even the smallest encoding overflows the budget", async () => {
    const { close } = stubCanvasPipeline(() => 8_000_000);

    const result = await compressImageForStash(makeFile(9_000_000));

    expect(result).toEqual({ ok: false, reason: "too-large" });
    // The bitmap must still be released on the give-up path.
    expect(close).toHaveBeenCalled();
  });

  it("reports too-large for an oversized image when the browser cannot re-encode", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    vi.stubGlobal("OffscreenCanvas", undefined);

    expect(await compressImageForStash(makeFile(4_000_000))).toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("reports unreadable when the image fails to decode", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("corrupt image");
      }),
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return null;
        }
      },
    );

    expect(await compressImageForStash(makeFile(4_000_000))).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("compressImageToByteLimit passes small files through byte-for-byte", async () => {
    const bitmapSpy = vi.fn();
    vi.stubGlobal("createImageBitmap", bitmapSpy);

    const original = makeFile(1024);
    const result = await compressImageToByteLimit(original, 10 * 1024 * 1024);

    expect(result.ok).toBe(true);
    expect(result.ok && result.recompressed).toBe(false);
    // Pass-through must be the same File object, not a copy.
    expect(result.ok && result.file).toBe(original);
    expect(bitmapSpy).not.toHaveBeenCalled();
  });

  it("compressImageToByteLimit re-encodes an oversized file under the byte cap", async () => {
    stubCanvasPipeline(() => 200_000);

    const result = await compressImageToByteLimit(makeFile(2_000_000), 1_000_000);

    expect(result.ok).toBe(true);
    expect(result.ok && result.recompressed).toBe(true);
    expect(result.ok && result.file.type).toBe("image/webp");
    // The re-encoded name must match the new container format.
    expect(result.ok && result.file.name).toBe("shot.webp");
    expect(result.ok && result.file.size).toBeLessThanOrEqual(1_000_000);
  });

  it("compressImageToByteLimit refuses sources above the decode-safety ceiling", async () => {
    const bitmapSpy = vi.fn();
    vi.stubGlobal("createImageBitmap", bitmapSpy);

    const result = await compressImageToByteLimit(
      makeFile(MAX_COMPRESSIBLE_SOURCE_BYTES + 1),
      10 * 1024 * 1024,
    );

    expect(result).toEqual({ ok: false, reason: "too-large" });
    // The whole point of the ceiling is to never decode such a file.
    expect(bitmapSpy).not.toHaveBeenCalled();
  });

  it("compressImageToByteLimit reports too-large when no encoding fits", async () => {
    const { close } = stubCanvasPipeline(() => 3_000_000);

    const result = await compressImageToByteLimit(makeFile(2_000_000), 1_000_000);

    expect(result).toEqual({ ok: false, reason: "too-large" });
    expect(close).toHaveBeenCalled();
  });

  it("shrinks below the source size when the image is already under MAX_DIMENSION", async () => {
    // A small-but-heavy source (e.g. a dense PNG): only a real downscale can
    // get it under budget, since quality alone is stubbed to never suffice.
    let smallestRequested = Number.POSITIVE_INFINITY;
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 800, height: 600, close })),
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {
          smallestRequested = Math.min(smallestRequested, width);
        }
        getContext() {
          return { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
        }
        async convertToBlob({ type }: { type: string; quality: number }) {
          // Only a genuinely downscaled pass fits the budget.
          const size = smallestRequested < 800 ? 100_000 : 5_000_000;
          return new Blob([new Uint8Array(size)], { type });
        }
      },
    );

    const result = await compressImageForStash(makeFile(4_000_000));

    expect(result.ok).toBe(true);
    // Fallback passes must scale off the bitmap, not a fixed 2048 ceiling
    // that would never go below an 800px source.
    expect(smallestRequested).toBeLessThan(800);
  });
});
