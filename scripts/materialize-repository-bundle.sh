#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/materialize-repository-bundle.sh <artifact.zip|artifact-directory> <destination> [expected-head-sha] [expected-base-sha] [expected-repository]

Verifies the artifact manifest, SHA-256 checksum, Git bundle, declared head/base refs,
and cloned exact HEAD. The destination must not exist.
USAGE
}

if [[ $# -lt 2 || $# -gt 5 ]]; then
  usage >&2
  exit 64
fi

source_path=$1
destination=$2
expected_head=${3:-}
expected_base=${4:-}
expected_repository=${5:-}

if [[ -e "$destination" ]]; then
  echo "Destination already exists: $destination" >&2
  exit 1
fi

cleanup=''
verify_repo=$(mktemp -d)
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

trap '[[ -n "$cleanup" ]] && rm -rf "$cleanup"; rm -rf "$verify_repo"' EXIT

manifest="$artifact_dir/bundle-manifest.json"
if [[ ! -f "$manifest" ]]; then
  echo "Missing bundle-manifest.json in $artifact_dir" >&2
  exit 1
fi

readarray -t manifest_values < <(
  python3 - "$manifest" <<'PY'
import json
import re
import sys
from pathlib import PurePosixPath

with open(sys.argv[1], encoding='utf-8') as handle:
    manifest = json.load(handle)
required = [
    'schemaVersion',
    'repository',
    'requestedRef',
    'baseRef',
    'headSha',
    'baseSha',
    'bundleFile',
    'bundleSha256',
    'checkoutBranch',
    'baseBranch',
]
missing = [key for key in required if manifest.get(key) in (None, '')]
if missing:
    raise SystemExit(f"Manifest is missing required keys: {', '.join(missing)}")
if manifest['schemaVersion'] != 1:
    raise SystemExit(f"Unsupported manifest schemaVersion: {manifest['schemaVersion']}")
if not re.fullmatch(r'[0-9a-f]{40}', manifest['headSha']):
    raise SystemExit('Manifest headSha must be a lowercase 40-character SHA.')
if not re.fullmatch(r'[0-9a-f]{40}', manifest['baseSha']):
    raise SystemExit('Manifest baseSha must be a lowercase 40-character SHA.')
if not re.fullmatch(r'[0-9a-f]{64}', manifest['bundleSha256']):
    raise SystemExit('Manifest bundleSha256 must be a lowercase SHA-256 value.')
if not re.fullmatch(r'[^/\s]+/[^/\s]+', manifest['repository']):
    raise SystemExit('Manifest repository must use owner/name form.')
bundle_path = PurePosixPath(manifest['bundleFile'])
if bundle_path.is_absolute() or '..' in bundle_path.parts or len(bundle_path.parts) != 1:
    raise SystemExit('Manifest bundleFile must be a single relative filename.')
if manifest['checkoutBranch'] != 'agent-head' or manifest['baseBranch'] != 'agent-base':
    raise SystemExit('Manifest branch names must be agent-head and agent-base.')
for key in required:
    print(manifest[key])
PY
)

schema_version=${manifest_values[0]}
manifest_repository=${manifest_values[1]}
requested_ref=${manifest_values[2]}
base_ref=${manifest_values[3]}
manifest_head=${manifest_values[4]}
manifest_base=${manifest_values[5]}
bundle_file=${manifest_values[6]}
manifest_checksum=${manifest_values[7]}
checkout_branch=${manifest_values[8]}
base_branch=${manifest_values[9]}
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
if [[ -n "$expected_base" && "$manifest_base" != "$expected_base" ]]; then
  echo "Manifest base mismatch: expected $expected_base, got $manifest_base" >&2
  exit 1
fi
if [[ -n "$expected_repository" && "$manifest_repository" != "$expected_repository" ]]; then
  echo "Manifest repository mismatch: expected $expected_repository, got $manifest_repository" >&2
  exit 1
fi

git init --bare "$verify_repo" > /dev/null
git -C "$verify_repo" bundle verify "$bundle"
listed_head=$(git bundle list-heads "$bundle" "refs/heads/$checkout_branch" | awk 'NR == 1 {print $1}')
listed_base=$(git bundle list-heads "$bundle" "refs/heads/$base_branch" | awk 'NR == 1 {print $1}')
if [[ "$listed_head" != "$manifest_head" ]]; then
  echo "Bundle head ref mismatch: expected $manifest_head, got ${listed_head:-missing}" >&2
  exit 1
fi
if [[ "$listed_base" != "$manifest_base" ]]; then
  echo "Bundle base ref mismatch: expected $manifest_base, got ${listed_base:-missing}" >&2
  exit 1
fi

git clone --branch "$checkout_branch" "$bundle" "$destination"
actual_head=$(git -C "$destination" rev-parse HEAD)
if [[ "$actual_head" != "$manifest_head" ]]; then
  echo "Cloned HEAD mismatch: expected $manifest_head, got $actual_head" >&2
  exit 1
fi
git -C "$destination" cat-file -e "${manifest_base}^{commit}"

git -C "$destination" status --short --branch
echo "Materialized verified repository bundle at $destination ($actual_head; base $manifest_base; repository $manifest_repository; requested $requested_ref; base ref $base_ref; schema $schema_version)."
