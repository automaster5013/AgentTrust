#!/bin/sh
# Keep the Java probe's HTTP/status/body contract without starting another JVM.
LC_ALL=C
export LC_ALL
result=$(/usr/bin/curl --disable --noproxy '*' --proto '=http' \
    --connect-timeout 2 --max-time 3 --max-filesize 16384 \
    --silent --fail --write-out '\n%{http_code}' \
    http://127.0.0.1:8080/actuator/health 2>/dev/null) || exit 1
code=${result##*
}
[ "$code" = 200 ] || exit 1
body=${result%????}
[ "${#body}" -le 16384 ] || exit 1
case "$body" in
    *'"status":"UP"'*) exit 0 ;;
    *) exit 1 ;;
esac
