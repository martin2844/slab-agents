#!/usr/bin/env bash

set -euo pipefail

control_plane_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace_dir="$(dirname "$control_plane_dir")"
work_dir="$workspace_dir/slab"
docs_dir="$workspace_dir/slab-docs"
runner_dir="$workspace_dir/slab-runner"
env_file="$control_plane_dir/.env"

for directory in "$work_dir" "$docs_dir" "$runner_dir"; do
  if [[ ! -d "$directory" ]]; then
    echo "Missing required sibling repository: $directory" >&2
    exit 1
  fi
done

if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file. Configure TRACKER_API_KEY and DOCS_API_KEY first." >&2
  exit 1
fi

reachable() {
  local url
  for url in "$@"; do
    if ! curl --silent --show-error --max-time 2 --output /dev/null "$url"; then
      return 1
    fi
  done
}

if reachable "http://127.0.0.1:6970/health" "http://127.0.0.1:6969/mcp"; then
  echo "Slab Work is already available; keeping the existing instance."
else
  echo "Starting Slab Work on loopback..."
  (
    cd "$work_dir"
    BIND_ADDRESS=127.0.0.1 docker compose --env-file "$env_file" up -d --build
  )
fi

if reachable "http://127.0.0.1:6980/health" "http://127.0.0.1:6980/mcp"; then
  echo "Slab Docs is already available; keeping the existing instance."
else
  echo "Starting Slab Docs on loopback..."
  (
    cd "$docs_dir"
    BIND_ADDRESS=127.0.0.1 docker compose --env-file "$env_file" up -d --build
  )
fi

runner_pid=""
control_plane_pid=""

cleanup() {
  trap - EXIT INT TERM
  [[ -n "$control_plane_pid" ]] && kill "$control_plane_pid" 2>/dev/null || true
  [[ -n "$runner_pid" ]] && kill "$runner_pid" 2>/dev/null || true
  wait "$control_plane_pid" "$runner_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "Starting Slab Runner on http://127.0.0.1:6990..."
(cd "$runner_dir" && npm run dev) &
runner_pid=$!

echo "Starting Slab Agents on http://127.0.0.1:3009..."
(cd "$control_plane_dir" && npm run dev) &
control_plane_pid=$!

wait -n "$runner_pid" "$control_plane_pid"
