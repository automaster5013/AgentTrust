FROM postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 AS build
ADD --checksum=sha256:83d673c3b287cddbf3879f86215f043f2c2b56c69d37b2a77504910db1ed6e56 https://codeload.github.com/pgvector/pgvector/tar.gz/f37c13f68b57d2c3472b2214fbcff699d6d34876 /vector.tar.gz
RUN apk add --no-cache build-base clang21 llvm21-dev && mkdir /vector && tar -xzf /vector.tar.gz --strip-components=1 -C /vector
WORKDIR /vector
RUN make OPTFLAGS='' && make install DESTDIR=/install
FROM postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24
RUN rm -f /usr/local/bin/gosu
COPY --from=build /install/usr/local/lib/postgresql /usr/local/lib/postgresql
COPY --from=build /install/usr/local/share/postgresql/extension /usr/local/share/postgresql/extension
COPY --from=build /vector/LICENSE /usr/share/licenses/pgvector/LICENSE
USER 70:70
