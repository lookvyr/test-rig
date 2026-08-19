import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopSingleInstance from "./DesktopSingleInstance.ts";

function makeLayer(input: {
  readonly primary: boolean;
  readonly quit: () => void;
  readonly on: ElectronApp.ElectronApp["Service"]["on"];
}) {
  const electronApp = {
    requestSingleInstanceLock: Effect.succeed(input.primary),
    quit: Effect.sync(input.quit),
    on: input.on,
  } as ElectronApp.ElectronApp["Service"];
  return DesktopSingleInstance.layer.pipe(
    Layer.provide(Layer.succeed(ElectronApp.ElectronApp, electronApp)),
  );
}

describe("DesktopSingleInstance", () => {
  it.effect("registers the second-instance handler in the primary instance", () => {
    const quit = vi.fn();
    const registeredEvents: string[] = [];
    const electronWindow = {} as ElectronWindow.ElectronWindow["Service"];

    return Effect.gen(function* () {
      const singleInstance = yield* DesktopSingleInstance.DesktopSingleInstance;
      const exit = yield* Effect.exit(Effect.scoped(singleInstance.configure));

      assert.isTrue(Exit.isSuccess(exit));
      assert.equal(quit.mock.calls.length, 0);
      assert.deepEqual(registeredEvents, ["second-instance"]);
    }).pipe(
      Effect.provide(
        makeLayer({
          primary: true,
          quit,
          on: (eventName) => Effect.sync(() => registeredEvents.push(eventName)),
        }),
      ),
      Effect.provideService(ElectronWindow.ElectronWindow, electronWindow),
    );
  });

  it.effect("quits and interrupts startup in a secondary instance", () => {
    const quit = vi.fn();
    const registeredEvents: string[] = [];
    const electronWindow = {} as ElectronWindow.ElectronWindow["Service"];

    return Effect.gen(function* () {
      const singleInstance = yield* DesktopSingleInstance.DesktopSingleInstance;
      const exit = yield* Effect.exit(Effect.scoped(singleInstance.configure));

      assert.isTrue(Exit.hasInterrupts(exit));
      assert.equal(quit.mock.calls.length, 1);
      assert.deepEqual(registeredEvents, []);
    }).pipe(
      Effect.provide(
        makeLayer({
          primary: false,
          quit,
          on: (eventName) => Effect.sync(() => registeredEvents.push(eventName)),
        }),
      ),
      Effect.provideService(ElectronWindow.ElectronWindow, electronWindow),
    );
  });

  it.effect("reveals the current window when a second instance starts", () => {
    const window = {} as never;
    const reveal = vi.fn();
    let listener: (() => void) | undefined;
    const electronWindow = {
      currentMainOrFirst: Effect.succeed(Option.some(window)),
      reveal: () => Effect.sync(reveal),
    } as unknown as ElectronWindow.ElectronWindow["Service"];

    return Effect.gen(function* () {
      const singleInstance = yield* DesktopSingleInstance.DesktopSingleInstance;
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* singleInstance.configure;
          listener?.();
          yield* Effect.yieldNow;
        }),
      );

      assert.equal(reveal.mock.calls.length, 1);
    }).pipe(
      Effect.provide(
        makeLayer({
          primary: true,
          quit: vi.fn(),
          on: (_eventName, nextListener) =>
            Effect.sync(() => {
              listener = nextListener as () => void;
            }),
        }),
      ),
      Effect.provideService(ElectronWindow.ElectronWindow, electronWindow),
    );
  });
});
