FROM node:22-bookworm-slim AS web
WORKDIR /build/web
COPY web/package*.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM rust:1-bookworm AS rust
WORKDIR /build
COPY Cargo.toml ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --uid 10001 --create-home coweft
WORKDIR /app
COPY --from=rust /build/target/release/coweft /usr/local/bin/coweft
COPY --from=web /build/web/dist ./web/dist
USER 10001:10001
EXPOSE 8080
ENV RUST_LOG=info
CMD ["coweft"]
