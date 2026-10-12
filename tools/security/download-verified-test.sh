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
count=$(cat "$CONTROL/count")
count=$((count + 1))
printf '%s' "$count" > "$CONTROL/count"
case "$MODE" in
 network) exit 1 ;;
 corrupt) printf 'corrupt' > "$7" ;;
 retry) if [ "$count" -lt 3 ]; then printf 'corrupt' > "$7"; else printf 'verified' > "$7"; fi ;;
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
printf '{"completed":true,"controls":4,"networkUsed":false,"corruptBytesRefused":true,"retryLimitVerified":true}\n'
