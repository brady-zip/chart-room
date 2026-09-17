// Completion has no updater, schema materialization, network or credential reads.
if (process.argv[2] === "__complete") {
  const { completionCandidates } = await import("./commands/completion.js");
  const candidates = completionCandidates(process.argv.slice(3));
  if (candidates.length) console.log(candidates.join("\n"));
} else {
  await import("./cli.js");
}
export {};
