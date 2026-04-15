# personal-mcp

Two personal MCP servers deployed on Coolify (Server 1, Hetzner). Both wrapped with
[supergateway](https://github.com/supercorp-ai/supergateway) to expose stdio MCP servers
over Streamable HTTP, gated by a single Traefik basicAuth middleware.

## Services

| Service | Endpoint                              | Package / Source                                     |
|---------|---------------------------------------|------------------------------------------------------|
| Monarch | `https://monarch.claw.jogeeks.com/mcp`| Fork at `rmarji/monarch-mcp-server` (built in image) |
| Bee     | `https://bee.claw.jogeeks.com/mcp`    | PyPI `beemcp` via `uvx beemcp`                       |

Both services sit on Coolify's default `coolify` Docker network and route via the existing
Traefik instance. Neither exposes a public port directly.

## Shared credential

A single basicAuth credential protects both endpoints. The htpasswd hash (bcrypt) is
embedded in both docker-compose files. Middleware name: `personal-mcp-auth`.

**Username:** `rayo`
**Password:** `dUBfLyPZQSKpGiWoQMTCwQedtvgg`
**Base64(`user:pass`):** `cmF5bzpkVUJmTHlQWlFTS3BHaVdvUU1UQ3dRZWR0dmdn`
**htpasswd hash:** `rayo:$2y$05$bmt9SdT2J3JGXnX6xKRNUefsaaCktwQME86sDW539B02rvqdNYWem`

Store the plaintext password in Infisical or a password manager. Do not commit it anywhere
besides this README if you want to keep it recoverable — ideally rotate before production.

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
AUTH="Basic cmF5bzpkVUJmTHlQWlFTS3BHaVdvUU1UQ3dRZWR0dmdn"

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
AUTH='Basic cmF5bzpkVUJmTHlQWlFTS3BHaVdvUU1UQ3dRZWR0dmdn'

claude mcp add --transport http monarch \
  https://monarch.claw.jogeeks.com/mcp \
  --header "Authorization: $AUTH"

claude mcp add --transport http bee \
  https://bee.claw.jogeeks.com/mcp \
  --header "Authorization: $AUTH"
```

Verify:
```bash
claude mcp list
```

### claude.ai (web) — Custom Connectors
1. Open <https://claude.ai> → **Settings** (gear) → **Connectors**.
2. Click **+ Add custom connector**.
3. For each server, fill in:
   - **Name:** `Monarch` (or `Bee`)
   - **Remote MCP server URL:** `https://monarch.claw.jogeeks.com/mcp` (or `bee...`)
   - **Authentication:** choose **Custom header**
   - **Header name:** `Authorization`
   - **Header value:** `Basic cmF5bzpkVUJmTHlQWlFTS3BHaVdvUU1UQ3dRZWR0dmdn`
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
        "--header", "Authorization: Basic cmF5bzpkVUJmTHlQWlFTS3BHaVdvUU1UQ3dRZWR0dmdn"
      ]
    },
    "bee-remote": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://bee.claw.jogeeks.com/mcp",
        "--header", "Authorization: Basic cmF5bzpkVUJmTHlQWlFTS3BHaVdvUU1UQ3dRZWR0dmdn"
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
