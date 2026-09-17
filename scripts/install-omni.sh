#!/usr/bin/env bash
# Pinned transport dependency for contract v1. Never handles credentials.
set -euo pipefail

version=1.3.1
if [[ "$(uname -s)" != Darwin ]]; then
  echo "Install the official Omni CLI ${version} for your platform from https://github.com/exploreomni/cli/releases/tag/v${version}" >&2
  exit 1
fi
case "$(uname -m)" in
  arm64) arch=arm64; checksum=3835aa54f1bf4addcb909d37cb3dacba83b163f7dcd091ffb476160b24bbdaca ;;
  x86_64) arch=amd64; checksum=3eb7703f98a083c14267c614e9a47efb3086a157ce3a2b10d3185f77c6ddafdc ;;
  *) echo "Unsupported macOS architecture" >&2; exit 1 ;;
esac
destination="${1:-$HOME/.local/bin}"
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
archive="omni_${version}_darwin_${arch}.tar.gz"
curl --fail --silent --show-error --location "https://github.com/exploreomni/cli/releases/download/v${version}/${archive}" --output "$temporary/$archive"
actual=$(shasum -a 256 "$temporary/$archive")
if [[ "${actual%% *}" != "$checksum" ]]; then
  echo "Official Omni archive checksum mismatch; nothing installed" >&2
  exit 1
fi
tar -xzf "$temporary/$archive" -C "$temporary" omni
if [[ "$("$temporary/omni" --version)" != "omni version ${version}" ]]; then
  echo "Unexpected Omni version; nothing installed" >&2
  exit 1
fi
mkdir -p "$destination"
install -m 755 "$temporary/omni" "$destination/omni"
echo "Installed official Omni ${version} at $destination/omni"
