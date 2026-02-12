import { execSync } from "child_process";
import { Command } from "commander";
import { readDashboard } from "../lib/dashboard.js";
import { dashboardUrl } from "../lib/datadog.js";
const COMMENT_MARKER = "<!-- chart-room-test-dashboard -->";
function run(cmd) {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}
function tryRun(cmd) {
    try {
        return run(cmd);
    }
    catch {
        return null;
    }
}
function getCurrentBranch() {
    return run("git rev-parse --abbrev-ref HEAD").trim();
}
function getPrNumber() {
    const branch = getCurrentBranch();
    const result = tryRun(`gh pr view ${branch} --json number --jq .number`);
    return result?.trim() || null;
}
function getExistingComment(prNumber) {
    const comments = tryRun(`gh api repos/{owner}/{repo}/issues/${prNumber}/comments --jq '.[].body'`);
    if (!comments)
        return null;
    const lines = comments.split("\n");
    for (const line of lines) {
        if (line.includes(COMMENT_MARKER)) {
            return line;
        }
    }
    return null;
}
function addComment(prNumber, body) {
    const escaped = body.replace(/'/g, "'\\''");
    run(`gh pr comment ${prNumber} --body '${escaped}'`);
}
export const commentCommand = new Command()
    .name("comment")
    .description("Add test dashboard link as PR comment")
    .argument("<file>", "Path to dashboard JSON file")
    .action((filePath) => {
    const dashboard = readDashboard(filePath);
    if (!dashboard.zip_test_dashboard_id) {
        console.error("Error: No zip_test_dashboard_id set.");
        console.error('Run "init <file>" first to create test dashboard.');
        process.exit(1);
    }
    const prNumber = getPrNumber();
    if (!prNumber) {
        const branch = getCurrentBranch();
        console.log(`No PR found for branch: ${branch}`);
        console.log("\nCreate a PR first:");
        console.log(`  gh pr create`);
        process.exit(0);
    }
    const existing = getExistingComment(prNumber);
    if (existing) {
        console.log(`Comment already exists on PR #${prNumber}`);
        process.exit(0);
    }
    const testUrl = dashboardUrl(dashboard.zip_test_dashboard_id);
    const branch = getCurrentBranch();
    const comment = `${COMMENT_MARKER}
## 📊 Test Dashboard

**Branch:** \`${branch}\`
**Dashboard:** [${dashboard.title}](${testUrl})

Run \`chart-room test ${filePath}\` to update the test dashboard.`;
    addComment(prNumber, comment);
    console.log(`Added test dashboard comment to PR #${prNumber}`);
});
