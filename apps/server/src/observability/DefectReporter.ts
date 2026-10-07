import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as ErrorReporter from "effect/ErrorReporter";

/** RPC typed failures are expected responses; report only unhandled handler defects. */
const reporter: ErrorReporter.ErrorReporter = {
  [ErrorReporter.TypeId]: ErrorReporter.TypeId,
  report: ({ cause, fiber }) => {
    for (const reason of cause.reasons) {
      if (reason._tag !== "Die" || ErrorReporter.isIgnored(reason.defect)) continue;
      // The reporter is synchronous. Preserve the failing fiber's logger context
      // without throwing a reporting failure back into its RPC connection.
      Effect.runForkWith(fiber.context)(
        Effect.logError("Unhandled RPC handler defect", Cause.fromReasons([reason])),
      );
    }
  },
};

export const layer = ErrorReporter.layer([reporter]);
