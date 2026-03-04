#!/bin/bash
set -e

REPO="brady-zip/chart-room"
TOOL="chart-room"
ASSET="chart-room-darwin-arm64"
INSTALL_DIR="$HOME/.local/bin"
CONFIG_DIR="$HOME/.config/$TOOL"

# Require gh CLI
if ! command -v gh &>/dev/null; then
  echo "Error: gh CLI is required. Install from https://cli.github.com"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "Error: gh CLI is not authenticated. Run: gh auth login"
  exit 1
fi

VERSION="${1:-latest}"

mkdir -p "$INSTALL_DIR"

if [ "$VERSION" = "latest" ]; then
  gh release download --repo "$REPO" --pattern "$ASSET" --output "$INSTALL_DIR/$TOOL" --clobber
else
  TAG="v$VERSION"
  [[ "$VERSION" == v* ]] && TAG="$VERSION"
  gh release download "$TAG" --repo "$REPO" --pattern "$ASSET" --output "$INSTALL_DIR/$TOOL" --clobber
fi

chmod +x "$INSTALL_DIR/$TOOL"
xattr -d com.apple.quarantine "$INSTALL_DIR/$TOOL" 2>/dev/null || true

# Create default config if not exists
if [ ! -f "$CONFIG_DIR/config.toml" ]; then
  mkdir -p "$CONFIG_DIR"
  cat > "$CONFIG_DIR/config.toml" << 'TOML'
[updates]
auto_update = true
pinned_version = ""
TOML
  echo "Created config at $CONFIG_DIR/config.toml"
fi

echo "$TOOL installed to $INSTALL_DIR/$TOOL"

# Warn if not in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo "Warning: $INSTALL_DIR is not in your PATH"
  echo "Add this to your shell profile: export PATH=\"$INSTALL_DIR:\$PATH\""
fi
