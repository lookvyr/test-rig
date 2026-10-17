import {
  HostProcessArguments,
  HostProcessExecutablePath,
  HostProcessPlatform,
  HostProcessWorkingDirectory,
} from "@t3tools/shared/hostProcess";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** Uses this server's source/bundle and exact database, never a global install or home. */
export const resolveDoctorCommand = Effect.fn("resolveDoctorCommand")(function* (
  databasePath: string,
) {
  const args = yield* HostProcessArguments;
  const executable = yield* HostProcessExecutablePath;
  const cwd = yield* HostProcessWorkingDirectory;
  const platform = yield* HostProcessPlatform;
  const path = yield* Path.Path;
  const entrypoint = args[1] === undefined ? undefined : path.resolve(cwd, args[1]);
  if (platform === "win32") {
    const psQuote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
    const command =
      entrypoint === undefined ? "test-rig" : `& ${psQuote(executable)} ${psQuote(entrypoint)}`;
    return `$env:ELECTRON_RUN_AS_NODE='1'; ${command} doctor --database ${psQuote(databasePath)}`;
  }
  const command =
    entrypoint === undefined
      ? "test-rig"
      : `env ELECTRON_RUN_AS_NODE=1 ${quote(executable)} ${quote(entrypoint)}`;
  return `${command} doctor --database ${quote(databasePath)}`;
});

/** Setup uses the running source/bundle entry point; Test Rig has no package-install workflow. */
export const resolveRootCliCommand = (subcommand: string, baseDir: string) =>
  Effect.gen(function* () {
    const args = yield* HostProcessArguments;
    const executable = yield* HostProcessExecutablePath;
    const path = yield* Path.Path;
    const cwd = yield* HostProcessWorkingDirectory;
    const setup = `${subcommand} --base-dir ${quote(baseDir)}`;
    return args[1] === undefined
      ? `sudo test-rig ${setup}`
      : `sudo env ELECTRON_RUN_AS_NODE=1 ${quote(executable)} ${quote(path.resolve(cwd, args[1]))} ${setup}`;
  });
