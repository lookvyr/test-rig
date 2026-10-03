import { OpenCode, type SessionMessageInfo, type V2Event } from "@opencode/client";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type { OpenCode2Connection, OpenCode2Runtime } from "./OpenCode2Runtime.ts";

/** Exercises the official Promise client's HTTP encoding without a live server. */
export const makeOpenCode2Fixture = Effect.gen(function* () {
  const events = yield* Queue.unbounded<V2Event, Cause.Done>();
  const calls = yield* Queue.unbounded<{ path: string; method: string; body: unknown }>();
  const requests: Array<{ path: string; method: string; body: unknown }> = [];
  const sessions = new Map<string, Record<string, unknown>>();
  const messages = new Map<string, Array<SessionMessageInfo>>();
  let serial = 0;
  let leases = 0;
  let subscribed = false;
  const behavior: {
    onPrompt?: (id: string, body: Record<string, unknown>) => void;
    failPrompt?: boolean;
    onRequest?: (url: URL) => Response | undefined;
    active?: Record<string, { type: "running" }>;
  } = {};
  const emit = (event: V2Event) => Queue.offerUnsafe(events, event);
  const client = OpenCode.make({
    baseUrl: "http://fixture.invalid",
    fetch: Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(String(input));
        const path = url.pathname;
        const method = init?.method ?? "GET";
        const body: Record<string, unknown> =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        const call = { path, method, body };
        requests.push(call);
        Queue.offerUnsafe(calls, call);
        const id = path.split("/")[3] ?? "";
        const json = (data: unknown) => Response.json(data);
        const override = behavior.onRequest?.(url);
        if (override) return override;
        if (path === "/api/session/active") return json({ data: behavior.active ?? {} });
        if ((path === "/api/session" && method === "POST") || path.endsWith("/fork")) {
          const sessionId = `ses_${++serial}`;
          const session = {
            id: sessionId,
            projectID: "global",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1 },
            location: { directory: "/tmp" },
            ...body,
          };
          sessions.set(sessionId, session);
          messages.set(sessionId, []);
          return json({ data: session });
        }
        if (path.endsWith("/message"))
          return json({ data: messages.get(id) ?? [], cursor: { next: null, prev: null } });
        if (path === "/api/agent")
          return json({
            location: { directory: "/tmp" },
            data: [
              { id: "build", name: "Build", mode: "primary", hidden: false, permissions: [] },
              {
                id: "plan",
                name: "Plan",
                mode: "primary",
                hidden: false,
                permissions: [{ action: "edit", resource: "/tmp/plans/*", effect: "allow" }],
              },
            ],
          });
        if (path === "/api/command")
          return json({ location: { directory: "/tmp" }, data: [{ name: "review" }] });
        if (path.endsWith("/prompt")) {
          if (!subscribed) throw new Error("Prompt preceded event subscription");
          if (behavior.failPrompt) return new Response(null, { status: 500 });
          behavior.onPrompt?.(id, body);
          return json({ data: undefined });
        }
        if (path.endsWith("/revert/stage")) return json({ data: {} });
        if (path.endsWith("/interrupt")) return json({});
        if (path.endsWith("/command")) return new Response(null, { status: 204 });
        if (path.endsWith("/compact")) return json({ data: undefined });
        if (/^\/api\/session\/[^/]+$/.test(path)) {
          if (method === "GET")
            return sessions.has(id)
              ? json({ data: sessions.get(id) })
              : new Response(null, { status: 404 });
          if (method === "PATCH") Object.assign(sessions.get(id) ?? {}, body);
          if (method === "DELETE") sessions.delete(id);
          return new Response(null, { status: 204 });
        }
        if (method === "POST" || method === "DELETE") return new Response(null, { status: 204 });
        throw new Error(`Unexpected fixture request ${method} ${path}`);
      },
      { preconnect: () => {} },
    ),
  });
  const connection: OpenCode2Connection = {
    client,
    version: "2.0.18",
    external: true,
    subscribe: Effect.sync(() => {
      subscribed = true;
      return Stream.fromQueue(events);
    }),
  };
  const runtime: OpenCode2Runtime = {
    acquire: Effect.acquireRelease(
      Effect.sync(() => {
        leases++;
        return connection;
      }),
      () =>
        Effect.sync(() => {
          leases--;
        }),
    ),
  };
  let eventSerial = 0;
  const terminal = (
    sessionID: string,
    type:
      | "session.execution.succeeded"
      | "session.execution.interrupted" = "session.execution.succeeded",
  ): V2Event => {
    const base = {
      id: `event${++eventSerial}`,
      created: 1,
      durable: { aggregateID: sessionID, seq: eventSerial, version: 1 as const },
    };
    return type === "session.execution.interrupted"
      ? { ...base, type, data: { sessionID, reason: "user" } }
      : { ...base, type, data: { sessionID } };
  };
  const text = (sessionID: string, text: string): V2Event => ({
    id: `event${++eventSerial}`,
    created: 1,
    type: "session.text.ended",
    durable: { aggregateID: sessionID, seq: eventSerial, version: 1 },
    data: { sessionID, assistantMessageID: "assistant1", ordinal: 0, text },
  });
  return {
    runtime,
    connection,
    events,
    calls,
    requests,
    sessions,
    messages,
    behavior,
    emit,
    terminal,
    text,
    leases: () => leases,
  };
});
