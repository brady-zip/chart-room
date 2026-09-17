# chart-room

CLI for managing paired Datadog and Omni dashboards as code. Datadog keeps its existing `*.dash.jsonc` format and default commands. Omni uses a versioned `*.omni.jsonc` envelope, an existing shared model, and separate production and test documents.

Version 1.10.0 implements Omni contract v1. Its live acceptance and release status are recorded separately in [the acceptance record](OMNI_ACCEPTANCE.md).

## Workflow

1. `init` — create paired `[TEST]` and prod dashboards in Datadog from a local JSON file. The IDs are written back into the file as `zip_test_dashboard_id` and `zip_dashboard_id`.
2. Edit the JSON locally.
3. `test <file>` — push your changes to the `[TEST]` dashboard so reviewers can see the live result.
4. `comment <file>` — drop a link to the `[TEST]` dashboard on the open PR (idempotent).
5. On merge, your CI runs `prod <file>` to sync the production dashboard.

`status <file>` shows which IDs are linked, fetches the remote dashboards, and reports any drift between local and prod.

## Install from a release

Releases publish a self-contained macOS arm64 binary (`chart-room-darwin-arm64`) to GitHub Releases. The install script downloads the latest release via the `gh` CLI and drops it into `~/.local/bin`.

```bash
# Requires gh CLI authenticated (gh auth login)
curl -fsSL https://raw.githubusercontent.com/brady-zip/chart-room/main/scripts/install.sh | bash
```

To pin a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/brady-zip/chart-room/main/scripts/install.sh | bash -s -- 1.7.0
```

Make sure `~/.local/bin` is on your `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### Auto-updates

Datadog's interactive commands check for a newer release (at most once per hour) and can replace the binary in place. Offline validation, completion, Omni operations, and JSON output skip the update check. Configure in `~/.config/chart-room/config.toml`:

```toml
[updates]
auto_update = true
pinned_version = ""    # e.g. "1.7.0" to pin; empty for latest
```

## Requirements

- macOS arm64 (binary builds for `darwin-arm64`)
- [`gh`](https://cli.github.com) CLI (used for install, auto-update, and PR comments)
- For Datadog: [`uv`](https://docs.astral.sh/uv/) (`uvx` runs `dogshell`), with `DATADOG_API_KEY` and `DATADOG_APP_KEY` exported in your shell
- For Omni: the [official Omni CLI 1.3.1](https://github.com/exploreomni/cli/releases/tag/v1.3.1), using an official profile or `OMNI_API_TOKEN`

## Commands

| Command                        | Description                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `init <file>`                  | Create paired `[TEST]` and prod dashboards. Creates the file from a template if it doesn't exist. |
| `link [--test] <file> <id>`    | Link an existing Datadog dashboard ID to a local file.                                            |
| `test <file>`                  | Upload local definition to the `[TEST]` dashboard (auto-injects a banner linking to prod).        |
| `prod <file>`                  | Upload local definition to the prod dashboard.                                                    |
| `status <file>`                | Show linked IDs, validate they exist in Datadog, and diff local vs. prod.                         |
| `comment <file>`               | Add a `[TEST]` dashboard link as a comment on the current branch's PR.                            |
| `scan`                         | Index Datadog and Omni definitions and refresh the repository's completion cache.                 |
| `completion <bash\|zsh\|fish>` | Print a shell completion script.                                                                  |

All file commands retain their Datadog defaults. Existing Omni files must have both the `.omni.jsonc` suffix and `version: 1, provider: "omni"`; conflicting flags or filenames fail before any network call. Credentials never determine a file's provider. Shared options are `--provider datadog|omni`, `--profile <name>`, and `--format human|json`.

| Addition                                                                             | Behavior                                                                              |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `init <file> --provider omni --model <id> --prod-folder <id> --test-folder <id>`     | Validate the model and folders, then create missing paired documents.                 |
| `import <id> <file> --provider omni --test-folder <id>`                              | Adopt supported production content and create its separate test target.               |
| `link [--test] <file> <id>`                                                          | For Omni, verify model compatibility and normalize aliases before linking.            |
| `prod <file> --dry-run`                                                              | Inspect proposed changes without mutation.                                            |
| `status <file> --json`                                                               | Report test/prod drift, draft conflicts, permissions failures, and last verification. |
| `validate <file> [--remote]`                                                         | Validate offline; opt in to Omni model/field/query-plan validation.                   |
| `auth login --provider omni [--profile <name>]`                                      | Delegate to official `omni config init`.                                              |
| `auth status --provider omni [--profile <name>] [--model <id>]`                      | Check identity and resolved model permissions.                                        |
| `omni models`, `omni topics --model <id>`, `omni fields --model <id> --topic <name>` | Discover native authoring names; `--refresh` also caches completion candidates.       |

## Shell completion

```bash
# bash
eval "$(chart-room completion bash)"

# zsh
eval "$(chart-room completion zsh)"

# fish
chart-room completion fish > ~/.config/fish/completions/chart-room.fish
```

Completion supports both providers and paths containing spaces. `scan` rebuilds the file cache, scoped by repository and provider; `scan --provider omni` refreshes only Omni entries. Legacy cache entries migrate as Datadog. Corrupt caches rebuild without changing definitions. Explicit discovery `--refresh` updates the authoring catalog. An unsuccessful refresh preserves the last catalog and reports the error. Tab completion makes no network calls and never reads credentials.

## Dashboard file format

A `*.dash.jsonc` file is a Datadog dashboard JSON payload with a few extra fields. Files are JSONC, so comments and trailing commas are allowed:

```jsonc
// Generated with chart-room. Install it with: curl -fsSL .../install.sh | bash — see https://github.com/brady-zip/chart-room for more details.
{
  // $schema resolves over the network — no local setup needed. Offline, or for
  // validators like `ajv`, any chart-room run drops a copy at
  // ~/.config/chart-room/datadog-dashboard.schema.json
  "$schema": "https://raw.githubusercontent.com/brady-zip/chart-room/main/schema/datadog-dashboard.schema.json",
  "_meta": {
    "intent": "...",
    "audience": "...",
    "scope": "...",
  },
  "zip_dashboard_id": "abc-123-prod",
  "zip_test_dashboard_id": "abc-123-test",
  "title": "My Dashboard",
  "description": "",
  "layout_type": "ordered",
  "widgets": [],
}
```

The `zip_*` IDs are managed by `init` / `link`. `_meta` is for humans only and ignored by Datadog.

New Datadog files include the generated header comment. `init` and `link` update IDs and `$schema` with a JSONC syntax-tree editor, preserving user comments and unchanged content. Each ID is saved atomically before the next create operation.

Files created before the switch to `.dash.jsonc` still work: `scan` and shell completion pick up `*.dash.json` too, and any path passed explicitly is read regardless of its extension. Rename them at your leisure.

## Schema

`schema/datadog-dashboard.schema.json` ships with chart-room. It is compiled into the binary, so consuming repos no longer need to commit a copy.

Every Datadog file chart-room writes gets `$schema` stamped as the first key, pointing at the copy on `main` in this public repo. That one string is identical for every developer, so it commits cleanly and editors resolve it with no setup.

Because the binary carries the schema, every run also drops it at `~/.config/chart-room/datadog-dashboard.schema.json`, rewriting it only when the contents differ — so deleting it heals on the next run, and upgrading chart-room brings the new schema with it. Use that path when you need a local file:

```bash
ajv validate -s ~/.config/chart-room/datadog-dashboard.schema.json -d "**/*.dash.jsonc"
```

Note that `ajv` cannot parse the JSONC comments chart-room writes. Strip them first, or point your validator at a JSONC-aware parser.

## Omni setup and workflow

Install the pinned official transport on macOS. This script verifies the release archive's SHA256 before installing it:

```bash
bash scripts/install-omni.sh
export PATH="$HOME/.local/bin:$PATH"
chart-room auth login --provider omni --profile zip-chart-room
chart-room auth status --provider omni --profile zip-chart-room --model MODEL_UUID
```

Login invokes `omni config init --name zip-chart-room --endpoint https://zip.omniapp.co`. Complete its interactive setup using the authentication methods the official CLI offers. Chart-room does not store tokens, accept a token flag, or invent a top-level Omni login command. CI can supply `OMNI_API_TOKEN` securely through its environment. Official configuration path overrides (`OMNI_CONFIG_PATH`, `OMNI_CONFIG_DIR`, `XDG_CONFIG_HOME`) remain supported. A profile pointing to another instance is rejected before its credential is forwarded.

Contract v1 currently targets `https://zip.omniapp.co`, matching Evergreen. File operations always use the file's `instance`; `--instance` on initialization/auth/discovery defaults to that host. An explicit instance conflicting with the file is an error.

```bash
chart-room omni models --profile zip-chart-room --refresh
chart-room omni topics --model MODEL_UUID --profile zip-chart-room --refresh
chart-room omni fields --model MODEL_UUID --topic TOPIC_NAME --profile zip-chart-room --refresh

# Inspect official request shapes when authoring native queries or tiles.
omni query run --help
omni query run --schema
omni documents v2-patch-draft --schema

chart-room init "dashboards/team health.omni.jsonc" --provider omni \
  --model MODEL_UUID --prod-folder PROD_FOLDER_UUID --test-folder TEST_FOLDER_UUID \
  --profile zip-chart-room

# Edit the native queries, layout, controls, settings, and _meta.
chart-room validate "dashboards/team health.omni.jsonc"
chart-room validate "dashboards/team health.omni.jsonc" --remote --profile zip-chart-room
chart-room test "dashboards/team health.omni.jsonc" --profile zip-chart-room
chart-room status "dashboards/team health.omni.jsonc" --json --profile zip-chart-room
chart-room comment "dashboards/team health.omni.jsonc"
chart-room prod "dashboards/team health.omni.jsonc" --dry-run --profile zip-chart-room
```

Provisioning publishes immediately. Choose intended folders explicitly, review the printed folder locations and inherited permissions, and use disposable folders for acceptance testing. Chart-room does not alter permissions, enable AccessBoost, or delete old dashboards. With both IDs already present, `init` creates nothing. A new pair starts with one named blank workbook tab and a dashboard page. Omni requires at least one tab; useful queries and rendered behavior need separate verification.

`test` updates only the test identifier and prints its exact URL plus the verification result. Test names gain `[TEST]`, and descriptions gain a warning and production link. The canonical local content remains unchanged. A PR comment includes a provider-specific marker, both links, and the last local test verification; IDs alone never imply publication success.

Normal production deployment is through the repository's merge workflow. The explicit `prod <file>` command remains available and requires a committed, clean definition so the production description can link to its exact GitHub commit. A dirty test preview identifies the working tree and base revision. Evergreen uses its own official CLI deployment integration; it does not need a Linux chart-room artifact.

### Native content and adoption

Omni uses native Documents v2 payloads, without translating Datadog widgets. `document` requires `name`, `description`, `modelId`, `queryPresentations`, `controls`, `settings`, and `containers`. Both target identifiers must be distinct. `_meta` requires nonempty `intent`, `audience`, and `scope`.

All tile/control keys, their order, the layout, and all five settings are owned by the file. Preserve numeric tile record keys and container `instanceKey` values across edits. Remove a key locally to delete it remotely; do not write null deletion tombstones. Supported tiles are `blank`, `query`, `sql`, and `linked`, with the official schema's native visualization configuration. Query plans are checked only with `validate --remote`; query results and browser rendering require separate acceptance.

Use a native `page` container wrapping the visible grid or stack. Top-level stacks can be stored without being displayed as a page. The acceptance instance normalizes explicit `automaticVis: false` to `true`; strict readback rejects that mismatch rather than reporting success. Author the supported value and verify the native `visConfig` in the browser.

```bash
chart-room import PRODUCTION_IDENTIFIER "dashboards/adopted.omni.jsonc" \
  --provider omni --test-folder TEST_FOLDER_UUID --profile zip-chart-room
chart-room link --test "dashboards/adopted.omni.jsonc" TEST_IDENTIFIER --profile zip-chart-room
```

Import reads v2 content, preserves stable record/layout keys, strips only known server identity and exact source provenance, and adopts production before creating test. Unsupported resources fail explicitly. Apps, foreign tabs, CSV/spreadsheet uploads, dataset/dbt/query-view editing, workbook-local semantic extensions, and branch/draft-bound query models require their own migration. Their query-model IDs cannot be copied between documents. Keep those dashboards in Omni until that migration is available. Linked targets are checked for base-model compatibility and duplicate aliases across the repository.

### Reconciliation and recovery

Deployment rejects existing main drafts, including an unchanged deployment. A changed document is reconciled through a new native draft: upsert tiles in batches of at most 48, replace metadata/layout/settings and merge explicit control deletions, delete removed tiles in batches of at most 48, then set final order. Chart-room verifies the specific draft, checks that it is the sole non-stale main draft, publishes, and verifies published content. Readback permits server-added defaults while requiring every explicit desired value and exact tile/control key sets. A repeat apply reports `UNCHANGED` without writing.

Omni publication has no documented compare-and-swap token. Avoid concurrent UI edits to code-managed content. Draft conflicts, PR-required policies, rejected credentials, permission denial, missing targets, rate limits, malformed responses, and network/timeouts are separate structured errors. No ambiguous write is automatically retried or discarded.

Creation stores a unique intended identifier in `<file>.provision.json` before calling Omni, then atomically saves the returned ID in the definition before continuing. Keep that local journal until provisioning has verified. A rerun reads the same intended identifier and verifies its model/content instead of creating another pair. If an attempted create is still not visible, inspect Omni and rerun `init --retry-create` to explicitly retry the same identifier. If local content changed, restore the attempted content first, recover the target, then edit through `test`/`prod`. A large initial definition uses a small published scaffold followed by the same bounded reconciliation. Interrupted updates expose the target/draft IDs for manual recovery; they do not silently discard drafts.

An archived target is distinct from a missing target: its identifier remains reserved. Restore it through Omni before retrying. If Omni reports that the associated model cannot be restored, preserve the journal and resolve that failed creation explicitly; a rerun never silently allocates a replacement identifier.

### Omni schema and interoperability

New Omni files stamp `$schema` first with the versioned URL:
`https://raw.githubusercontent.com/brady-zip/chart-room/v1.10.0/schema/omni-dashboard.schema.json`.
An offline copy is materialized beside Datadog's schema at `~/.config/chart-room/omni-dashboard.schema.json`. `chart-room validate` accepts JSONC directly. Datadog's existing schema and stamped URL remain unchanged.

The generator wraps the [official CLI v1.3.1 OpenAPI](https://github.com/exploreomni/cli/blob/v1.3.1/api/openapi.json), SHA256 `12a9bc485e8bcd3d09c2a7cff646e0cd2c2090eb83899c860d31829d426e5a94`, in the supported contract v1 envelope. Native visualization types are retained. The upstream MIT license is in [schema/LICENSE.omni](schema/LICENSE.omni).

```bash
bun run schema:omni
# Validate fixtures and compare normalized deployment payloads against Evergreen:
uv run --with jsonschema==4.23.0 --no-project python \
  scripts/check-evergreen-contract.py /path/to/evergreen
```

The comparison includes more than 48 additions and deletions, control tombstones, layout/settings, and exact production/test provenance. Pass `--update` only when intentionally refreshing golden fixtures after reviewing both implementations. Schema compatibility and offline mocks do not replace the live acceptance gate.

## Building from source

Use Bun 1.3.13, pinned in `.tool-versions` and the release workflow. Bun 1.3.12 has a [macOS executable signing regression](https://github.com/oven-sh/bun/issues/29361); a successful compile alone does not verify that its artifact launches.

```bash
bun install
bun test           # requires bash, zsh, and fish for completion acceptance
bun run typecheck
bun run build      # produces ./chart-room-darwin-arm64
bun run dev        # run from source with --watch
```

Releases are cut by pushing a `v*` tag; `.github/workflows/release.yml` runs tests and typechecking, builds the macOS arm64 binary, and attaches it to the GitHub Release. Omni release acceptance additionally requires the recorded disposable-pair API and browser run.
