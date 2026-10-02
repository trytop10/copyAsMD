#!/usr/bin/env bash
#
# Package the "Copy as Markdown" extension for the Chrome Web Store and for
# Firefox.
#
#   Chrome  -> dist/copy-as-markdown-chrome-v<version>.zip   (Manifest V3)
#   Firefox -> dist/copy-as-markdown-firefox-v<version>.xpi  (Manifest V2)
#
# Usage:
#   ./build.sh            # build both targets
#   ./build.sh chrome     # build the Chrome zip only
#   ./build.sh firefox    # build the Firefox xpi only
#   ./build.sh clean      # remove the dist directory
#   ./build.sh help       # show this message
#
set -euo pipefail

# Resolve the repository root so the script works from any directory.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"

# Base name used for the generated archives.
BASE_NAME="copy-as-markdown"

# Files that both targets ship. The manifest is handled separately because
# every store expects it to be named exactly "manifest.json".
COMMON_FILES=(
  "background.js"
  "content.js"
  "pdf.html"
  "pdf.js"
  "vendor/turndown.js"
  "vendor/turndown-plugin-gfm.js"
  "vendor/marked.js"
  "vendor/marked.js.map"
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# Read "version" from a manifest without requiring jq.
read_version() {
  local manifest="$1"
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1
}

# Fail early when a manifest is not valid JSON so a broken package is never
# produced silently.
validate_manifest() {
  local manifest="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json, sys; json.load(open(sys.argv[1]))' "$manifest" \
      || die "Invalid JSON in $(basename "$manifest")"
  elif command -v node >/dev/null 2>&1; then
    node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$manifest" \
      || die "Invalid JSON in $(basename "$manifest")"
  else
    warn "Neither python3 nor node is available; skipping the JSON check."
  fi
}

# Archive the contents of a staging directory. The staged manifest ends up at
# the root of the archive, which is what the browsers expect.
make_archive() {
  local stage_dir="$1"
  local output_file="$2"

  rm -f "$output_file"
  mkdir -p "$(dirname "$output_file")"

  if command -v zip >/dev/null 2>&1; then
    # -q quiet, -r recursive, -X drop extra file attributes for a cleaner,
    # more reproducible archive.
    ( cd "$stage_dir" && zip -q -r -X "$output_file" . )
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$stage_dir" "$output_file" <<'PY'
import os
import sys
import zipfile

stage_dir, output_file = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(output_file, "w", zipfile.ZIP_DEFLATED) as archive:
    for folder, _dirs, files in os.walk(stage_dir):
        for name in sorted(files):
            path = os.path.join(folder, name)
            archive.write(path, os.path.relpath(path, stage_dir))
PY
  else
    die "Neither 'zip' nor 'python3' is available to create archives."
  fi
}

# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------

# Staging directories are tracked so a single EXIT trap can remove them all,
# even when the script aborts halfway through.
STAGE_DIRS=()
cleanup() {
  local dir
  for dir in "${STAGE_DIRS[@]:-}"; do
    if [ -n "$dir" ]; then
      rm -rf "$dir"
    fi
  done
  # Never let the trap change the exit status of the script.
  return 0
}
trap cleanup EXIT

# build_target <name> <extension> <manifest> [icon...]
build_target() {
  local name="$1"        # chrome | firefox, used in the file name
  local extension="$2"   # zip | xpi
  local manifest="$3"    # manifest source file, copied in as manifest.json
  shift 3
  local icons=("$@")

  local manifest_path="$ROOT_DIR/$manifest"
  [ -f "$manifest_path" ] || die "Missing manifest: $manifest"
  validate_manifest "$manifest_path"

  local version
  version="$(read_version "$manifest_path")"
  [ -n "$version" ] || die "Could not read the version from $manifest"

  local stage_dir
  stage_dir="$(mktemp -d)"
  STAGE_DIRS+=("$stage_dir")

  local file
  for file in "${COMMON_FILES[@]}" "${icons[@]}"; do
    [ -f "$ROOT_DIR/$file" ] || die "Missing required file: $file"
    mkdir -p "$stage_dir/$(dirname "$file")"
    cp "$ROOT_DIR/$file" "$stage_dir/$file"
  done

  cp "$manifest_path" "$stage_dir/manifest.json"

  local output_file="$DIST_DIR/${BASE_NAME}-${name}-v${version}.${extension}"
  make_archive "$stage_dir" "$output_file"

  log "Built $(basename "$output_file")"
}

build_chrome() {
  # Manifest V3 build: ships both icon sizes.
  build_target "chrome" "zip" "manifest.json.chrome" "48.png" "128.png"
}

build_firefox() {
  # Manifest V2 build: the Firefox manifest only references the 48px icon.
  build_target "firefox" "xpi" "manifest.json.firefox" "48.png"
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

usage() {
  sed -n '3,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

main() {
  case "${1:-all}" in
    all)
      mkdir -p "$DIST_DIR"
      build_chrome
      build_firefox
      echo
      log "Archives are in $DIST_DIR"
      log "Firefox: load the .xpi for testing via about:debugging, or submit it"
      log "         to addons.mozilla.org to get a signed copy for release."
      ;;
    chrome)
      mkdir -p "$DIST_DIR"
      build_chrome
      ;;
    firefox)
      mkdir -p "$DIST_DIR"
      build_firefox
      ;;
    clean)
      rm -rf "$DIST_DIR"
      log "Removed $DIST_DIR"
      ;;
    help|-h|--help)
      usage
      ;;
    *)
      usage
      die "Unknown target: $1"
      ;;
  esac
}

main "$@"
