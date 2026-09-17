import { execFileSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { ChartRoomError } from "./errors.js";

export function sourceFor(file: string, requireClean = false) {
  const cwd = dirname(resolve(file));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    const root = git("rev-parse", "--show-toplevel");
    const path = relative(root, resolve(file)).split("\\").join("/");
    const sha = git("rev-parse", "HEAD");
    const remote = git("remote", "get-url", "origin");
    const repo = remote.match(
      /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/,
    )?.[1];
    if (!repo)
      throw new ChartRoomError(
        "PROVENANCE",
        "Omni publication requires a GitHub origin for source permalinks",
      );
    const tracked = Boolean(git("ls-files", "--", resolve(file)));
    const dirty =
      !tracked || Boolean(git("status", "--porcelain", "--", resolve(file)));
    if (dirty && requireClean)
      throw new ChartRoomError(
        "DIRTY_PRODUCTION",
        "Commit this definition before production publication so its source permalink identifies the exact content. Use test for working-tree previews",
      );
    return { path, sha, repo, dirty };
  } catch (error) {
    if (error instanceof ChartRoomError) throw error;
    throw new ChartRoomError(
      "PROVENANCE",
      "Omni publication requires a Git repository, a commit, and a GitHub origin",
    );
  }
}
