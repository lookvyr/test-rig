import { expect, it } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { ChildProcessSpawner } from "effect/unstable/process";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as GitHubCredentials from "./GitHubCredentials.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

function harness(env: NodeJS.ProcessEnv = {}, enabled = true) {
  const calls: VcsProcess.VcsProcessInput[] = [];
  const layer = GitHubCredentials.layer.pipe(
    Layer.provide(
      Layer.mock(VcsProcess.VcsProcess)({
        run: (input) =>
          Effect.sync(() => {
            calls.push(input);
            return {
              exitCode: ChildProcessSpawner.ExitCode(0),
              stdout: `stored-${calls.length}`,
              stderr: "",
              stdoutTruncated: false,
              stderrTruncated: false,
            };
          }),
      }),
    ),
    Layer.provide(Layer.succeed(HostProcessEnvironment, env)),
    Layer.provide(ServerSettings.layerTest({ sourceControlProviders: { github: enabled } })),
  );
  return { layer, calls };
}

it.effect("caches a stored credential, then observes a changed login after expiry", () => {
  const { layer, calls } = harness();
  return Effect.gen(function* () {
    const credentials = yield* GitHubCredentials.GitHubCredentials;
    const first = yield* credentials.get("GITHUB.COM");
    const second = yield* credentials.get("github.com");
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(calls).toHaveLength(1);
    yield* TestClock.adjust("5 minutes");
    const third = yield* credentials.get("github.com");
    expect(third.fingerprint).not.toBe(first.fingerprint);
    expect(calls).toHaveLength(2);
    yield* credentials.invalidate("github.com");
    yield* credentials.get("github.com");
    expect(calls).toHaveLength(3);
  }).pipe(Effect.provide(layer));
});

it.effect("uses environment auth without launching gh", () => {
  const { layer, calls } = harness({ GH_TOKEN: "env-token" });
  return Effect.gen(function* () {
    const credentials = yield* GitHubCredentials.GitHubCredentials;
    const credential = yield* credentials.get("github.com");
    expect(Redacted.value(credential.token)).toBe("env-token");
    expect(credential.source).toBe("env");
    expect(calls).toHaveLength(0);
  }).pipe(Effect.provide(layer));
});

it.effect("does not let gh hand an enterprise environment token to a different host", () => {
  const { layer, calls } = harness({
    GH_HOST: "trusted.example",
    GH_ENTERPRISE_TOKEN: "enterprise-token",
  });
  return Effect.gen(function* () {
    const credentials = yield* GitHubCredentials.GitHubCredentials;
    expect(Redacted.value((yield* credentials.get("trusted.example")).token)).toBe(
      "enterprise-token",
    );
    expect(Redacted.value((yield* credentials.get("other.example")).token)).toBe("stored-1");
    expect(calls[0]?.env).toMatchObject({
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
      GH_ENTERPRISE_TOKEN: "",
      GITHUB_ENTERPRISE_TOKEN: "",
    });
  }).pipe(Effect.provide(layer));
});

it.effect("disabled GitHub fails before accessing any credentials", () => {
  const { layer, calls } = harness({ GH_TOKEN: "env-token" }, false);
  return Effect.gen(function* () {
    const credentials = yield* GitHubCredentials.GitHubCredentials;
    expect((yield* Effect.flip(credentials.get("github.com")))._tag).toBe(
      "GitHubHostDisabledError",
    );
    expect(calls).toHaveLength(0);
  }).pipe(Effect.provide(layer));
});
