# syntax=docker/dockerfile:1.7
FROM golang:1.23-alpine AS build
WORKDIR /src

ENV CGO_ENABLED=0 \
    GOFLAGS="-trimpath"

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -ldflags="-s -w" -o /out/server .

# Pre-create the data directory with the nonroot UID/GID (65532) so that
# a fresh named volume inherits those permissions and the server can write
# auth.json without root.
RUN mkdir -p /out/data && chown -R 65532:65532 /out/data

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/server /app/server
COPY --from=build --chown=65532:65532 /out/data /data

ENV ADDR=:8787 \
    DATA_DIR=/data

EXPOSE 8787
USER nonroot:nonroot
VOLUME ["/data"]
ENTRYPOINT ["/app/server"]
