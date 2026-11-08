#!/bin/sh
# Offline controls: execute the production downloader with a fixture transport.
set -eu
work=$(mktemp -d /tmp/verified-download-test.XXXXXX)
trap 'rm -rf "$work"' EXIT
mkdir "$work/bin"
cat > "$work/bin/wget" <<'MOCK'
#!/bin/sh
set -eu
[ "$1" = -q ] && [ "$2" = -T ] && [ "$3" = 30 ]
[ "$4" = -U ] && [ "$5" = AgentTrust-security-tools ] && [ "$6" = -O ]
printf '%s' "$MODE" > "$CONTROL/mode"
count=$(cat "$CONTROL/count")
count=$((count + 1))
printf '%s' "$count" > "$CONTROL/count"
case "$MODE" in
 network) exit 1 ;;
 corrupt) printf 'corrupt' > "$7" ;;
 retry) if [ "$count" -lt 3 ]; then printf 'corrupt' > "$7"; else printf 'verified' > "$7"; fi ;;
 fallback-good|fallback-corrupt)
  if [ "${8:-}" != '--header=Accept: application/octet-stream' ] || [ "${9:-}" != https://api.github.com/repos/aquasecurity/trivy/releases/assets/123 ]; then exit 1; fi
  if [ "$MODE" = fallback-good ]; then printf 'verified' > "$7"; else printf 'corrupt' > "$7"; fi ;;
 good) printf 'verified' > "$7" ;;
 *) exit 1 ;;
esac
MOCK
printf '#!/bin/sh\nexit 0\n' > "$work/bin/sleep"
chmod 755 "$work/bin/wget" "$work/bin/sleep"
CONTROL=$work
PATH="$work/bin:$PATH"
export CONTROL PATH
digest=$(printf verified | sha256sum | cut -d ' ' -f 1)
for MODE in corrupt network; do
 export MODE
 printf 0 > "$work/count"
 if sh /download-verified.sh https://example.invalid/release "$work/output" "$digest" > "$work/log" 2>&1; then exit 1; fi
 [ "$(cat "$work/count")" = 3 ]
done
MODE=retry
export MODE
printf 0 > "$work/count"
sh /download-verified.sh https://example.invalid/release "$work/output" "$digest" > "$work/log" 2>&1
[ "$(cat "$work/count")" = 3 ]
[ "$(cat "$work/output")" = verified ]
MODE=good
export MODE
printf 0 > "$work/count"
sh /download-verified.sh https://example.invalid/release "$work/output" "$digest" > "$work/log" 2>&1
[ "$(cat "$work/count")" = 1 ]
primary=https://github.com/aquasecurity/trivy/releases/download/v0.75.0/fixture.tar.gz
fallback=https://api.github.com/repos/aquasecurity/trivy/releases/assets/123
MODE=fallback-good
export MODE
printf 0 > "$work/count"
sh /download-verified.sh "$primary" "$work/output" "$digest" "$fallback" > "$work/log" 2>&1
[ "$(cat "$work/count")" = 4 ]
[ "$(cat "$work/output")" = verified ]
for MODE in fallback-corrupt network; do
 export MODE
 printf 0 > "$work/count"
 if sh /download-verified.sh "$primary" "$work/output" "$digest" "$fallback" > "$work/log" 2>&1; then exit 1; fi
 [ "$(cat "$work/count")" = 6 ]
done
MODE=good
export MODE
printf 0 > "$work/count"
sh /download-verified.sh "$primary" "$work/output" "$digest" "$fallback" > "$work/log" 2>&1
[ "$(cat "$work/count")" = 1 ]
for refused in https://example.invalid/assets/123 https://api.github.com/repos/anchore/syft/releases/assets/123; do
 printf 0 > "$work/count"
 if sh /download-verified.sh "$primary" "$work/output" "$digest" "$refused" > "$work/log" 2>&1; then exit 1; fi
 [ "$(cat "$work/count")" = 0 ]
done
printf '{"completed":true,"controls":10,"networkUsed":false,"corruptBytesRefused":true,"retryLimitVerified":true,"sameRepositoryApiFallbackVerified":true}\n'
