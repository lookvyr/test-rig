import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";

export class DesktopSingleInstance extends Context.Service<
  DesktopSingleInstance,
  {
    readonly configure: Effect.Effect<void, never, ElectronWindow.ElectronWindow | Scope.Scope>;
  }
>()("@t3tools/desktop/app/DesktopSingleInstance") {}

export const make = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;
  const isPrimaryInstance = yield* electronApp.requestSingleInstanceLock;

  return DesktopSingleInstance.of({
    configure: Effect.gen(function* () {
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
      const runPromise = Effect.runPromiseWith(context);

      if (!isPrimaryInstance) {
        yield* electronApp.quit;
        return yield* Effect.interrupt;
      }

      yield* electronApp.on("second-instance", () => {
        void runPromise(
          Effect.gen(function* () {
            const mainWindow = yield* electronWindow.currentMainOrFirst;
            if (Option.isSome(mainWindow)) {
              yield* electronWindow.reveal(mainWindow.value);
            }
          }),
        );
      });
    }).pipe(Effect.withSpan("desktop.singleInstance.configure")),
  });
});

export const layer = Layer.effect(DesktopSingleInstance, make);
