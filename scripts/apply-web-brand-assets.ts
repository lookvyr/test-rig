import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { resolveWebIconOverrides, type WebAssetBrand } from "./lib/brand-assets.ts";

export const applyWebBrandAssets = Effect.fn("applyWebBrandAssets")(function* (
  brand: WebAssetBrand,
  targetDirectory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));

  yield* Effect.forEach(
    resolveWebIconOverrides(brand, targetDirectory),
    (override) =>
      fs.copyFile(
        path.join(repoRoot, override.sourceRelativePath),
        path.join(repoRoot, override.targetRelativePath),
      ),
    { concurrency: "unbounded" },
  );
});
