# Omni 1.10.0 acceptance record

Date: 2026-09-17. **Live acceptance passed.** Release target: `v1.10.0`, macOS arm64. GitHub's release workflow separately builds and publishes the release artifact.

## Versions and local checks

- Chart-room 1.10.0; Omni definition contract v1 (`.omni.jsonc`).
- Official Omni CLI 1.3.1; official named OAuth profile `zip-chart-room`.
- Pinned OpenAPI SHA256: `12a9bc485e8bcd3d09c2a7cff646e0cd2c2090eb83899c860d31829d426e5a94`; upstream MIT license retained.
- Bun 1.3.13. The macOS build is ad hoc signed, signature-verified, and launched locally. Bun 1.3.12's executable-signing regression was caught before release.
- Full Bun suite: **81 tests, 387 assertions, zero failures**. After a lint-only null-check correction, the 47 affected provider tests passed again. TypeScript, Oxlint, formatting, and whitespace checks passed.
- Tests cover existing Datadog commands, provider routing/mismatch, JSONC comments, mixed/stale/corrupt caches, actual bash/zsh/fish completion with spaces, missing credentials, 401/403/404/409/429/500, archived targets, malformed CLI output, exact argv/JSON stdin, draft conflicts, failed readback, ambiguous writes, aliases, and durable paired creation.
- Evergreen's independent validator accepted both live files. Normalized payloads and exact provenance matched for 99 upserts and 99 deletions, controls, layouts, and settings. The current Evergreen source also rejects empty workbooks; chart-room's generated schema now enforces that requirement. Refreshing its reviewed fixture changed only the upstream implementation hash, not normalized payloads.
- The compiled executable passed offline validation, live remote query planning, live status, and an unchanged test deployment. The earlier compiled checks also covered completion paths containing spaces, both offline schemas, and missing credentials against an isolated official credential store.

## Approved resources

Instance: `https://zip.omniapp.co`.

| Resource          | Verified selection                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared model      | [Default Model](https://zip.omniapp.co/models/d54d65c8-ec71-45da-9c56-0fbe03f54ffe/ide?mode=combined), `d54d65c8-ec71-45da-9c56-0fbe03f54ffe` |
| Production folder | [Chart-room acceptance — prod](https://zip.omniapp.co/f/chart-room-acceptance-prod), `d756391e-7e0e-42ee-accb-36a82de6aa78`                   |
| Test folder       | [Chart-room acceptance — test](https://zip.omniapp.co/f/chart-room-acceptance-test), `2c499c4b-3bf4-416e-b725-8a5154c524c3`                   |
| Profile           | `zip-chart-room`, created through official `omni config init --auth oauth`; credentials remain in official storage                            |

The user explicitly approved both new personal folders. Computer-use sharing inspection showed **Personal**, Brady Watkinson **Owner**, and **Organization: No access** for each. Model-scoped authentication verified workbook/query permissions. No folder permissions or AccessBoost settings were changed. The model editor's three pre-existing missing-view errors did not prevent the selected topic's plans or queries.

## Stable target identifiers

| Target           | ID before updates and after revert             | URL                                                                                                    |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Production       | `cr-prod-906eb007-4c68-4bc1-83c5-d92cf77ed789` | [Production dashboard](https://zip.omniapp.co/dashboards/cr-prod-906eb007-4c68-4bc1-83c5-d92cf77ed789) |
| Test             | `cr-test-af03c15a-e039-4ef9-9c02-221d57704a01` | [Test dashboard](https://zip.omniapp.co/dashboards/cr-test-af03c15a-e039-4ef9-9c02-221d57704a01)       |
| Adoption preview | `cr-test-5e822a55-fa18-4718-8803-68528e57a127` | [Adopted preview](https://zip.omniapp.co/dashboards/cr-test-5e822a55-fa18-4718-8803-68528e57a127)      |

The [acceptance definition and Git revert](https://github.com/brady-zip/chart-room/blob/2b285788d59812ef0e3835254096e4ceaddb5546/acceptance.omni.jsonc) are on branch `omni-acceptance-20260917`. Baseline commit: `ac0da035f9031e333fb510c7b13699c1de48b4f9`; deletion/layout change: `07218e8f1101f3bc6c0b52291d94eeb5d1a71bbd`; revert: `2b285788d59812ef0e3835254096e4ceaddb5546`.

## Recorded live cycle

The canonical baseline contains three rendered query tiles (line, KPI, table), 50 unplaced blank records to exercise batching, two date controls, native layout keys, and explicit settings. Queries use the existing GitHub PR topic with a bounded September 1–14 date range and aggregate counts. Raw query results and credential material are not committed.

| Step                      | Result                                                                                                                                                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create pair               | Different IDs saved before the next operation. One-tab published scaffolds, then 53 tile upserts in batches of **48 + 5**. Native draft and published readbacks verified.                                                                                                                 |
| Remote validation/results | All three query plans reached `PLANNED`. The daily query returned 14 rows; a separately executed KPI query equaled their sum and was nonzero.                                                                                                                                             |
| Browser baseline          | Computer use verified the line chart, native KPI value, table rows, date labels, and custom purple series color. Changing the preview date filter to September 8–14 rendered seven rows and the matching smaller KPI total.                                                               |
| Test update               | Removed 50 tile records in deletion batches of **48 + 2**, deleted the temporary control, reordered KPI/chart layout, changed series color to orange, and enabled crossfilter. Draft and published readbacks passed; the browser showed the new order/color and absent temporary control. |
| Test isolation            | Full production readback SHA256 remained `28248bf24239cd61bfca8ddd3983f473cb0bb2a65199d19afd94ccb8b3582afd` before and after the test upload. Status: test `IN_SYNC`, production `DRIFT`; no draft conflicts.                                                                             |
| Production dry run        | `WOULD_UPDATE`, seven transport calls, **zero writes**. Planned the same deletions/layout/settings.                                                                                                                                                                                       |
| Production apply          | `UPDATED`, verified; deletion batches **48 + 2**. Both targets then reported `IN_SYNC`, with no draft conflicts.                                                                                                                                                                          |
| Repeat                    | Production and test both returned `UNCHANGED`, verified, **zero writes** each.                                                                                                                                                                                                            |
| Git revert                | Restored 53 records, both controls, original layout/color/settings using **48 + 5** upserts on both targets. Status returned both `IN_SYNC`, no drafts; IDs and URLs stayed unchanged.                                                                                                    |
| Compiled binary           | Offline validation passed; remote plans passed; live status passed; test repeat returned `UNCHANGED`, verified.                                                                                                                                                                           |

## Adoption

Imported the already existing, supported acceptance production dashboard through `chart-room import` in a separate checkout. All 53 record keys, record order, and complete container keys/layout were preserved. Production retained its existing ID; only the separate adoption preview was provisioned in the approved test folder. Its publication/readback verified.

A real [Superagents Adoption Dashboard](https://zip.omniapp.co/dashboards/bfc7dc84) was refused with `UNSUPPORTED_RESOURCE` for a draft/workbook query-model dependency. No destination file or target was created and no existing business dashboard was changed. Query-model identifiers are not copied between paired documents.

## Live findings and limits

- The folder API defaults to organization scope; provisioning now explicitly resolves personal/restricted and organization scopes.
- Folder catalog responses use `owner` plus `scope` instead of `ownerId`. Permissions expose `direct` or inherited `folder` grants with `folderInfo`. Document catalog responses omit the constant `type: "document"`. Narrow response adapters validate these observed shapes without weakening the pinned upstream native content schemas. Folder scope and the sharing URL are reported; permit entries alone do not establish organization access.
- The query API requires `query.modelId` and returns `PLANNED` for `planOnly`. Remote validation uses both observed semantics and does not claim query-result verification.
- An initial empty-tab create failed after Omni allocated and archived `cr-prod-f4b3a9ed-d19a-418f-a2f3-9ac99c68c103`. The UI reported its associated model could not be restored. The failed intent was preserved and explicitly retired during this supervised run; no rerun silently allocated a replacement. Empty definitions are now rejected before creation, and large creates retain one seed tab. Archived targets and reserved identifiers have distinct errors. The archived failed artifact remains in Omni's trash; chart-room did not delete it or any old dashboard.
- Omni normalized explicit `automaticVis: false` to `true` on create and patch. Strict readback blocked publication. The pilot was explicitly corrected to `true`, its retained custom visualization configuration was checked, and the reviewed draft was recovered before continuing. Chart-room does not silently ignore the authored flag.
- A top-level stack can round-trip through the API without rendering as a page. The starter uses a native page wrapper. A malformed pilot KPI configuration similarly passed the native API shape but rendered `undefined`; browser acceptance caught it and the native automatic KPI configuration fixed it.
- Native publication has no documented compare-and-swap token. Existing main drafts are refused; ambiguous writes and verification failures require explicit inspection rather than automatic retry/discard. Browser/query acceptance was performed on this approved pair, not every Omni model or visualization.

Local command captures, transport hashes, recovery journals, and query-result evidence are retained under `/private/tmp/chart-room-acceptance-20260917`. The public record contains outcomes and stable links rather than private result values. Evergreen continues to call the official Omni CLI directly; no Linux chart-room artifact is required.
