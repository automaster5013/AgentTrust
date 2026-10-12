#!/bin/sh
# Fixed public release coordinates supplied by the Dockerfile. Never accept a
# response until its bytes match the pinned digest; retries do not change trust.
set -eu
url=$1
target=$2
digest=$3
attempt=1
while [ "$attempt" -le 3 ]; do
  if wget -q -T 30 -U AgentTrust-security-tools -O "$target" "$url" \
    && printf '%s  %s\n' "$digest" "$target" | sha256sum -c - >/dev/null 2>&1; then
    exit 0
  fi
  printf 'Verified tool download attempt %s failed\n' "$attempt" >&2
  attempt=$((attempt + 1))
  if [ "$attempt" -le 3 ]; then sleep 2; fi
done
printf 'Pinned tool download refused after three attempts\n' >&2
exit 1
