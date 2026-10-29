import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
} from "../connection/catalog.ts";
import { BearerConnectionTarget } from "../connection/model.ts";
import {
  ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
  registerConnectionInCatalog,
  removeConnectionFromCatalog,
} from "./storageDocument.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const BEARER_TARGET = new BearerConnectionTarget({
  environmentId: ENVIRONMENT_ID,
  label: "Remote",
  connectionId: "bearer-1",
});
const BEARER_PROFILE = new BearerConnectionProfile({
  connectionId: BEARER_TARGET.connectionId,
  environmentId: ENVIRONMENT_ID,
  label: BEARER_TARGET.label,
  httpBaseUrl: "https://remote.example.test",
  wsBaseUrl: "wss://remote.example.test",
});
const BEARER_CREDENTIAL = new BearerConnectionCredential({ token: "bearer-token" });
const decodeConnectionCatalogDocument = Schema.decodeUnknownSync(ConnectionCatalogDocument);
const encodeConnectionCatalogDocument = Schema.encodeSync(ConnectionCatalogDocument);

describe("ConnectionCatalogDocument", () => {
  it("registers and removes a bearer connection atomically", () => {
    const document = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new BearerConnectionRegistration({
        target: BEARER_TARGET,
        profile: BEARER_PROFILE,
        credential: BEARER_CREDENTIAL,
      }),
    );

    expect(document.targets).toEqual([BEARER_TARGET]);
    expect(document.profiles).toEqual([BEARER_PROFILE]);
    expect(document.credentials).toEqual([
      { connectionId: BEARER_TARGET.connectionId, credential: BEARER_CREDENTIAL },
    ]);
    expect(removeConnectionFromCatalog(document, BEARER_TARGET)).toEqual(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
    );
  });

  it("drops legacy relay targets and DPoP tokens while preserving bearer records", () => {
    const decoded = decodeConnectionCatalogDocument({
      schemaVersion: 1,
      targets: [
        BEARER_TARGET,
        { _tag: "RelayConnectionTarget", environmentId: "legacy-relay", label: "Relay" },
      ],
      profiles: [BEARER_PROFILE],
      credentials: [{ connectionId: BEARER_TARGET.connectionId, credential: BEARER_CREDENTIAL }],
      remoteDpopTokens: [{ accessToken: "must-not-survive" }],
    });

    expect(decoded).toEqual({
      schemaVersion: 3,
      targets: [BEARER_TARGET],
      profiles: [BEARER_PROFILE],
      credentials: [{ connectionId: BEARER_TARGET.connectionId, credential: BEARER_CREDENTIAL }],
    });
  });

  it.each([1, 2])("migrates v%s SSH records without losing direct connections", (schemaVersion) => {
    const decoded = decodeConnectionCatalogDocument({
      schemaVersion,
      targets: [
        BEARER_TARGET,
        {
          _tag: "SshConnectionTarget",
          environmentId: "old-ssh",
          label: "Devbox",
          connectionId: "ssh:old-ssh",
        },
      ],
      profiles: [
        BEARER_PROFILE,
        {
          _tag: "SshConnectionProfile",
          connectionId: "ssh:old-ssh",
          environmentId: "old-ssh",
          label: "Devbox",
          target: { alias: "devbox", hostname: "devbox.example.test", username: null, port: null },
        },
      ],
      credentials: [
        { connectionId: BEARER_TARGET.connectionId, credential: BEARER_CREDENTIAL },
        {
          connectionId: "ssh:old-ssh",
          credential: new BearerConnectionCredential({ token: "old-ssh-token" }),
        },
      ],
      remoteDpopTokens: [],
    });
    expect(decoded).toEqual({
      schemaVersion: 3,
      targets: [BEARER_TARGET],
      profiles: [BEARER_PROFILE],
      credentials: [{ connectionId: BEARER_TARGET.connectionId, credential: BEARER_CREDENTIAL }],
    });
    expect(encodeConnectionCatalogDocument(decoded)).not.toHaveProperty("remoteDpopTokens");
  });

  it("rejects SSH targets in current catalogs", () => {
    expect(() =>
      decodeConnectionCatalogDocument({
        ...EMPTY_CONNECTION_CATALOG_DOCUMENT,
        targets: [
          {
            _tag: "SshConnectionTarget",
            connectionId: "ssh:old",
            environmentId: "old",
            label: "Old",
          },
        ],
      }),
    ).toThrow();
  });

  it("encodes the current catalog without reintroducing legacy fields", () => {
    const encoded = encodeConnectionCatalogDocument({
      schemaVersion: 3,
      targets: [BEARER_TARGET],
      profiles: [BEARER_PROFILE],
      credentials: [{ connectionId: BEARER_TARGET.connectionId, credential: BEARER_CREDENTIAL }],
    });

    expect(encoded).toEqual({
      schemaVersion: 3,
      targets: [
        {
          _tag: "BearerConnectionTarget",
          environmentId: ENVIRONMENT_ID,
          label: "Remote",
          connectionId: "bearer-1",
        },
      ],
      profiles: [
        {
          _tag: "BearerConnectionProfile",
          connectionId: "bearer-1",
          environmentId: ENVIRONMENT_ID,
          label: "Remote",
          httpBaseUrl: "https://remote.example.test",
          wsBaseUrl: "wss://remote.example.test",
        },
      ],
      credentials: [
        {
          connectionId: "bearer-1",
          credential: { _tag: "BearerConnectionCredential", token: "bearer-token" },
        },
      ],
    });
  });
});
