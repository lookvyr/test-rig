import {
  isOrchestrationV2WorkActive,
  OrchestrationV2CommandOutputError,
  type OrchestrationV2CommandOutputFrame,
  type OrchestrationV2SubscribeCommandOutputInput,
} from "@t3tools/contracts";
import {
  appendTerminalOutput,
  EMPTY_TERMINAL_OUTPUT,
  normalizeTerminalOutput,
  type TerminalOutputState,
  TERMINAL_OUTPUT_TAIL_CHARS,
} from "@t3tools/shared/terminalOutput";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as EventSink from "./EventSink.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

/**
 * Live command output.
 *
 * Adapters send raw chunks directly here, outside orchestration events. The hub
 * keeps 64 running terminal tails and 16 finished display snapshots. Each open
 * row retains one snapshot and a one-slot wake queue. Frames contain at most
 * 65,536 UTF-16 code units, sent at most four times per second; hidden rows
 * receive nothing. Only the server interprets cursor movement and split escapes.
 */

/** Fastest a subscriber receives frames while output flows. */
export const COMMAND_OUTPUT_FRAME_INTERVAL_MS = 250;
/** Running commands tracked at once; the least recently written is dropped beyond this. */
const MAX_LIVE_COMMANDS = 64;
/** Finished tails kept for a settle that reports no output of its own (an interrupt). */
const MAX_FINISHED_COMMANDS = 16;
/** Bound normalization work for an individual chunk or persisted result. */
const MAX_SOURCE_CHARS = TERMINAL_OUTPUT_TAIL_CHARS * 4;

type OutputSnapshot = Pick<TerminalOutputState, "text" | "truncated">;

interface Subscriber {
  /** Retained until unmount, even if other commands evict the shared cache. */
  tail: OutputSnapshot | undefined;
  readonly wake: Queue.Queue<void>;
}

export type CommandOutputTarget = OrchestrationV2SubscribeCommandOutputInput;

export interface CommandOutputHubShape {
  /** Add raw output for a running command. Called for every provider chunk. */
  readonly append: (input: CommandOutputTarget & { readonly chunk: string }) => Effect.Effect<void>;
  /**
   * The command settled. Its tail is kept briefly for a settle that carries no
   * output (an interrupt); otherwise the persisted output is what rows show.
   */
  readonly finish: (input: CommandOutputTarget) => Effect.Effect<void>;
  /** Frames for one row until its command settles; see `OrchestrationV2CommandOutputFrame`. */
  readonly subscribe: (
    input: CommandOutputTarget,
  ) => Stream.Stream<OrchestrationV2CommandOutputFrame, OrchestrationV2CommandOutputError>;
}

export class CommandOutputHub extends Context.Service<CommandOutputHub, CommandOutputHubShape>()(
  "t3/orchestration-v2/CommandOutputHub",
) {}

const isCommandOutputError = Schema.is(OrchestrationV2CommandOutputError);

function commandKey(target: CommandOutputTarget): string {
  return `${target.threadId}\x00${target.itemId}`;
}

/** Claude Bash rows stored before #15505 hold the raw `{ stdout, stderr, interrupted, ... }` result. */
const decodeLegacyClaudeBashResult = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ stdout: Schema.String, stderr: Schema.String, interrupted: Schema.Boolean }),
  ),
);

function legacyClaudeBashOutput(output: string): string {
  if (!output.trimStart().startsWith('{"stdout"')) return output;
  const parsed = decodeLegacyClaudeBashResult(output);
  if (Option.isNone(parsed)) return output;
  const out = parsed.value.stdout.trim().length > 0 ? parsed.value.stdout : "";
  const err = parsed.value.stderr.trim().length > 0 ? parsed.value.stderr : "";
  return out.length > 0 && err.length > 0 && !out.endsWith("\n") ? `${out}\n${err}` : out + err;
}

function boundedSource(output: string): string {
  if (output.length > MAX_SOURCE_CHARS) {
    // Start on a fresh line, so the cut can't land inside an escape sequence.
    let source = output.slice(output.length - MAX_SOURCE_CHARS);
    const newline = source.indexOf("\n");
    if (newline !== -1 && newline + 1 < source.length) source = source.slice(newline + 1);
    // Detach the retained slice from an arbitrarily large provider string.
    return Buffer.from(source, "utf16le").toString("utf16le");
  }
  return output;
}

/** The output a row shows from a persisted item, bounded before normalization. */
function persistedCommandOutput(output: string): OutputSnapshot {
  const source = boundedSource(output);
  const normalized = normalizeTerminalOutput(source);
  return {
    text: normalized.text,
    truncated: normalized.truncated || source.length !== output.length,
  };
}

/** Sets `key` as the newest entry of `map`, dropping the oldest beyond `max`. */
function setBounded<V>(map: Map<string, V>, key: string, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  if (map.size <= max) return;
  const oldest = map.keys().next().value!;
  map.delete(oldest);
}

export const make = Effect.gen(function* () {
  const eventSink = yield* EventSink.EventSinkV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  // Insertion order doubles as recency: every write re-inserts its entry.
  const tails = new Map<string, TerminalOutputState>();
  const finished = new Map<string, OutputSnapshot>();
  const subscribers = new Map<string, Set<Subscriber>>();

  const wakeAll = (key: string, tail: OutputSnapshot) =>
    Effect.forEach(
      subscribers.get(key) ?? [],
      (subscriber) => {
        subscriber.tail = tail;
        return Queue.offer(subscriber.wake, undefined);
      },
      { discard: true },
    );

  const append: CommandOutputHubShape["append"] = ({ chunk, ...target }) =>
    Effect.suspend(() => {
      if (chunk.length === 0) return Effect.void;
      const key = commandKey(target);
      const source = boundedSource(chunk);
      // After dropping raw bytes, old cursor/style state cannot describe the gap.
      const previous =
        source.length === chunk.length
          ? (tails.get(key) ?? EMPTY_TERMINAL_OUTPUT)
          : { ...EMPTY_TERMINAL_OUTPUT, truncated: true };
      const tail = appendTerminalOutput(previous, source);
      setBounded(tails, key, tail, MAX_LIVE_COMMANDS);
      return wakeAll(key, { text: tail.text, truncated: tail.truncated });
    });

  const finish: CommandOutputHubShape["finish"] = (target) =>
    Effect.sync(() => {
      const key = commandKey(target);
      const tail = tails.get(key);
      if (tail === undefined) return;
      tails.delete(key);
      setBounded(
        finished,
        key,
        { text: tail.text, truncated: tail.truncated },
        MAX_FINISHED_COMMANDS,
      );
    });

  const subscribe: CommandOutputHubShape["subscribe"] = (target) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const key = commandKey(target);
        const wake = yield* Queue.sliding<void>(1);
        const initialTail = tails.get(key) ?? finished.get(key);
        const subscriber: Subscriber = {
          tail:
            initialTail === undefined
              ? undefined
              : { text: initialTail.text, truncated: initialTail.truncated },
          wake,
        };
        // Attach before reading anything, so no chunk falls between a read and the attach.
        const keySubscribers = subscribers.get(key) ?? new Set<Subscriber>();
        keySubscribers.add(subscriber);
        subscribers.set(key, keySubscribers);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            keySubscribers.delete(subscriber);
            if (keySubscribers.size === 0 && subscribers.get(key) === keySubscribers) {
              subscribers.delete(key);
            }
          }),
        );

        // The bounded event stream carries only change notifications. Read output
        // from the projection at the frame rate, never queue raw item output here.
        let snapshotOutput: OutputSnapshot | undefined;
        let lost: Cause.Cause<unknown> | undefined;
        let settled = false;
        let refreshItem = true;
        const fromSequence = yield* eventSink.latestSequence({ threadId: target.threadId });
        yield* eventSink
          .stream({
            threadId: target.threadId,
            afterSequence: fromSequence,
            eventType: "turn-item.updated",
            bounded: true,
          })
          .pipe(
            Stream.runForEach((stored) =>
              stored.event.type === "turn-item.updated" && stored.event.payload.id === target.itemId
                ? Effect.sync(() => {
                    refreshItem = true;
                  }).pipe(Effect.andThen(Queue.offer(wake, undefined)))
                : Effect.void,
            ),
            // Without its event stream the row can never settle: end with an error
            // instead of waiting forever.
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                lost = cause;
              }).pipe(Effect.andThen(Queue.offer(wake, undefined))),
            ),
            Effect.forkScoped,
          );
        yield* Queue.offer(wake, undefined);

        let lastFrameAt: number | undefined;
        const nextFrame = Effect.gen(function* (): Effect.fn.Return<
          OrchestrationV2CommandOutputFrame,
          OrchestrationV2CommandOutputError
        > {
          yield* Queue.take(wake);
          const now = yield* Clock.currentTimeMillis;
          if (lastFrameAt !== undefined && now - lastFrameAt < COMMAND_OUTPUT_FRAME_INTERVAL_MS) {
            yield* Effect.sleep(COMMAND_OUTPUT_FRAME_INTERVAL_MS - (now - lastFrameAt));
          }
          lastFrameAt = yield* Clock.currentTimeMillis;
          if (lost !== undefined) {
            return yield* new OrchestrationV2CommandOutputError({
              threadId: target.threadId,
              message: "Lost the thread's event stream.",
              cause: Cause.squash(lost),
            });
          }
          if (refreshItem) {
            refreshItem = false;
            const item = yield* projections.getTurnItem(target).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationV2CommandOutputError({
                    threadId: target.threadId,
                    message: "Failed to read command output.",
                    cause,
                  }),
              ),
            );
            if (item === null || item.type !== "command_execution") {
              return yield* new OrchestrationV2CommandOutputError({
                threadId: target.threadId,
                message: "No such command.",
              });
            }
            settled = !isOrchestrationV2WorkActive(item.status);
            snapshotOutput =
              item.output === undefined
                ? undefined
                : persistedCommandOutput(legacyClaudeBashOutput(item.output));
          }
          const output = settled
            ? (snapshotOutput ?? subscriber.tail)
            : (subscriber.tail ?? snapshotOutput);
          return {
            kind: "replace",
            text: output?.text ?? "",
            truncated: output?.truncated ?? false,
            running: !settled,
          };
        });
        return Stream.fromEffectRepeat(nextFrame).pipe(
          Stream.changesWith(
            (previous, next) =>
              previous.text === next.text &&
              previous.truncated === next.truncated &&
              previous.running === next.running,
          ),
          Stream.takeUntil((frame) => !frame.running),
        );
      }).pipe(
        Effect.mapError((cause) =>
          isCommandOutputError(cause)
            ? cause
            : new OrchestrationV2CommandOutputError({
                threadId: target.threadId,
                message: "Failed to read command output.",
                cause,
              }),
        ),
      ),
    );

  return CommandOutputHub.of({ append, finish, subscribe });
});

export const layer: Layer.Layer<
  CommandOutputHub,
  never,
  EventSink.EventSinkV2 | ProjectionStore.ProjectionStoreV2
> = Layer.effect(CommandOutputHub, make);
