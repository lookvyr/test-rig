import * as NodeTls from "node:tls";

/** Call once at process startup, before HTTP clients can cache a TLS context. */
export function configureSystemCertificateAuthorities(): void {
  if (typeof NodeTls.setDefaultCACertificates !== "function") {
    throw new Error("Test Rig requires Node.js 22.19+ or 24.10+ to load system certificates.");
  }

  // Keep bundled roots, NODE_EXTRA_CA_CERTS, and any existing trust configuration.
  // Node reads the native trust store (including managed corporate CAs) on each OS.
  NodeTls.setDefaultCACertificates([
    ...new Set([...NodeTls.getCACertificates("default"), ...NodeTls.getCACertificates("system")]),
  ]);
}
