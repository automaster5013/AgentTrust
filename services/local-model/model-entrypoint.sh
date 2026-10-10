#!/bin/sh
set -eu
sha256sum --quiet -c /opt/agenttrust/model-sha256.txt
exec /usr/bin/ollama "$@"
