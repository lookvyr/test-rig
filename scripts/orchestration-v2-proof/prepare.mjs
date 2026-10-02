import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

const root = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const upstream = process.argv[2];
if (!upstream)
  throw new Error(
    "Usage: node scripts/orchestration-v2-proof/prepare.mjs <upstream-git-checkout> [source-database]",
  );
const revision = "de343914273eceb852a1d1d739cd1d38df7796ee";
const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "test-rig-v2-proof-"));
console.log(`Migration proof workspace: ${directory}`);
const exec = (command, args) =>
  NodeChildProcess.execFileSync(command, args, { cwd: directory, stdio: "inherit" });
const archive = NodePath.join(directory, "source.tar");
exec("git", [
  "-C",
  NodePath.resolve(upstream),
  "archive",
  "--format=tar",
  `--output=${archive}`,
  revision,
  "apps/server/src",
  "packages/contracts",
  "packages/shared",
  "LICENSE",
]);
exec("tar", ["-xf", archive]);
NodeFS.unlinkSync(archive);
const persistence = NodePath.join(directory, "apps/server/src/persistence");
NodeFS.cpSync(
  NodePath.join(root, "apps/server/src/persistence/Migrations"),
  NodePath.join(persistence, "Migrations"),
  { recursive: true },
);
NodeFS.copyFileSync(
  NodePath.join(root, "apps/server/src/persistence/Migrations.ts"),
  NodePath.join(persistence, "ForkMigrations.ts"),
);
NodeFS.cpSync(
  NodePath.join(root, "scripts/orchestration-v2-proof/harness"),
  NodePath.join(directory, "proof"),
  { recursive: true },
);
exec("git", ["apply", NodePath.join(root, "scripts/orchestration-v2-proof/fork.patch")]);
for (const name of ["package.json", "package-lock.json"])
  NodeFS.copyFileSync(
    NodePath.join(root, "scripts/orchestration-v2-proof", name),
    NodePath.join(directory, name),
  );
exec("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--fetch-retries=0"]);
NodeFS.mkdirSync(NodePath.join(directory, "node_modules/@t3tools"), { recursive: true });
for (const name of ["contracts", "shared"])
  NodeFS.symlinkSync(
    NodePath.join(directory, "packages", name),
    NodePath.join(directory, "node_modules/@t3tools", name),
  );
exec(NodePath.join(root, "node_modules/.bin/tsgo"), [
  "--noEmit",
  "--module",
  "nodenext",
  "--target",
  "esnext",
  "--allowImportingTsExtensions",
  "--skipLibCheck",
  "--strict",
  "--types",
  "node",
  "--typeRoots",
  NodePath.join(root, "node_modules/@types"),
  "proof/migration-proof.mts",
]);
NodeChildProcess.execFileSync(process.execPath, ["--test", "proof/migration-proof.mts"], {
  cwd: directory,
  stdio: "inherit",
  env: {
    ...process.env,
    ...(process.argv[3] ? { TEST_RIG_PROOF_SOURCE: NodePath.resolve(process.argv[3]) } : {}),
  },
});
