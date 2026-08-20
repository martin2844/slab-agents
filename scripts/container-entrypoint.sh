#!/bin/sh
set -eu
umask 077

: "${SLAB_WORKSPACE_DB:=/data/slab-workspace.db}"
export SLAB_WORKSPACE_DB

database_directory=$(dirname -- "$SLAB_WORKSPACE_DB")
mkdir -p "$database_directory"
chmod 700 "$database_directory"

./node_modules/.bin/knex --knexfile knexfile.cjs migrate:latest

exec node server.js
