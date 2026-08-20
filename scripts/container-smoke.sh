#!/bin/sh
set -eu

image=${SLAB_AGENTS_SMOKE_IMAGE:-slab-agents:smoke}
port=${SLAB_AGENTS_SMOKE_PORT:-39109}
suffix=${GITHUB_RUN_ID:-local}-$$
container=slab-agents-smoke-$suffix
volume=slab-agents-smoke-data-$suffix
cookies=/tmp/slab-agents-smoke-cookies-$suffix
headers=/tmp/slab-agents-smoke-headers-$suffix
password=testing-only-admin-password
next_password=testing-only-rotated-password
session_secret=testing-only-session-secret-0123456789abcdef

cleanup() {
  docker rm --force "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -f "$cookies" "$headers"
}
trap cleanup EXIT HUP INT TERM

expect_status() {
  expected=$1
  shift
  actual=$(curl -sS -o /dev/null -w '%{http_code}' "$@")
  if [ "$actual" != "$expected" ]; then
    echo "Expected HTTP $expected, received $actual." >&2
    exit 1
  fi
}

docker volume create "$volume" >/dev/null
docker run --detach \
  --name "$container" \
  --publish "127.0.0.1:${port}:3009" \
  --volume "$volume:/data" \
  --env "SLAB_SESSION_SECRET=$session_secret" \
  "$image" >/dev/null

curl --retry 30 --retry-delay 1 --retry-all-errors -fsS \
  "http://127.0.0.1:${port}/health" >/dev/null
expect_status 503 "http://127.0.0.1:${port}/ready"
expect_status 307 "http://127.0.0.1:${port}/"
expect_status 401 "http://127.0.0.1:${port}/api/agents"

printf '%s\n' "$password" |
  docker exec -i "$container" node scripts/admin-bootstrap.mjs >/dev/null
expect_status 200 "http://127.0.0.1:${port}/ready"

expect_status 403 \
  -H 'Origin: https://invalid.example' \
  -H 'Content-Type: application/json' \
  --data "{\"password\":\"$password\"}" \
  "http://127.0.0.1:${port}/api/auth/login"

expect_status 200 \
  -c "$cookies" \
  -H "Origin: http://127.0.0.1:${port}" \
  -H 'Content-Type: application/json' \
  --data "{\"password\":\"$password\"}" \
  "http://127.0.0.1:${port}/api/auth/login"
expect_status 200 -b "$cookies" "http://127.0.0.1:${port}/api/agents"

expect_status 200 \
  -b "$cookies" \
  -H "Origin: http://127.0.0.1:${port}" \
  -H 'Content-Type: application/json' \
  --data "{\"currentPassword\":\"$password\",\"newPassword\":\"$next_password\"}" \
  "http://127.0.0.1:${port}/api/auth/password"
expect_status 401 -b "$cookies" "http://127.0.0.1:${port}/api/agents"
expect_status 401 \
  -H "Origin: http://127.0.0.1:${port}" \
  -H 'Content-Type: application/json' \
  --data "{\"password\":\"$password\"}" \
  "http://127.0.0.1:${port}/api/auth/login"

expect_status 200 \
  -A secure-cookie-check \
  -D "$headers" \
  -H 'Host: agents.example.com' \
  -H 'X-Forwarded-Host: agents.example.com' \
  -H 'X-Forwarded-Proto: https' \
  -H 'Origin: https://agents.example.com' \
  -H 'Content-Type: application/json' \
  --data "{\"password\":\"$next_password\"}" \
  "http://127.0.0.1:${port}/api/auth/login"
grep -q '; Secure' "$headers"

test "$(docker exec "$container" id -u)" = "10001"
if docker exec "$container" sh -c 'command -v npm >/dev/null 2>&1'; then
  echo "The production image must not include the npm CLI." >&2
  exit 1
fi
test "$(docker exec "$container" stat -c '%a' /data)" = "700"
test "$(docker exec "$container" stat -c '%a' /data/slab-workspace.db)" = "600"
if docker exec "$container" grep -a -F "$next_password" /data/slab-workspace.db >/dev/null; then
  echo "Plaintext password found in the workspace database." >&2
  exit 1
fi

docker restart "$container" >/dev/null
curl --retry 30 --retry-delay 1 --retry-all-errors -fsS \
  "http://127.0.0.1:${port}/ready" >/dev/null

echo "Slab Agents container smoke passed."
