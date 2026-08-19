import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PlatformError from "effect/PlatformError";
import * as Socket from "effect/unstable/socket/Socket";
import * as ExpoCrypto from "expo-crypto";

import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";

import * as Persistence from "../persistence/layer";

const httpClientLayer = remoteHttpClientLayer(fetch);

const digestAlgorithms: Record<Crypto.DigestAlgorithm, ExpoCrypto.CryptoDigestAlgorithm> = {
  "SHA-1": ExpoCrypto.CryptoDigestAlgorithm.SHA1,
  "SHA-256": ExpoCrypto.CryptoDigestAlgorithm.SHA256,
  "SHA-384": ExpoCrypto.CryptoDigestAlgorithm.SHA384,
  "SHA-512": ExpoCrypto.CryptoDigestAlgorithm.SHA512,
};

const cryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => ExpoCrypto.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.tryPromise({
        try: () => ExpoCrypto.digest(digestAlgorithms[algorithm], new Uint8Array(Array.from(data))),
        catch: (cause) =>
          PlatformError.systemError({
            module: "Crypto",
            method: "digest",
            _tag: "Unknown",
            description: "Could not compute digest",
            cause,
          }),
      }).pipe(Effect.map((buffer) => new Uint8Array(buffer))),
  }),
);

type RuntimeLayerSource =
  | typeof Socket.layerWebSocketConstructorGlobal
  | typeof cryptoLayer
  | typeof httpClientLayer
  | typeof Persistence.layer;

const runtimeLayer = Socket.layerWebSocketConstructorGlobal.pipe(
  Layer.provideMerge(httpClientLayer),
  Layer.provideMerge(cryptoLayer),
  Layer.provideMerge(Persistence.layer),
);

export const runtime: ManagedRuntime.ManagedRuntime<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = ManagedRuntime.make(runtimeLayer);

export const runtimeContextLayer: Layer.Layer<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = Layer.effectContext(runtime.contextEffect);
