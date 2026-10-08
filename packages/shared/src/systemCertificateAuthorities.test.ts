// @effect-diagnostics nodeBuiltinImport:off - exercises Node's native TLS trust with local HTTPS servers.
// @effect-diagnostics globalFetch:off - verifies that Node's built-in fetch uses the configured trust store.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeHttps from "node:https";
import * as NodeTls from "node:tls";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { configureSystemCertificateAuthorities } from "./systemCertificateAuthorities.ts";

vi.mock("node:tls", async (importOriginal) => {
  const original = await importOriginal<typeof NodeTls>();
  return { ...original, getCACertificates: vi.fn(original.getCACertificates) };
});

const originalTls = await vi.importActual<typeof NodeTls>("node:tls");
const originalCertificates = originalTls.getCACertificates("default");
// Public test-only key and self-signed certificates; never used outside these tests.
const fixture = (name: string) =>
  NodeFS.readFileSync(new URL(`./fixtures/tls/${name}.pem`, import.meta.url), "utf8");
const certificate = fixture("localhost-cert");
const key = fixture("localhost-key");
const fingerprints = (certificates: string[]) =>
  new Set(certificates.map((pem) => new NodeCrypto.X509Certificate(pem).fingerprint256));

function systemCertificates(certificates: string[]): void {
  vi.mocked(NodeTls.getCACertificates).mockImplementation((type) =>
    type === "system" ? certificates : originalTls.getCACertificates(type),
  );
}

async function listen(server: NodeHttps.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing test port");
  return address.port;
}

function httpsStatus(url: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    NodeHttps.get(url, { agent: false }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
      response.on("error", reject);
    }).on("error", reject);
  });
}

afterEach(() => {
  NodeTls.setDefaultCACertificates(originalCertificates);
  vi.mocked(NodeTls.getCACertificates).mockReset();
});

describe("configureSystemCertificateAuthorities", () => {
  it("preserves existing roots and extra CAs, and is safe to call again", () => {
    NodeTls.setDefaultCACertificates([...originalCertificates, certificate]);
    systemCertificates([certificate, originalCertificates[0]!]);

    configureSystemCertificateAuthorities();
    configureSystemCertificateAuthorities();

    expect(fingerprints(originalTls.getCACertificates("default"))).toEqual(
      fingerprints([...originalCertificates, certificate]),
    );
  });

  it("preserves existing trust when the OS has no additional certificates", () => {
    systemCertificates([]);
    configureSystemCertificateAuthorities();
    expect(fingerprints(originalTls.getCACertificates("default"))).toEqual(
      fingerprints(originalCertificates),
    );
  });

  it("trusts an OS CA for fetch and HTTPS while rejecting untrusted certificates and wrong hostnames", async () => {
    systemCertificates([certificate]);
    await using server = NodeHttps.createServer(
      { key, cert: certificate },
      (_request, response) => {
        response.end("trusted");
      },
    );
    await using untrusted = NodeHttps.createServer(
      { key, cert: fixture("untrusted-cert") },
      (_request, response) => response.end("untrusted"),
    );
    const port = await listen(server);
    const untrustedPort = await listen(untrusted);
    const url = `https://localhost:${port}`;

    await expect(fetch(url)).rejects.toThrow();
    await expect(httpsStatus(url)).rejects.toThrow();

    configureSystemCertificateAuthorities();

    expect(await (await fetch(url)).text()).toBe("trusted");
    expect(await httpsStatus(url)).toBe(200);
    await expect(fetch(`https://127.0.0.1:${port}`)).rejects.toMatchObject({
      cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID" },
    });
    await expect(fetch(`https://localhost:${untrustedPort}`)).rejects.toThrow();
    await expect(httpsStatus(`https://localhost:${untrustedPort}`)).rejects.toThrow();
  });
});
