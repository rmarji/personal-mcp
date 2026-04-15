# personal-mcp

Two personal MCP servers deployed on Coolify (Server 1, Hetzner). Both wrapped with
[supergateway](https://github.com/supercorp-ai/supergateway) to expose stdio MCP servers
over Streamable HTTP, gated by a single Traefik basicAuth middleware.

## Services

| Service | Endpoint                              | Package / Source                                     |
|---------|---------------------------------------|------------------------------------------------------|
| Monarch | `https://monarch.claw.jogeeks.com/mcp`| Fork at `rmarji/monarch-mcp-server` (built in image) |
| Bee     | `https://bee.claw.jogeeks.com/mcp`    | Custom TypeScript MCP in `bee-ts/` (direct Bee API) |

Both services sit on Coolify's default `coolify` Docker network and route via the existing
Traefik instance. Neither exposes a public port directly.

## Shared credential

A single basicAuth credential protects both endpoints. The htpasswd hash (bcrypt) is
embedded in both docker-compose files. Middleware name: `personal-mcp-auth`.

**Username:** `rayo`
**htpasswd hash (bcrypt, committed here):** `rayo:$2y$05$YNclvfhPwZZW4vQkwcgAF..F9G5tN.JkB9j4WuuuFwVkDow4gkZf.`

The plaintext password and `Authorization: Basic ...` header value are stored out-of-band
(not in this repo). Use a password manager / Infisical. To rotate, generate a new bcrypt
hash with `htpasswd -nbB rayo <new-pass>` and update both compose files.

## Directory layout

```
personal-mcp/
├── README.md                    # This file
├── monarch/
│   ├── Dockerfile               # Builds from rmarji/monarch-mcp-server fork
│   ├── docker-compose.yml       # Coolify app with monarch-session volume
│   └── .env.example
└── bee/
    ├── docker-compose.yml       # Direct supergateway image + uvx beemcp
    └── .env.example
```

---

## Coolify deployment — step by step

### 0. Prereqs
- Coolify on Server 1 (already running).
- The `coolify` Docker network exists (it does — Coolify creates it).
- The Traefik instance has the `letsencrypt` certresolver configured (already set up
  for `*.claw.jogeeks.com`).
- DNS: add A records for `monarch.claw.jogeeks.com` and `bee.claw.jogeeks.com` pointing
  to Server 1's public IP (178.156.202.66).

### 1. Create the Coolify project
1. Open Coolify → **Projects** → **New Project** → name it `personal-mcp`.
2. Inside the project, **Production** environment is fine.

### 2. Deploy the Bee MCP server (simpler, do this first)
1. Inside `personal-mcp`, click **+ New Resource** → **Docker Compose Empty**.
2. Name the app `bee-mcp`.
3. **Source:** pick "Docker Compose (paste)".
4. Paste the contents of `personal-mcp/bee/docker-compose.yml` verbatim.
5. Go to the **Environment Variables** tab and add:
   - `BEE_API_TOKEN` → your actual Bee API token
   Mark it as a build-time AND runtime variable.
6. Click **Deploy**. Wait for the green check.
7. **Confirm Traefik picked up the labels**:
   ```bash
   ssh claw 'docker logs --tail 50 coolify-proxy 2>&1 | grep -i bee'
   ```
   You should see lines about router/middleware registration for `bee-mcp`.

### 3. Deploy the Monarch MCP server
1. Inside `personal-mcp`, click **+ New Resource** → **Docker Compose Empty**.
2. Name the app `monarch-mcp`.
3. **Source:** pick "Public Repository" and point it at this repo (or "Git" if private),
   with **Base Directory** set to `/monarch`. Coolify will read
   `monarch/docker-compose.yml` and build from `monarch/Dockerfile`.
   Alternative: paste the docker-compose and set "Build Pack → Dockerfile" manually;
   Coolify needs the Dockerfile path relative to the repo.
4. **Environment Variables**:
   - `MONARCH_EMAIL`
   - `MONARCH_PASSWORD`
   - `MONARCH_MFA_SECRET` (base32 TOTP secret — extract from Monarch's MFA QR)
5. **Persistent Storage**: Coolify will auto-detect the `monarch-session` named volume
   from the compose file. Verify it appears under the app's **Storage** tab.
6. Click **Deploy**. First build takes a few minutes (git clone + uv sync).
7. **Confirm the volume is mounted**:
   ```bash
   ssh claw 'docker volume ls | grep monarch-session && \
             docker exec $(docker ps -qf name=monarch-mcp) ls -la /app/.mm'
   ```

### 4. Smoke-test the `/mcp` endpoints

Unauthenticated — should return 401:
```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://bee.claw.jogeeks.com/mcp
curl -sS -o /dev/null -w "%{http_code}\n" https://monarch.claw.jogeeks.com/mcp
# Expect: 401
```

Authenticated — should return 405 or a JSON-RPC error (405 = GET not allowed on POST
endpoint, which is expected):
```bash
AUTH="Basic <BASE64_USER_PASS>"

curl -sS -H "Authorization: $AUTH" https://bee.claw.jogeeks.com/mcp
curl -sS -H "Authorization: $AUTH" https://monarch.claw.jogeeks.com/mcp
```

Full MCP initialize handshake via POST (both should return a JSON-RPC response):
```bash
curl -sS -X POST https://bee.claw.jogeeks.com/mcp \
  -H "Authorization: $AUTH" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

### 5. Verify volume persistence (Monarch only)
```bash
# Trigger a restart
ssh claw 'docker restart $(docker ps -qf name=monarch-mcp)'

# After ~15s, confirm session cache survived
ssh claw 'docker exec $(docker ps -qf name=monarch-mcp) ls -la /app/.mm'
```

If `.mm/` is empty after a restart, Coolify didn't bind the volume correctly — check the
**Storage** tab and confirm `monarch-session` is listed.

---

## Client registration

### Claude Code (CLI)
```bash
AUTH='Basic <BASE64_USER_PASS>'

claude mcp add --transport http monarch \
  https://monarch.claw.jogeeks.com/mcp \
  --header "Authorization: $AUTH"
```

Verify:
```bash
claude mcp list
```

> **Known issue — bee + Claude Code CLI**: `beemcp` (the PyPI package) uses an
> older `mcp[cli]>=1.4.0` SDK whose `FastMCP` echoes back the client's requested
> `protocolVersion` on `initialize` without downgrading to a supported one.
> Claude Code CLI sends `2025-11-25`, which beemcp echoes but then rejects on
> the follow-up `Mcp-Protocol-Version` header (the actual supported list is
> `2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07`). Workarounds:
> - **Claude.ai web connectors** — tolerant of the echo mismatch, works fine.
> - **Claude Desktop** — use a local `beemcp` or the TypeScript MCP server in
>   the sibling `bee/` repo; remote usage via `mcp-remote` shim also works.
> - **Fix upstream** — PR beemcp to pin `mcp[cli]>=1.27.0` or to clamp the
>   echoed protocol version in its initialize handler.
>
> Monarch is unaffected at the transport layer and works directly via `--transport http`.

## Known issues

### monarch → `PASSWORD_NEEDS_RESET`
The monarch endpoint is fully deployed and speaks valid MCP, but every
`tools/call` returns `Error: Failed to authenticate with Monarch Money`. The
real upstream response body is:

> `"We've detected that your current password may have been involved in an
> external data breach and is risky to use. To protect your financial
> information, please reset your password, then use the new password to log
> in."` (`error_code: PASSWORD_NEEDS_RESET`)

`monarchmoneycommunity` surfaces this as generic `HTTP Code 404: Not Found`
because it falls into the fallback branch when the response has a body but
non-200 status. **Fix**: reset your Monarch password in the web app, then
update `MONARCH_PASSWORD` in the Coolify env vars on the `monarch-mcp`
application. No code changes needed.

### bee: why we don't use `beemcp`
The PyPI `beemcp 0.3.0` package hardcodes `https://api.bee.computer` as the
API base URL. That hostname no longer resolves in public DNS — Bee moved to
`app-api-developer.ce.bee.amazon.dev` (behind a private CA cert). Running
`beemcp` directly fails every tool call with
`NameResolutionError: Failed to resolve 'api.bee.computer'`.

Instead, this repo ships a small TypeScript MCP server in `bee-ts/`:

- Wraps the Bee REST API directly with `undici`
- Bundles the Bee private CA cert (`bee-ca.pem`) so Node trusts the TLS chain
- Uses the `BEE_API_TOKEN` env var (same token `bee status` prints)
- Registered with `@modelcontextprotocol/sdk >=1.29` so it negotiates protocol
  versions correctly (beemcp's FastMCP echoes `2025-11-25` but then rejects
  follow-ups with that header)

Nine tools exposed: `bee_me`, `bee_now`, `bee_facts_list`, `bee_fact_get`,
`bee_conversations_list`, `bee_conversation_get`, `bee_todos_list`,
`bee_daily`, `bee_search`. Verified end-to-end — tool calls return real Bee
data from the Amazon developer API.

### Claude Code CLI `claude mcp list` health check is flaky
`claude mcp list` occasionally shows remote HTTP MCP servers as `✗ Failed to
connect` even though the actual tool calls work fine at runtime. The health
check uses a 30-second connection probe that can spuriously time out on
cold-started supergateway containers. Solutions:

- **Ignore the list output** and invoke tools directly — they work.
- **Warm the containers first** with a curl `initialize` before running
  `claude mcp list`.
- **Restart the Claude Code session** after registering a new remote MCP
  server so tools are re-enumerated.

Confirmed working via direct curl + `mcp__*` tool calls through Claude Code's
MCP bridge; only the `claude mcp list` health check is unreliable.

### claude.ai (web) — Custom Connectors
1. Open <https://claude.ai> → **Settings** (gear) → **Connectors**.
2. Click **+ Add custom connector**.
3. For each server, fill in:
   - **Name:** `Monarch` (or `Bee`)
   - **Remote MCP server URL:** `https://monarch.claw.jogeeks.com/mcp` (or `bee...`)
   - **Authentication:** choose **Custom header**
   - **Header name:** `Authorization`
   - **Header value:** `Basic <BASE64_USER_PASS>`
4. Save. claude.ai will call `initialize` and list the tools — you should see them appear
   under the connector.

### Claude Desktop
Add to `~/Library/Application Support/Claude/claude_desktop_config.json` under `mcpServers`.
Claude Desktop doesn't natively support remote MCP in all versions; if your build doesn't,
use the `mcp-remote` shim:
```json
{
  "mcpServers": {
    "monarch-remote": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://monarch.claw.jogeeks.com/mcp",
        "--header", "Authorization: Basic <BASE64_USER_PASS>"
      ]
    },
    "bee-remote": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://bee.claw.jogeeks.com/mcp",
        "--header", "Authorization: Basic <BASE64_USER_PASS>"
      ]
    }
  }
}
```

---

## Troubleshooting

**401 on every request:** Check the htpasswd hash in the compose file — the `$` signs must
be doubled (`$$`) to escape docker-compose variable interpolation. If you see the literal
hash in logs starting with `$2y$05$...` instead of `$$2y$$05$$...`, that's the bug.

**Traefik routes not registering:** Confirm the container joined the `coolify` network
(`docker network inspect coolify | grep <container-id>`). If not, the compose file's
`networks.coolify.external: true` clause is missing or the network name differs.

**`uvx beemcp` fails on startup:** Pin to a specific beemcp version if the latest release
is broken. Change the bee compose command to `uvx beemcp==<version>`.

**Monarch auth breaks every ~24h:** The TOTP window can drift. Verify the MFA secret is
correct by running a standalone `oathtool --totp -b "$MONARCH_MFA_SECRET"` and comparing
with Monarch's mobile app.

**Session volume not persisting:** After Monarch login succeeds, `/app/.mm/` should contain
cookie/session files. If they vanish on restart, Coolify likely didn't attach the named
volume. Force-recreate the app in Coolify.
