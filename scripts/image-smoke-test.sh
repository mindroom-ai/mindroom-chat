#!/usr/bin/env bash
# Starts a web client image (docker/Dockerfile) and checks what it serves: the release it was built
# as in version.json, the app shell on any route, a 404 for a missing build file or file under
# /public/, the deployment files the start scripts and the build provide, and the cache and framing
# headers.
# The Image workflow (.github/workflows/image.yml) runs it on every image before anything is pushed.
#
#   scripts/image-smoke-test.sh <image> <release tag> [docker run options, e.g. --platform linux/arm64]
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: $0 <image> <release tag> [docker run options]" >&2
  exit 2
fi
image=$1
tag=$2
shift 2

container=$(docker run --detach --publish 127.0.0.1::80 "$@" "$image")
passed=0
cleanup() {
  if [ "$passed" != 1 ]; then docker logs "$container" >&2 || true; fi
  docker rm --force "$container" >/dev/null || true
}
trap cleanup EXIT

port=$(docker port "$container" 80/tcp | head -n 1 | sed 's/.*://')
base="http://127.0.0.1:$port"
for _ in $(seq 120); do
  if curl --silent --fail --output /dev/null "$base/version.json"; then break; fi
  sleep 0.5
done

fail() {
  echo "FAIL: $*" >&2
  exit 1
}
body() { curl --silent --show-error --fail "$base$1"; }
status() { curl --silent --output /dev/null --write-out '%{http_code}' "$base$1"; }
header() { curl --silent --output /dev/null --dump-header - "$base$1" | tr -d '\r' | grep -i "^$2:" | cut -d' ' -f2-; }
expect() {
  if [ "$2" != "$3" ]; then fail "$1: expected '$3', got '$2'"; fi
  echo "ok: $1: $2"
}

expect '/version.json' "$(body /version.json)" "{\"version\":\"$tag\",\"release\":\"$tag\"}"
expect '/version.json Cache-Control' "$(header /version.json Cache-Control)" 'no-cache'

shell=$(body /)
case "$shell" in *'src="/runtime-config.js"'*) ;; *) fail '/ is not the app shell' ;; esac
echo 'ok: / is the app shell'
[ "$(body /home/some/room)" = "$shell" ] || fail 'a client route does not get the app shell'
echo 'ok: a client route gets the app shell'
expect '/ X-Frame-Options' "$(header / X-Frame-Options)" 'SAMEORIGIN'
expect '/connect X-Frame-Options' "$(header /connect X-Frame-Options)" 'DENY'

asset=$(printf '%s\n' "$shell" | grep -o '/assets/[^"]*\.js' | head -n 1)
[ -n "$asset" ] || fail 'the app shell names no script under /assets/'
expect "$asset" "$(status "$asset")" '200'
expect "$asset Cache-Control" "$(header "$asset" Cache-Control)" 'public, max-age=31536000, immutable'
expect "$asset X-Frame-Options" "$(header "$asset" X-Frame-Options)" 'SAMEORIGIN'
expect 'a missing build file' "$(status /assets/missing-0000.js)" '404'
expect '/public/licenses/LICENSE' "$(status /public/licenses/LICENSE)" '200'
expect '/public/licenses/LICENSE X-Frame-Options' "$(header /public/licenses/LICENSE X-Frame-Options)" 'SAMEORIGIN'
expect 'a missing file under /public/' "$(status /public/missing.html)" '404'

expect '/config.json' "$(status /config.json)" '200'
expect '/notices.json' "$(body /notices.json)" '[]'
case "$(body /runtime-config.js)" in
  'window.__APP_BASE_PATH__ = "/";'*) echo 'ok: /runtime-config.js comes from the start script' ;;
  *) fail '/runtime-config.js was not written by docker/entrypoint.d/99-runtime-config.sh' ;;
esac
expect '/.well-known/apple-app-site-association Content-Type' \
  "$(header /.well-known/apple-app-site-association Content-Type)" 'application/json'

passed=1
echo "PASS: $image serves $tag"
