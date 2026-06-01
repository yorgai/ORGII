# ORGII Mobile Remote Relay — example container image for self-hosters.
#
# Audience: self-hosters running the relay behind a TLS terminator
# (nginx, Caddy, Cloudflare Tunnel) on a single-tenant VPS.
#
# Companion deploy doc:
#   Documentation/MainApp/collaboration/mobile-remote-relay-deploy--0505.md
#
# Build context: the workspace root (so cargo can resolve path deps to
# `orgii-protocol` and the rest of the workspace). docker-compose.yml
# alongside this Dockerfile sets `context: ../..` for that reason.
#
# Build (BuildKit required for cache mounts):
#   DOCKER_BUILDKIT=1 docker build \
#     -f contrib/relay/Dockerfile \
#     -t orgii-mobile-relay:latest \
#     .

# syntax=docker/dockerfile:1.7

# -------- Stage 1: builder ------------------------------------------------
# rust:1.85-slim matches the workspace MSRV declared in
# `src-tauri/Cargo.toml` (rust-version = "1.85.0"). Bumping the workspace
# MSRV is the trigger to bump this tag.
FROM rust:1.85-slim AS builder

# Build deps. `rusqlite` with the `bundled` feature compiles SQLite from
# source via the `cc` crate, so we need a C toolchain. `pkg-config` is
# pulled in defensively for any future native dep that asks for it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Copy the workspace. We rely on `.dockerignore` (or the lack thereof)
# to keep the context lean; for a tighter build, add a top-level
# `.dockerignore` that excludes `target/`, `node_modules/`, and the JS
# frontend.
COPY . .

# `cargo build --release -p orgii_mobile_relay` builds the binary
# `orgii-mobile-relay` (Cargo's `[[bin]]` name). The package name uses
# underscores; the binary uses dashes — that mismatch is intentional
# and matches the crate's `Cargo.toml`.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/workspace/target \
    cargo build --release -p orgii_mobile_relay --bin orgii-mobile-relay \
    && cp /workspace/target/release/orgii-mobile-relay /orgii-mobile-relay

# -------- Stage 2: runtime ------------------------------------------------
# Distroless cc-debian12 ships glibc + libgcc but no shell, no package
# manager, and no setuid binaries. The relay is a single static-ish ELF
# that links against libc; cc-debian12 is the smallest image that runs
# it without surprises.
FROM gcr.io/distroless/cc-debian12

COPY --from=builder /orgii-mobile-relay /usr/local/bin/orgii-mobile-relay

# Distroless ships a `nonroot` user at uid 65532; using it means the
# container can never escalate via a misconfigured volume mount.
USER 65532:65532

# Loopback-only inside the container would defeat `docker compose`'s
# port mapping, so we expose 7878 and rely on the host-side
# `127.0.0.1:7878:7878` binding (see docker-compose.yml) to keep the
# relay off the public interface.
EXPOSE 7878

# `serve` is the implicit subcommand (clap parses no-subcommand as
# `Serve` per `cli::run_cli`), but pin it explicitly so a future
# default-change doesn't silently re-route the container.
ENTRYPOINT ["/usr/local/bin/orgii-mobile-relay", "serve"]
CMD ["--listen-addr", "0.0.0.0:7878", "--storage-path", "/var/lib/orgii-relay/orgii-relay.db"]
