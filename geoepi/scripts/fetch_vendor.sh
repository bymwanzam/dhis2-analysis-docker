#!/bin/sh
# Download Leaflet + leaflet.heat from the npm registry into app/static/vendor (no CDN needed at runtime).
set -e
DEST="${1:-$(dirname "$0")/../app/static/vendor}"
mkdir -p "$DEST"; T=$(mktemp -d)
curl -fsSL https://registry.npmjs.org/leaflet/-/leaflet-1.9.4.tgz        | tar -xz -C "$T" && \
  cp "$T/package/dist/leaflet.js" "$T/package/dist/leaflet.css" "$DEST/" && cp -r "$T/package/dist/images" "$DEST/"
rm -rf "$T"/*; curl -fsSL https://registry.npmjs.org/leaflet.heat/-/leaflet.heat-0.2.0.tgz | tar -xz -C "$T" && \
  cp "$T/package/dist/leaflet-heat.js" "$DEST/"
rm -rf "$T"; echo "vendor files in $DEST"; ls "$DEST"
