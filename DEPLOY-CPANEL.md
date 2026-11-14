# Deploying on cPanel shared hosting (Namecheap)

DHIS2 Analysis is one Node.js process with no database, so it fits cPanel's **Setup
Node.js App**, which runs the app under Phusion Passenger. The build happens on your own
computer; the server only receives the finished bundle and runs it.

## What you need

- A Namecheap shared hosting plan with **Setup Node.js App** in cPanel (the Stellar plans
  have it). Pick Node.js **22** or **24** there; Next.js 16 needs 20.9 or newer.
- A subdomain or domain for the app, e.g. `analysis.example.org`. Use the root of a
  domain or subdomain, not a sub-folder such as `example.org/analysis`: the app's own
  URLs start at `/`.
- Node.js 20.9+ on your computer to build with.

## 1. Build the bundle on your computer

From the project folder:

```bash
npm ci
npm run build:cpanel
```

This runs the tests, builds the app, and writes:

- `dist/cpanel/` — the server, its `node_modules`, the static assets and `app.js`
- `dist/dhis2-analysis-cpanel.zip` — the same folder, zipped for upload

Nothing is installed or built on the server, which matters: shared hosting has memory and
process limits a `next build` or `npm install` would hit.

The bundle can be built on Windows, macOS or Linux. Next.js copies in an image library
(`sharp`) for the machine that built it, so a Windows build carries a Windows copy that
will not load on the Linux host. The app has no optimised images and never loads it, so
that is harmless; if `next/image` is ever added, build the bundle on Linux or WSL.

## 2. Create the app in cPanel

cPanel → **Software → Setup Node.js App → Create Application**:

| Field | Value |
|---|---|
| Node.js version | 22 (or 24) |
| Application mode | Production |
| Application root | `dhis2-analysis` (a folder under your home directory; cPanel creates it) |
| Application URL | the subdomain or domain the app will answer on |
| Application startup file | `app.js` |

Select **Create**, then **Stop App** for now so Passenger does not start it before the
files are in place.

If the subdomain does not exist yet, create it first under **Domains**, and set its
document root to a folder of its own (cPanel suggests one). Passenger places the app at
that URL itself; the document root only needs to exist.

## 3. Upload the bundle

cPanel → **Files → File Manager** → open the application root folder from step 2 →
**Upload** `dist/dhis2-analysis-cpanel.zip` → back in the folder, right-click the zip →
**Extract** into that same folder → delete the zip.

The folder should now contain `app.js`, `server.js`, `package.json`, `node_modules/` and
`.next/` beside the `.htaccess` that cPanel wrote when the app was created. Leave that
`.htaccess` alone: it is how Passenger finds the app. Turn on **Settings → Show Hidden
Files** in File Manager if you cannot see it.

## 4. Settings (optional)

Back in **Setup Node.js App**, edit the application and add environment variables as
needed. All are optional; without them each viewer connects with their own token.

| Variable | Purpose |
|---|---|
| `DHIS2_BASE_URL` | Pin one DHIS2 server for every viewer; the Connection page becomes read-only… |
| `DHIS2_TOKEN` | …with this token. Set it here only, never in a file inside the upload. |
| `DHIS2_TOKEN_TYPE` | `ApiToken` (default) or `Bearer`. |

Do not set `COOKIE_SECURE=false`: cPanel serves the app over HTTPS with AutoSSL, and the
login cookie needs that.

## 5. Start it

**Start App** in Setup Node.js App, then open the application URL. Go to **Connection**
and connect to your DHIS2 server.

Any change to the environment variables or the files needs **Restart** on the same page.

## Updating

Build a new bundle (step 1), then in File Manager delete everything in the application
root **except `.htaccess`**, upload and extract the new zip, and **Restart** the app.

## Checking on it

Passenger writes the app's output to `stderr.log` in the application root; open it in
File Manager when something does not start.

| Symptom | Likely cause |
|---|---|
| 503 or "Web application could not be started" | Open `stderr.log`. Usually a wrong startup file name, or a bundle extracted into a sub-folder rather than the root. |
| Starts, then the first page takes long | Passenger starts the process on the first request and stops it when idle. Normal on shared hosting. |
| Connect succeeds, then "not connected" on the next click | The app was opened over plain `http://`. Use the `https://` address; AutoSSL issues the certificate within an hour of creating the subdomain. |
| `EADDRNOTAVAIL` or a bind error in `stderr.log` | `app.js` was not used as the startup file. It pins the host name the shell leaks into the process. |
| Cannot reach DHIS2 | The host blocks the outbound connection or the DHIS2 URL is wrong. Namecheap support can confirm outbound HTTPS from the Node process. |
| Out of memory | Shared plans allow about 1 GB per account. The app itself is small; the limit is hit if a build or `npm install` is run on the server. Build locally. |

## What is not here

This copy of the project runs the DHIS2 Analysis pages only. The GeoEpi (R notebooks)
and Holistic Assessment (Postgres) services of the earlier Docker edition need their own
runtimes, which shared hosting does not offer, and are not included.

---

Built by **Bigvalues IT Systems** · WhatsApp [024 682 8504](https://wa.me/233246828504)
