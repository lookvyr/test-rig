import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

/** Private decoding failures use a fixed diagnostic message. */
export const privatePayload = <S extends Schema.Constraint>(schema: S) =>
  Schema.middlewareDecoding<S, S["DecodingServices"]>((decode) =>
    decode.pipe(
      Effect.mapError(() => new SchemaIssue.InvalidValue({ message: "Invalid private input." })),
    ),
  )(schema);
