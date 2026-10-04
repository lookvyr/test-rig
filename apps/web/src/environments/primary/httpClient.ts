import { makeEnvironmentHttpApiClient } from "@t3tools/client-runtime/rpc";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { resolvePrimaryEnvironmentHttpUrl } from "./target";

export interface PrimaryEnvironmentHttpApi extends Effect.Success<
  ReturnType<typeof makeEnvironmentHttpApiClient>
> {}

export class PrimaryEnvironmentHttpClient extends Context.Service<
  PrimaryEnvironmentHttpClient,
  PrimaryEnvironmentHttpApi
>()("@t3tools/web/environments/primary/httpClient/PrimaryEnvironmentHttpClient") {}

const make = Effect.suspend(() =>
  makeEnvironmentHttpApiClient(resolvePrimaryEnvironmentHttpUrl("/")),
);

export const layer = Layer.effect(PrimaryEnvironmentHttpClient, make);
