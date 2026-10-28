# Deploying with Docker

This project runs as a Docker Compose stack. DHIS2 Analysis and GeoEpi run in separate
containers suited to their runtimes; only the Next.js app is published to the host. GeoEpi
is available through the authenticated `/geoepi/` route, and its datasets and job outputs
persist in named volumes.

## What you need

- Docker Engine 24+ with Compose v2 (Docker Desktop on Windows/macOS, or Docker on a
  Linux server/VPS)
- Internet access during the build (npm packages and the web font are downloaded)
- Enough build time and disk space for GeoEpi's R spatial packages and notebooks

## Quick start

From this folder:

```bash
docker compose up -d --build
```

Open http://localhost:3000, go to **Connection** and connect to your DHIS2 server.

The DHIS2 Analysis image runs the test suite before it is built. GeoEpi's first image
build installs R spatial packages and can take 10–20 minutes.

Stop it with `docker compose down`. GeoEpi datasets and run history are kept in named
volumes. The GeoEpi service is not published as a separate host port; access it through
the authenticated `/geoepi/` route after connecting to DHIS2.

## Settings

Copy `.env.example` to `.env` beside `docker-compose.yml` and uncomment what you need.
The file is optional.

| Variable | Default | Purpose |
|---|---|---|
| `HOST_PORT` | `3000` | Port on the host machine. Change it if 3000 is taken. |
| `DHIS2_BASE_URL` | – | Pin one DHIS2 server for every viewer… |
| `DHIS2_TOKEN` | – | …with this token. The Connection page becomes read-only. |
| `DHIS2_TOKEN_TYPE` | `ApiToken` | Or `Bearer`. |
| `COOKIE_SECURE` | secure | `false` only for plain-http access on a trusted internal network — see below. |

Apply changes with `docker compose up -d` (add `--build` after a code change). Never
commit `.env` or put a real token in any file you share.

## HTTPS

The login cookie is marked *Secure*, so browsers only send it over HTTPS — with one
exception: `http://localhost` counts as secure, which is why the quick start works on
your own machine.

**For anyone else to use it, put HTTPS in front.** The simplest is Caddy, which obtains
and renews a certificate automatically. Add to `docker-compose.yml`:

```yaml
  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    command: caddy reverse-proxy --from maps.example.org --to dhis2-analysis:3000
    volumes:
      - caddy-data:/data
    restart: unless-stopped

volumes:
  caddy-data:
```

Point the domain's DNS at the server, and remove the `ports:` block from the
`dhis2-analysis` service so the app is only reachable through Caddy. Nginx, Traefik or an
existing reverse proxy work equally well: forward to port 3000 and keep HTTPS in front.

### Internal network without HTTPS

If the app runs on an office or directorate network and people open it as
`http://192.168.x.x:3000`, browsers drop the Secure cookie and every connection is lost
on the next click. For that case only, set in `.env`:

```
COOKIE_SECURE=false
```

The token still never reaches the browser and the cookie is still `HttpOnly`, but it
travels unencrypted on that network. Use it only on a network you trust, and prefer HTTPS.

## Updating

Replace the source with the new version, then:

```bash
docker compose up -d --build
```

## Moving the image to a server without building there

On the machine that built it, save both service images:

```bash
docker save dhis2-analysis:latest dhis2-analysis-geoepi:latest -o dhis2-analysis-images.tar
```

Copy the `.tar`, the project files (including `geoepi/`), `docker-compose.yml` and your
`.env` to the server, then:

```bash
docker load -i dhis2-analysis-images.tar
docker compose up -d          # no --build: uses the loaded image
```

## Checking on it

```bash
docker compose ps             # STATUS shows (healthy) once it is up
docker compose logs -f        # server output
```

| Symptom | Likely cause |
|---|---|
| `ports are not available … 3000` | Something else uses port 3000. Set `HOST_PORT=3001` (or another) in `.env`. |
| Build fails at `npm test` | A test failed; the output above it names the test. No image is built from failing code. |
| Build fails fetching packages or fonts | No internet during the build, or a proxy blocking npm / Google Fonts. |
| Connect succeeds, then "not connected" | Opened over plain `http://` from another machine. Use HTTPS, or `COOKIE_SECURE=false` on a trusted network. |
| Cannot reach DHIS2 from the container | The server's firewall or DNS. Test with `docker exec dhis2-analysis wget -qO- https://your-dhis2/api/system/ping`. |

---

Built by **Bigvalues IT Systems** · WhatsApp [024 682 8504](https://wa.me/233246828504)
