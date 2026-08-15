import { makeRelayClientTracingLayer } from "@t3tools/shared/relayTracing";

export const makeTracingLayer = () => makeRelayClientTracingLayer();

export const tracingLayer = makeTracingLayer();
