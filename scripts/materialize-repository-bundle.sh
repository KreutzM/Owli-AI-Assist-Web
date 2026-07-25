#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/materialize-repository-bundle.sh <artifact.zip|artifact-directory> <destination> [expected-head-sha]

Verifies the artifact manifest, SHA-256 checksum, and Git bundle, then clones the
bundle's agent-head branch into the destination. The destination must not exist.
USAGE
}

if [[ $# -lt 2 || $# -gt 3 ]]; then
  usage >&2
  exit 64
fi

source_path=$1
destination=$2
expected_head=${3:-}

if [[ -e "$destination" ]]; then
  echo "Destination already exists: $destination" >&2
  exit 1
fi

cleanup=''
if [[ -d "$source_path" ]]; then
  artifact_dir=$(cd "$source_path" && pwd)
elif [[ -f "$source_path" ]]; then
  artifact_dir=$(mktemp -d)
  cleanup=$artifact_dir
  unzip -q "$source_path" -d "$artifact_dir"
else
  echo "Artifact path does not exist: $source_path" >&2
  exit 1
fi

trap '[[ -n "$cleanup" ]] && rm -rf "$cleanup"' EXIT

manifest="$artifact_dir/bundle-manifest.json"
if [[ ! -f "$manifest" ]]; then
  echo "Missing bundle-manifest.json in $artifact_dir" >&2
  exit 1
fi

readarray -t manifest_values < <(
  python3 - "$manifest" <<'PY'
import json
import sys

with open(sys.argv[1], encoding='utf-8') as handle:
    manifest = json.load(handle)
required = ['headSha', 'bundleFile', 'bundleSha256', 'checkoutBranch']
missing = [key for key in required if not manifest.get(key)]
if missing:
    raise SystemExit(f"Manifest is missing required keys: {', '.join(missing)}")
for key in required:
    print(manifest[key])
PY
)

manifest_head=${manifest_values[0]}
bundle_file=${manifest_values[1]}
manifest_checksum=${manifest_values[2]}
checkout_branch=${manifest_values[3]}
bundle="$artifact_dir/$bundle_file"

if [[ ! -f "$bundle" ]]; then
  echo "Manifest bundle does not exist: $bundle" >&2
  exit 1
fi

actual_checksum=$(sha256sum "$bundle" | awk '{print $1}')
if [[ "$actual_checksum" != "$manifest_checksum" ]]; then
  echo "Bundle checksum mismatch: expected $manifest_checksum, got $actual_checksum" >&2
  exit 1
fi

if [[ -n "$expected_head" && "$manifest_head" != "$expected_head" ]]; then
  echo "Manifest head mismatch: expected $expected_head, got $manifest_head" >&2
  exit 1
fi

git bundle verify "$bundle"
git clone --branch "$checkout_branch" "$bundle" "$destination"
actual_head=$(git -C "$destination" rev-parse HEAD)
if [[ "$actual_head" != "$manifest_head" ]]; then
  echo "Cloned HEAD mismatch: expected $manifest_head, got $actual_head" >&2
  exit 1
fi

git -C "$destination" status --short --branch
echo "Materialized verified repository bundle at $destination ($actual_head)."
