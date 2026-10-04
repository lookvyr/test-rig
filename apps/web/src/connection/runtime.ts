import { Connection } from "@t3tools/client-runtime/connection";
import { layer as shellSnapshotLoaderLayer } from "@t3tools/client-runtime/state/shellSnapshotHttp";
import { boundedThreadSnapshotLoaderLayer } from "@t3tools/client-runtime/state/boundedThreadSnapshotHttp";
import * as ThreadHistoryController from "@t3tools/client-runtime/state/threadHistoryController";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import { runtimeContextLayer } from "../lib/runtime";
import {
  backgroundActivityObserverLayer,
  backgroundActivityReporterLayer,
} from "../lib/backgroundActivityReporter";
import { connectionPlatformLayer } from "./platform";

const providedConnectionPlatformLayer = connectionPlatformLayer.pipe(
  Layer.provide(runtimeContextLayer),
);

const snapshotLoaderLayer = Layer.mergeAll(
  boundedThreadSnapshotLoaderLayer,
  shellSnapshotLoaderLayer,
  ThreadHistoryController.layer,
);

type ConnectionLayerSource =
  | typeof Connection.layer
  | typeof snapshotLoaderLayer
  | typeof runtimeContextLayer
  | typeof connectionPlatformLayer
  | typeof backgroundActivityObserverLayer
  | typeof backgroundActivityReporterLayer;

const providedClientConnectionLayer = Layer.merge(Connection.layer, snapshotLoaderLayer).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      runtimeContextLayer,
      providedConnectionPlatformLayer,
      backgroundActivityObserverLayer,
    ),
  ),
);

const connectionLayer = backgroundActivityReporterLayer.pipe(
  Layer.provideMerge(providedClientConnectionLayer),
);

export const connectionAtomRuntime: Atom.AtomRuntime<
  Layer.Success<ConnectionLayerSource>,
  Layer.Error<ConnectionLayerSource>
> = Atom.runtime(connectionLayer);
