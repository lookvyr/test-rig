import { makeRelayClientTracingLayer } from "@t3tools/shared/relayTracing";

export const headlessRelayClientTracingLayer = makeRelayClientTracingLayer();

export const serverRelayBrokerTracingLayer = makeRelayClientTracingLayer();
