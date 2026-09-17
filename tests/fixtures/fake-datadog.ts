// Test-only subprocess: never accesses a network or real credentials.
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
const path = process.env.FAKE_STATE!;
const state = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : { dashboards: {}, comments: [] };
const args = process.argv.slice(2);
const input = await Bun.stdin.text();
appendFileSync(
  process.env.FAKE_CALLS!,
  JSON.stringify({ executable: process.env.FAKE_EXECUTABLE, args, input }) +
    "\n",
);
const emit = (v: unknown) => console.log(JSON.stringify(v));
if (process.env.FAKE_ERROR) {
  console.error(`HTTP ${process.env.FAKE_ERROR} SECRET_SHOULD_BE_REDACTED`);
  process.exit(1);
}
if (process.env.FAKE_EXECUTABLE === "omni") {
  if (args[0] === "--version") console.log("omni version 1.3.1");
  else if (args[0] === "documents" && args[1] === "--help")
    console.log(
      "v2-create v2-get list-drafts v2-patch-draft v2-patch-draft-by-identifier v2-get-draft v2-publish-draft",
    );
  else throw new Error("Unexpected Omni API call");
} else if (process.env.FAKE_EXECUTABLE === "gh") {
  if (args[0] === "pr") emit({ number: 7 });
  else if (args.includes("--paginate")) emit([state.comments]);
  else {
    const body = JSON.parse(input).body;
    if (args.includes("PATCH")) state.comments[0].body = body;
    else state.comments.push({ id: 17, body });
    emit({});
  }
} else {
  const action = args[4];
  if (action === "post") {
    const id = `dd-${Object.keys(state.dashboards).length + 1}`;
    if (process.env.FAIL_SECOND_CREATE && id === "dd-2") {
      console.error("HTTP 403 secret");
      process.exit(1);
    }
    state.dashboards[id] = {
      title: args[5],
      widgets: JSON.parse(args[6]!),
      layout_type: args[7],
      description: args.includes("--description")
        ? args[args.indexOf("--description") + 1]
        : "",
    };
    emit({ id, title: args[5] });
  } else if (action === "show") {
    if (!state.dashboards[args[5]!]) {
      console.error("HTTP 404 secret");
      process.exit(1);
    }
    emit(state.dashboards[args[5]!]);
  } else if (action === "update") {
    state.dashboards[args[5]!] = {
      title: args[6],
      layout_type: args[7],
      widgets: JSON.parse(input),
      description: args.includes("--description")
        ? args[args.indexOf("--description") + 1]
        : "",
    };
    emit({});
  } else {
    console.error("unexpected test action");
    process.exit(1);
  }
}
writeFileSync(path, JSON.stringify(state));
