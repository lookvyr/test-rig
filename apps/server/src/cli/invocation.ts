import {
  HostProcessArguments,
  HostProcessExecutablePath,
  HostProcessWorkingDirectory,
} from "@t3tools/shared/hostProcess";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

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
