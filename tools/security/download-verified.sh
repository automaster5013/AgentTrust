#!/bin/sh
# Fixed public release coordinates supplied by the Dockerfile. Every route must
# return bytes matching the same pinned digest; retries do not change trust.
set -eu
url=$1
target=$2
digest=$3
fallback=${4:-}
if [ -n "$fallback" ]; then
  case "$url" in
    https://github.com/aquasecurity/trivy/releases/download/*|https://github.com/anchore/syft/releases/download/*|https://github.com/gitleaks/gitleaks/releases/download/*|https://github.com/sigstore/cosign/releases/download/*) ;;
    *) printf 'Pinned API fallback source refused\n' >&2; exit 1 ;;
  esac
  repository=${url#https://github.com/}
  repository=${repository%%/releases/download/*}
  prefix=https://api.github.com/repos/$repository/releases/assets/
  case "$fallback" in
    "$prefix"*) asset=${fallback#"$prefix"} ;;
    *) printf 'Pinned API fallback repository refused\n' >&2; exit 1 ;;
  esac
  case "$asset" in ''|*[!0-9]*) printf 'Pinned API asset identity refused\n' >&2; exit 1 ;; esac
fi
fetch() {
  if [ -n "$fallback" ] && [ "$1" = "$fallback" ]; then
    wget -q -T 30 -U AgentTrust-security-tools -O "$target" --header='Accept: application/octet-stream' "$1"
  else
    wget -q -T 30 -U AgentTrust-security-tools -O "$target" "$1"
  fi
}
for route in "$url" ${fallback:+"$fallback"}; do
  attempt=1
  while [ "$attempt" -le 3 ]; do
    if fetch "$route" && printf '%s  %s\n' "$digest" "$target" | sha256sum -c - >/dev/null 2>&1; then
      exit 0
    fi
    printf 'Verified tool download attempt %s failed\n' "$attempt" >&2
    attempt=$((attempt + 1))
    if [ "$attempt" -le 3 ]; then sleep 2; fi
  done
done
printf 'Pinned tool download refused after bounded verified attempts\n' >&2
exit 1
