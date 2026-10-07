import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

export const TrimmedString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transformEffect({
      decode: (value) => Effect.succeed(value.trim()),
      encode: (value) => Effect.succeed(value.trim()),
    }),
  ),
);
// make/encode validate before trimming, so reject whitespace-only input there too.
export const TrimmedNonEmptyString = TrimmedString.check(
  Schema.makeFilter((value: string) => value.trim().length > 0, {
    expected: "a non-blank string",
    toJsonSchema: () => ({ minLength: 1 }),
    arbitrary: { constraint: { minLength: 1 } },
  }),
);

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
export const PortSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

export const IsoDateTime = Schema.String;
export type IsoDateTime = typeof IsoDateTime.Type;

/**
 * Decode explicit wire codecs and omit invalid elements on either side.
 * Keep the unknown-array wire boundary: RPC Exit decoding validates that
 * representation before the element decoder can discard newer members.
 */
export const ForwardCompatibleArray = <Element extends Schema.Top>(element: Element) =>
  Schema.Array(Schema.Unknown).pipe(
    Schema.decodeTo(
      Schema.Array(
        Schema.UndefinedOr(element).pipe(
          // An element this build cannot read becomes a hole, filtered out below.
          Schema.catchDecoding(() => Effect.succeedSome(undefined)),
          // Likewise an element that cannot be encoded is sent as a hole, so one
          // bad element costs only itself rather than the whole payload.
          Schema.catchEncoding(() => Effect.succeedSome(undefined)),
        ),
      ).pipe(
        Schema.decodeTo(
          Schema.Array(
            Schema.UndefinedOr(Schema.toType(element)).pipe(
              Schema.catchEncoding(() => Effect.succeedSome(undefined)),
            ),
          ).check(
            // The holes above are an encoding detail: a decoded value has none, so
            // `Schema.is` and `make` still reject an array that does. Aborts, so a
            // later check on the array never sees a hole.
            Schema.makeFilter(
              (values) => {
                // Every index, not `every`, which skips the holes of a sparse array.
                for (let index = 0; index < values.length; index++) {
                  if (values[index] === undefined) return false;
                }
                return true;
              },
              { expected: "an array without holes" },
              true,
            ),
          ),
          SchemaTransformation.transform<
            ReadonlyArray<Element["Type"]>,
            ReadonlyArray<Element["Type"] | undefined>
          >({
            decode: (values) => values.filter((value) => value !== undefined),
            // An element that fails its own checks is dropped before the wire, so
            // a wrapper that reads the encoded array as JSON values never meets
            // the hole it left.
            encode: (values) => values.filter((value) => value !== undefined),
          }),
        ),
      ),
    ),
  ) as unknown as ForwardCompatibleArray<Element>;
export type ForwardCompatibleArray<Element extends Schema.Top> = Schema.Codec<
  ReadonlyArray<Element["Type"]>,
  ReadonlyArray<unknown>,
  Element["DecodingServices"],
  Element["EncodingServices"]
>;

/**
 * Construct a branded identifier. Enforces non-empty trimmed strings
 */
const makeEntityId = <Brand extends string>(brand: Brand) => {
  return TrimmedNonEmptyString.pipe(Schema.brand(brand));
};

export const ThreadId = makeEntityId("ThreadId");
export type ThreadId = typeof ThreadId.Type;
export const ProjectId = makeEntityId("ProjectId");
export type ProjectId = typeof ProjectId.Type;
export const EnvironmentId = makeEntityId("EnvironmentId");
export type EnvironmentId = typeof EnvironmentId.Type;
export const CommandId = makeEntityId("CommandId");
export type CommandId = typeof CommandId.Type;
export const EventId = makeEntityId("EventId");
export type EventId = typeof EventId.Type;
export const MessageId = makeEntityId("MessageId");
export type MessageId = typeof MessageId.Type;
export const TurnId = makeEntityId("TurnId");
export type TurnId = typeof TurnId.Type;
export const AuthSessionId = makeEntityId("AuthSessionId");
export type AuthSessionId = typeof AuthSessionId.Type;
export const RpcClientId = NonNegativeInt.pipe(Schema.brand("RpcClientId"));
export type RpcClientId = typeof RpcClientId.Type;

export const ProviderItemId = makeEntityId("ProviderItemId");
export type ProviderItemId = typeof ProviderItemId.Type;
export const RuntimeSessionId = makeEntityId("RuntimeSessionId");
export type RuntimeSessionId = typeof RuntimeSessionId.Type;
export const RuntimeItemId = makeEntityId("RuntimeItemId");
export type RuntimeItemId = typeof RuntimeItemId.Type;
export const RuntimeRequestId = makeEntityId("RuntimeRequestId");
export type RuntimeRequestId = typeof RuntimeRequestId.Type;
export const RuntimeTaskId = makeEntityId("RuntimeTaskId");
export type RuntimeTaskId = typeof RuntimeTaskId.Type;
export const ApprovalRequestId = makeEntityId("ApprovalRequestId");
export type ApprovalRequestId = typeof ApprovalRequestId.Type;
export const CheckpointRef = makeEntityId("CheckpointRef");
export type CheckpointRef = typeof CheckpointRef.Type;

export const RunId = makeEntityId("RunId");
export type RunId = typeof RunId.Type;

export const RunAttemptId = makeEntityId("RunAttemptId");
export type RunAttemptId = typeof RunAttemptId.Type;

export const NodeId = makeEntityId("NodeId");
export type NodeId = typeof NodeId.Type;

export const ProviderSessionId = makeEntityId("ProviderSessionId");
export type ProviderSessionId = typeof ProviderSessionId.Type;

export const ProviderThreadId = makeEntityId("ProviderThreadId");
export type ProviderThreadId = typeof ProviderThreadId.Type;

export const ProviderTurnId = makeEntityId("ProviderTurnId");
export type ProviderTurnId = typeof ProviderTurnId.Type;

export const TurnItemId = makeEntityId("TurnItemId");
export type TurnItemId = typeof TurnItemId.Type;

export const ScheduledTaskId = makeEntityId("ScheduledTaskId");
export type ScheduledTaskId = typeof ScheduledTaskId.Type;

export const CheckpointId = makeEntityId("CheckpointId");
export type CheckpointId = typeof CheckpointId.Type;

export const CheckpointScopeId = makeEntityId("CheckpointScopeId");
export type CheckpointScopeId = typeof CheckpointScopeId.Type;

export const ContextHandoffId = makeEntityId("ContextHandoffId");
export type ContextHandoffId = typeof ContextHandoffId.Type;

export const ContextTransferId = makeEntityId("ContextTransferId");
export type ContextTransferId = typeof ContextTransferId.Type;

export const RawEventId = makeEntityId("RawEventId");
export type RawEventId = typeof RawEventId.Type;

export const PlanId = makeEntityId("PlanId");
export type PlanId = typeof PlanId.Type;

export const ForwardCompatibleOptional = <Value extends Schema.Top>(value: Value) => {
  const decodeValue = Schema.decodeUnknownOption(value as never);
  return Schema.optionalKey(
    Schema.Unknown.pipe(
      Schema.decodeTo(
        Schema.UndefinedOr(value),
        SchemaTransformation.transform<Value["Encoded"] | undefined, unknown>({
          decode: (raw) =>
            Option.isSome(decodeValue(raw)) ? (raw as Value["Encoded"]) : undefined,
          encode: (raw) => raw,
        }),
      ),
    ),
  );
};

/**
 * The nullable form, for a persisted setting whose literal set grows over
 * time: a member this build does not know (or a missing key) decodes as null
 * rather than failing the enclosing struct. Encoding is the plain encoding.
 */
export const ForwardCompatibleNullable = <Value extends Schema.Top>(value: Value) => {
  const decodeValue = Schema.decodeUnknownOption(value as never);
  return Schema.Unknown.pipe(
    Schema.decodeTo(
      Schema.NullOr(value),
      SchemaTransformation.transform<Value["Encoded"] | null, unknown>({
        decode: (raw) => (Option.isSome(decodeValue(raw)) ? (raw as Value["Encoded"]) : null),
        encode: (raw) => raw,
      }),
    ),
  );
};

/**
 * A nullable setting whose null is "unset" and never crosses the wire: it
 * decodes from a missing or unknown key and encodes back to a missing key.
 * For a field that older clients decode as a required literal, so a null
 * on the wire would fail their whole settings snapshot.
 */
export const OmittedWhenNull = <Value extends Schema.Top>(value: Value) => {
  const decodeValue = Schema.decodeUnknownOption(value as never);
  return Schema.optionalKey(Schema.Unknown).pipe(
    Schema.decodeTo(
      Schema.NullOr(value),
      SchemaTransformation.transformOptional<Value["Encoded"] | null, unknown>({
        decode: (raw) =>
          Option.some(
            Option.isSome(raw) && Option.isSome(decodeValue(raw.value))
              ? (raw.value as Value["Encoded"])
              : null,
          ),
        encode: (raw) =>
          Option.isSome(raw) && raw.value !== null ? Option.some(raw.value) : Option.none(),
      }),
    ),
  );
};

export const ClientSurface = Schema.Literals(["web", "desktop", "cli"]);
export type ClientSurface = typeof ClientSurface.Type;
