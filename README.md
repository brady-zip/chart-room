# chart-room

CLI for managing Datadog dashboards as code. Each dashboard is a `*.dash.jsonc` file in your repo, paired with two Datadog dashboards: a `[TEST]` copy you push to from PR branches, and a prod copy that syncs on merge to `main`.

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

On startup, `chart-room` checks for a newer release (at most once per hour) and replaces its own binary in place. Configure in `~/.config/chart-room/config.toml`:

```toml
[updates]
auto_update = true
pinned_version = ""    # e.g. "1.7.0" to pin; empty for latest
```

## Requirements

- macOS arm64 (binary builds for `darwin-arm64`)
- [`gh`](https://cli.github.com) CLI (used for install, auto-update, and PR comments)
- [`uv`](https://docs.astral.sh/uv/) — `uvx` runs `dogshell` for Datadog API calls
- `DATADOG_API_KEY` and `DATADOG_APP_KEY` exported in your shell

## Commands

| Command                        | Description                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `init <file>`                  | Create paired `[TEST]` and prod dashboards. Creates the file from a template if it doesn't exist. |
| `link [--test] <file> <id>`    | Link an existing Datadog dashboard ID to a local file.                                            |
| `test <file>`                  | Upload local definition to the `[TEST]` dashboard (auto-injects a banner linking to prod).        |
| `prod <file>`                  | Upload local definition to the prod dashboard.                                                    |
| `status <file>`                | Show linked IDs, validate they exist in Datadog, and diff local vs. prod.                         |
| `comment <file>`               | Add a `[TEST]` dashboard link as a comment on the current branch's PR.                            |
| `scan`                         | Walk the repo for `*.dash.jsonc` files and refresh the local cache (powers shell completion).     |
| `completion <bash\|zsh\|fish>` | Print a shell completion script.                                                                  |

## Shell completion

```bash
# bash
eval "$(chart-room completion bash)"

# zsh
eval "$(chart-room completion zsh)"

# fish
chart-room completion fish > ~/.config/fish/completions/chart-room.fish
```

Completion uses the cache populated by `scan` to suggest dashboard file paths.

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

The leading `//` comment is stamped on every file chart-room writes, so anyone who stumbles onto the file knows what produced it and how to install the tool. You can add your own comments anywhere in the file, but note that `init` and `link` rewrite the file and only the generated header comment survives that rewrite.

Files created before the switch to `.dash.jsonc` still work: `scan` and shell completion pick up `*.dash.json` too, and any path passed explicitly is read regardless of its extension. Rename them at your leisure.

## Schema

`schema/datadog-dashboard.schema.json` ships with chart-room. It is compiled into the binary, so consuming repos no longer need to commit a copy.

Every file chart-room writes gets `$schema` stamped as the first key, pointing at the copy on `main` in this public repo. That one string is identical for every developer, so it commits cleanly and editors resolve it with no setup.

Because the binary carries the schema, every run also drops it at `~/.config/chart-room/datadog-dashboard.schema.json`, rewriting it only when the contents differ — so deleting it heals on the next run, and upgrading chart-room brings the new schema with it. Use that path when you need a local file:

```bash
ajv validate -s ~/.config/chart-room/datadog-dashboard.schema.json -d "**/*.dash.jsonc"
```

Note that `ajv` cannot parse the JSONC comments chart-room writes. Strip them first, or point your validator at a JSONC-aware parser.

## Building from source

```bash
bun install
bun run build      # produces ./chart-room-darwin-arm64
bun run dev        # run from source with --watch
```

Releases are cut by pushing a `v*` tag; `.github/workflows/release.yml` builds the binary on `macos-latest` and attaches it to the GitHub Release.
