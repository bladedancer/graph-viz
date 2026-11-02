#!/usr/bin/env bash
# Builds the Graph Visualizer image and runs it, publishing the port on localhost only.
#
#   scripts/start.sh                 -> http://localhost:8080
#   PORT=9000 scripts/start.sh       -> http://localhost:9000
#
# Works with Docker or Podman (set CONTAINER_RUNTIME to choose). Server settings (see README) are passed through
# from your environment when set, e.g. ALLOWED_TENANT_HOSTS="*.fusion.example.com" scripts/start.sh
set -euo pipefail
cd "$(dirname "$0")/.."

runtime="${CONTAINER_RUNTIME:-$(command -v docker || command -v podman || true)}"
if [ -z "$runtime" ]; then
    echo "Neither docker nor podman was found. Install one, or run the server directly with: npm run build && npm start" >&2
    exit 1
fi

port="${PORT:-8080}"
image=graph-viz
name=graph-viz

# Podman builds OCI images by default, which drop the Dockerfile's HEALTHCHECK; ask it for the Docker format.
build_args=()
if "$runtime" --version 2>/dev/null | grep -qi podman; then build_args+=(--format docker); fi
"$runtime" build "${build_args[@]}" -t "$image" .
"$runtime" rm -f "$name" >/dev/null 2>&1 || true

echo
echo "Graph Visualizer: http://localhost:${port}  (Ctrl-C to stop)"
echo

# -e NAME with no value passes the variable through only if it is set in this shell.
exec "$runtime" run --rm --init --name "$name" \
    -p "127.0.0.1:${port}:8080" \
    -e ALLOWED_TENANT_HOSTS -e ALLOWED_ORIGINS -e SERVICES_URL -e ENV_MODE \
    -e SESSION_TTL_MINUTES -e UPSTREAM_TIMEOUT_SECONDS -e CRAWL_CONCURRENCY -e MAX_RESOURCES_CAP \
    -e LOGIN_ATTEMPTS_PER_MINUTE -e NODE_TLS_REJECT_UNAUTHORIZED -e NODE_EXTRA_CA_CERTS \
    "$image"
