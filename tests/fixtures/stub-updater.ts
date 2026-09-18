import { mock } from "bun:test";

// Preload only in an isolated CLI subprocess; never run the real updater.
mock.module("../../src/lib/updater.js", () => ({
  checkForUpdates: async () => console.log("STUB_UPDATE_SUCCEEDED"),
}));
