import { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

import {
  type ConnectionRegistration,
  ConnectionCredential,
  ConnectionProfile,
} from "../connection/catalog.ts";
import {
  BearerConnectionTarget,
  type ConnectionTarget,
  PersistedConnectionTarget,
  SshConnectionTarget,
} from "../connection/model.ts";

export const StoredConnectionCredential = Schema.Struct({
  connectionId: Schema.String,
  credential: ConnectionCredential,
});
export type StoredConnectionCredential = typeof StoredConnectionCredential.Type;

const CurrentConnectionCatalogDocument = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  targets: Schema.Array(PersistedConnectionTarget),
  profiles: Schema.Array(ConnectionProfile),
  credentials: Schema.Array(StoredConnectionCredential),
});

const LegacyRelayConnectionTarget = Schema.Struct({
  _tag: Schema.Literal("RelayConnectionTarget"),
  environmentId: EnvironmentId,
  label: Schema.String,
});

const LegacyConnectionCatalogDocument = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  targets: Schema.Array(
    Schema.Union([BearerConnectionTarget, SshConnectionTarget, LegacyRelayConnectionTarget]),
  ),
  profiles: Schema.Array(ConnectionProfile),
  credentials: Schema.Array(StoredConnectionCredential),
  remoteDpopTokens: Schema.Array(Schema.Unknown),
});

const ConnectionCatalogDocumentSource = Schema.Union([
  CurrentConnectionCatalogDocument,
  LegacyConnectionCatalogDocument,
]);
type ConnectionCatalogDocumentSource = typeof ConnectionCatalogDocumentSource.Type;
const decodeCurrentConnectionCatalogDocument = Schema.decodeUnknownSync(
  CurrentConnectionCatalogDocument,
);

export const ConnectionCatalogDocument = ConnectionCatalogDocumentSource.pipe(
  Schema.decodeTo(CurrentConnectionCatalogDocument, {
    decode: SchemaGetter.transform((document) =>
      document.schemaVersion === 2
        ? document
        : {
            schemaVersion: 2 as const,
            targets: document.targets.filter(
              (target): target is BearerConnectionTarget | SshConnectionTarget =>
                target._tag !== "RelayConnectionTarget",
            ),
            profiles: document.profiles,
            credentials: document.credentials,
          },
    ),
    encode: SchemaGetter.transform(
      (document): ConnectionCatalogDocumentSource =>
        decodeCurrentConnectionCatalogDocument(document),
    ),
  }),
);
export type ConnectionCatalogDocument = typeof ConnectionCatalogDocument.Type;

export const EMPTY_CONNECTION_CATALOG_DOCUMENT: ConnectionCatalogDocument = Object.freeze({
  schemaVersion: 2,
  targets: [],
  profiles: [],
  credentials: [],
});

export function replaceCatalogValue<A>(
  values: ReadonlyArray<A>,
  key: (value: A) => string,
  next: A,
): ReadonlyArray<A> {
  const nextKey = key(next);
  return [...values.filter((value) => key(value) !== nextKey), next];
}

export function removeCatalogValue<A>(
  values: ReadonlyArray<A>,
  key: (value: A) => string,
  removedKey: string,
): ReadonlyArray<A> {
  return values.filter((value) => key(value) !== removedKey);
}

function connectionIdOf(target: ConnectionTarget): string | null {
  switch (target._tag) {
    case "PrimaryConnectionTarget":
      return null;
    case "BearerConnectionTarget":
    case "SshConnectionTarget":
      return target.connectionId;
  }
}

function removeConnectionMetadata(
  document: ConnectionCatalogDocument,
  target: ConnectionTarget,
): ConnectionCatalogDocument {
  const connectionId = connectionIdOf(target);
  return {
    ...document,
    targets: removeCatalogValue(
      document.targets,
      (value) => value.environmentId,
      target.environmentId,
    ),
    profiles:
      connectionId === null
        ? document.profiles
        : removeCatalogValue(document.profiles, (value) => value.connectionId, connectionId),
    credentials:
      connectionId === null
        ? document.credentials
        : removeCatalogValue(document.credentials, (value) => value.connectionId, connectionId),
  };
}

export function registerConnectionInCatalog(
  document: ConnectionCatalogDocument,
  registration: ConnectionRegistration,
): ConnectionCatalogDocument {
  const target = registration.target;
  const previous = document.targets.find(
    (candidate) => candidate.environmentId === target.environmentId,
  );
  const cleaned = previous === undefined ? document : removeConnectionMetadata(document, previous);
  const next: ConnectionCatalogDocument = {
    ...cleaned,
    targets: replaceCatalogValue(cleaned.targets, (value) => value.environmentId, target),
  };

  switch (registration._tag) {
    case "BearerConnectionRegistration":
      return {
        ...next,
        profiles: replaceCatalogValue(
          next.profiles,
          (value) => value.connectionId,
          registration.profile,
        ),
        credentials: replaceCatalogValue(next.credentials, (value) => value.connectionId, {
          connectionId: registration.target.connectionId,
          credential: registration.credential,
        }),
      };
    case "SshConnectionRegistration":
      return {
        ...next,
        profiles: replaceCatalogValue(
          next.profiles,
          (value) => value.connectionId,
          registration.profile,
        ),
      };
  }
}

export function removeConnectionFromCatalog(
  document: ConnectionCatalogDocument,
  target: ConnectionTarget,
): ConnectionCatalogDocument {
  return removeConnectionMetadata(document, target);
}
