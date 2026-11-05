#!/usr/bin/env sh
# Who may frame the app, for the nginx image: the headers of scripts/frame-headers.json, which
# src/build/frameHeaders.test.ts checks this file against. Only this origin may frame the app, and
# nothing may frame the pairing page in any spelling the router renders it under: any letter case,
# escaped letters, repeated slashes, a base path.
#
# The match reads $request_uri, the address the browser asked for: $uri turns into /index.html
# once try_files falls back to the app shell. The headers are set for the whole http block, so
# every server and location inherits them, except one that sets add_header itself (nginx then
# drops inherited ones): such a block includes /etc/nginx/mindroom-frame-headers.inc.
set -eu

cat > /etc/nginx/mindroom-frame-headers.inc <<'HEADERS'
add_header Content-Security-Policy $mindroom_frame_ancestors always;
add_header X-Frame-Options $mindroom_frame_options always;
HEADERS

cat > /etc/nginx/conf.d/mindroom-frame-headers.conf <<'POLICY'
map $request_uri $mindroom_frame_ancestors {
  "~*^[^?]*(?:/|%2f)(?:c|%[46]3)(?:o|%[46]f)(?:n|%[46]e){2}(?:e|%[46]5)(?:c|%[46]3)(?:t|%[57]4)(?:/|%2f)*(?:\?|$)" "frame-ancestors 'none'";
  default "frame-ancestors 'self'";
}
map $request_uri $mindroom_frame_options {
  "~*^[^?]*(?:/|%2f)(?:c|%[46]3)(?:o|%[46]f)(?:n|%[46]e){2}(?:e|%[46]5)(?:c|%[46]3)(?:t|%[57]4)(?:/|%2f)*(?:\?|$)" "DENY";
  default "SAMEORIGIN";
}
include /etc/nginx/mindroom-frame-headers.inc;
POLICY
