import { assert, it } from "@effect/vitest";

import { formatServiceStatus } from "./service.ts";

const status = {
  supported: true,
  installed: true,
  current: true,
  unitPath: "/home/me/.config/systemd/user/sightseer.service",
  logPath: "/home/me/.sightseer/userdata/logs/boot-service.log",
} as const;

it("reports the installed service version and host paths", () => {
  assert.equal(
    formatServiceStatus(status, "0.0.29"),
    [
      "Sightseer service",
      "  Status: installed · @lookvyr/sightseer@0.0.29",
      "  Unit: /home/me/.config/systemd/user/sightseer.service",
      "  Logs: /home/me/.sightseer/userdata/logs/boot-service.log",
    ].join("\n"),
  );
});

it("keeps package-backed updates unavailable for a stale service", () => {
  assert.include(
    formatServiceStatus({ ...status, current: false }, "0.0.29"),
    "Source-only builds do not support service updates.",
  );
});

it("keeps package-backed installation unavailable", () => {
  assert.include(
    formatServiceStatus({ ...status, installed: false }, "0.0.29"),
    "Source-only builds do not support service installation.",
  );
});

it("explains service availability without systemd", () => {
  assert.include(
    formatServiceStatus({ ...status, supported: false, installed: false }, "0.0.29"),
    "Supported on: Linux with systemd",
  );
});
