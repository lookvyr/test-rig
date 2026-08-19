import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const AdvertisedEndpointReachability = Schema.Literals([
  "loopback",
  "lan",
  "public",
]);
export type AdvertisedEndpointReachability = typeof AdvertisedEndpointReachability.Type;

export const AdvertisedEndpointStatus = Schema.Literals(["available", "unknown"]);
export type AdvertisedEndpointStatus = typeof AdvertisedEndpointStatus.Type;

export const AdvertisedEndpoint = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  httpBaseUrl: TrimmedNonEmptyString,
  wsBaseUrl: TrimmedNonEmptyString,
  reachability: AdvertisedEndpointReachability,
  status: AdvertisedEndpointStatus,
  isDefault: Schema.optional(Schema.Boolean),
  description: Schema.optional(TrimmedNonEmptyString),
});
export type AdvertisedEndpoint = typeof AdvertisedEndpoint.Type;
