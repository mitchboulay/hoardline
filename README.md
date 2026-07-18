# MediaFlow

**A self-hosted media downloader and converter that never makes you learn a flag.**

MediaFlow wraps [yt-dlp](https://github.com/yt-dlp/yt-dlp) and
[HandBrake](https://handbrake.fr/) in a clean web app: paste a link, pick the
*outcome* you want ("plays anywhere", "smallest file", "archive original"),
and MediaFlow chooses the right formats, codecs, and containers behind the
scenes. One container, one SQLite file, no external services.

<!-- screenshots: docs/screenshots/{quick.png,queue.png,convert.png} -->

## Features

- **Outcome-based downloads** — six recipes (Universal MP4, Audio Only,
  Archive Original, Mobile, Plex/Jellyfin, Custom) instead of format codes.
  Real per-recipe size estimates from the actual format list before you commit.
- **Playlists** — playlist URLs fan out into one queue job per video, each
  with its own progress, retries, and destination.
- **Clean library layout** — everything saves to `{location}/{channel}/{title}`.
  The library view groups by channel automatically.
- **HandBrake conversions** — convert downloads automatically (always /
  only-when-needed) or batch-convert files already on your server. Built-in
  profiles plus custom ones. Smart planning: files already matching a profile
  are copied or losslessly remuxed, not re-encoded. Outputs are
  ffprobe-verified (streams + duration tolerance) before any source
  retention runs — sources are never overwritten.
- **Watched folders** — drop files in, converted files come out.
- **Subscriptions** — follow channels/playlists; new uploads download
  automatically, with optional backfill of the last N videos.
- **Network storage** — add SMB/NAS locations with live credential
  verification; downloads stream to the NAS. Local disk works out of the box.
- **One live queue** — downloads and conversions together, with stages
  (inspecting → downloading/encoding → verifying → moving), fps/speed/ETA,
  reordering, bulk actions, and one-click clear of finished jobs. Updates over
  SSE.
- **Auth built in** — local login (forced password change on first run),
  API keys (SHA-256 at rest, shown once), and optional OIDC single sign-on.
- **An MCP server** — point Claude or any MCP client at `/mcp` with an API
  key and your AI can run the whole thing: analyze, download, convert, manage
  the queue and subscriptions, and report on storage. 17 tools.
- **Human error messages** — "This website currently requires authentication —
  add cookies in Settings", not `ExtractorError`.

## Quickstart

```yaml
# docker-compose.yml
services:
  mediaflow:
    image: ghcr.io/mitchboulay/mediaflow:latest
    container_name: mediaflow
    restart: unless-stopped
    ports:
      - "8090:8000"
    volumes:
      - mediaflow-data:/data

volumes:
  mediaflow-data:
```

```sh
docker compose up -d
```

Open `http://localhost:8090`, sign in with **admin / mediaflow** — you'll be
required to set a real password immediately. That's the whole install:
yt-dlp, ffmpeg, HandBrakeCLI, and a JS runtime are baked into the image.

Or build from source: clone the repo and `docker compose up -d --build`.

## Configuration

Everything is configured in the UI (Settings, Storage) and stored in SQLite
under `/data`. Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `HOST_PORT` | `8090` | Host port the compose file publishes |
| `MEDIAFLOW_DATA` | `/data` | Data directory inside the container |

**Storage locations** — Storage → Add location. SMB/CIFS shares are verified
(auth + writability) before saving; credentials are stored in the app
database and used server-side only. Downloads land at
`{location}/{channel}/{title}`.

**YouTube cookies** — some videos (age-restricted, "playback disabled on
other websites") need a logged-in session. Settings → YouTube cookies: export
with a browser extension like *Get cookies.txt LOCALLY* and paste.

**Single sign-on** — Settings → SSO: enable, then supply your OIDC provider's
issuer URL, client ID, and secret (redirect URI:
`https://your-host/api/auth/sso/callback`). Works with Authentik, Keycloak,
Authelia, or any OIDC provider. Local login remains as a fallback.

## API

Every UI action is a REST call under `/api` (OpenAPI at `/docs`).
Authenticate with an API key from Settings → API keys:

```sh
curl https://your-host/api/jobs -H "X-API-Key: mf_…"
# or
curl https://your-host/api/jobs -H "Authorization: Bearer mf_…"
```

Live queue updates: `GET /api/events?token=mf_…` (SSE).

Keys have full API access except: managing keys, changing the password, and
reading secrets — those require a browser session.

## MCP (AI assistants)

MediaFlow ships an MCP server at `POST /mcp` (streamable HTTP, stateless).

```sh
claude mcp add --transport http mediaflow https://your-host/mcp \
  --header "Authorization: Bearer mf_…"
```

Then ask your assistant things like *"download this playlist as audio"*,
*"why did that job fail?"*, *"convert everything in /incoming to H.265 and
delete the originals once verified"*, or *"subscribe me to this channel and
grab the last 10 videos"*.

## Security model

Designed for a **single admin user on a trusted network** behind your own
reverse proxy. Notably:

- SMB credentials and OIDC client secrets are stored in the SQLite database
  in plaintext (they must be replayed to the NAS/IdP). Protect `/data`.
- API keys are stored hashed; the plaintext is shown once.
- There is no multi-user support, and none planned — one household, one admin.
- Don't expose it to the public internet without SSO/forward-auth in front.

## Legal

MediaFlow is a frontend for tools you run on your own hardware. Download only
content you have the right to download, and respect the terms of the sites
you use it with. The authors do not condone copyright infringement.

## License

MIT (see `LICENSE`). The Docker image bundles [yt-dlp](https://github.com/yt-dlp/yt-dlp)
(Unlicense), [FFmpeg](https://ffmpeg.org/) (LGPL/GPL), and
[HandBrakeCLI](https://handbrake.fr/) (GPLv2) — MediaFlow invokes them as
separate processes; their licenses and sources are available at the linked
projects and via the Debian packages in the image.
