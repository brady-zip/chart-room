# chart-room

CLI for managing Datadog dashboards as code. Each dashboard is a `*.dash.json` file in your repo, paired with two Datadog dashboards: a `[TEST]` copy you push to from PR branches, and a prod copy that syncs on merge to `main`.

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

| Command | Description |
| --- | --- |
| `init <file>` | Create paired `[TEST]` and prod dashboards. Creates the file from a template if it doesn't exist. |
| `link [--test] <file> <id>` | Link an existing Datadog dashboard ID to a local file. |
| `test <file>` | Upload local definition to the `[TEST]` dashboard (auto-injects a banner linking to prod). |
| `prod <file>` | Upload local definition to the prod dashboard. |
| `status <file>` | Show linked IDs, validate they exist in Datadog, and diff local vs. prod. |
| `comment <file>` | Add a `[TEST]` dashboard link as a comment on the current branch's PR. |
| `scan` | Walk the repo for `*.dash.json` files and refresh the local cache (powers shell completion). |
| `completion <bash\|zsh\|fish>` | Print a shell completion script. |

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

A `*.dash.json` file is a Datadog dashboard JSON payload with a few extra fields:

```json
{
  "_meta": {
    "intent": "...",
    "audience": "...",
    "scope": "..."
  },
  "zip_dashboard_id": "abc-123-prod",
  "zip_test_dashboard_id": "abc-123-test",
  "title": "My Dashboard",
  "description": "",
  "layout_type": "ordered",
  "widgets": []
}
```

The `zip_*` IDs are managed by `init` / `link`. `_meta` is for humans only and ignored by Datadog.

## Building from source

```bash
bun install
bun run build      # produces ./chart-room-darwin-arm64
bun run dev        # run from source with --watch
```

Releases are cut by pushing a `v*` tag; `.github/workflows/release.yml` builds the binary on `macos-latest` and attaches it to the GitHub Release.
