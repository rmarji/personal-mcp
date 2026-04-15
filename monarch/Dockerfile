# syntax=docker/dockerfile:1.7
# Monarch Money MCP server wrapped with supergateway to expose stdio as Streamable HTTP.
# Base image ships with uv + uvx preinstalled.
FROM supercorp/supergateway:3.4.3-uvx

# Install git (needed to clone the fork at build time)
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Clone the custom Monarch fork and install its deps with uv.
# Pinning to main; change the ref to a specific commit sha for reproducible builds.
ARG MONARCH_REPO=https://github.com/rmarji/monarch-mcp-server.git
ARG MONARCH_REF=main
RUN git clone --depth 1 --branch ${MONARCH_REF} ${MONARCH_REPO} /app \
    && uv sync --frozen || uv sync

# Session cache lives here. Must be mounted as a named volume (monarch-session)
# or Monarch auth breaks on every restart.
VOLUME ["/app/.mm"]

EXPOSE 8000

# Supergateway wraps the stdio MCP server and exposes Streamable HTTP on :8000/mcp.
# Env vars (MONARCH_EMAIL / MONARCH_PASSWORD / MONARCH_MFA_SECRET) come from Coolify.
ENTRYPOINT ["supergateway"]
CMD ["--stdio", "uv run python run_server.py", \
     "--outputTransport", "streamableHttp", \
     "--port", "8000", \
     "--cwd", "/app"]
