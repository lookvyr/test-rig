import { describe, expect, it } from "vite-plus/test";

import { cloneUrlRepositoryPath } from "./cloneUrl.ts";

describe("cloneUrlRepositoryPath", () => {
  it("rejects Windows device names and trailing dots or spaces in every folder", () => {
    for (const segment of [
      "CON",
      "nul.txt",
      "COM1",
      "LPT0",
      "com¹",
      "CONIN$",
      "conout$",
      "aux .txt",
      "repo.",
      "repo ",
    ]) {
      expect(cloneUrlRepositoryPath(`https://github.com/${segment}/repo.git`)).toBeNull();
      expect(cloneUrlRepositoryPath(`https://${segment}/owner/repo.git`)).toBeNull();
      expect(cloneUrlRepositoryPath(`https://github.com/owner/${segment}.git`)).toBeNull();
    }
    expect(cloneUrlRepositoryPath("https://github.com/acme/repo.git")).toBe("github.com/acme/repo");
    expect(cloneUrlRepositoryPath("ssh://git@gitlab.com:2222/group/sub/repo.git")).toBe(
      "gitlab.com/group/sub/repo",
    );
    expect(cloneUrlRepositoryPath("C:/repos/project.git")).toBeNull();
  });
});
