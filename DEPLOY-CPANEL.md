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

## 4. Sign-in settings (required)

The whole site is behind a sign-in page. Until these are set, the site stays locked and
the sign-in page says what is missing. Set them in **Setup Node.js App** → edit the
application → **Environment variables**, never in a file inside the upload.

On your own computer, from the project folder, make a secret:

```bash
node scripts/hash-password.mjs --secret
```

| Variable | What to put |
|---|---|
| `AUTH_SECRET` | **Required.** The secret printed above (43 characters). Changing it signs everyone out. |
| `AUTH_DHIS2_URL` | Your DHIS2 server, e.g. `https://dhims2.ghsmail.org`. People then sign in with their own DHIS2 username and password. |
| `AUTH_USERS` | Optional site accounts that are not DHIS2 accounts (see below). |
| `AUTH_ALLOWED_USERS` | Optional: only these DHIS2 usernames may sign in, comma-separated. Leave empty to let any account on the server in. |
| `AUTH_SESSION_HOURS` | Optional: how long a sign-in lasts. Default `12`. |
| `AUTH_ADMINS` | Optional: DHIS2 usernames that may manage site accounts, comma-separated. |
| `AUTH_STORE` | Optional: where the account file lives. Default `~/dhis2-analysis-data/users.json`, in your hosting home, outside the app folder. |

Set at least one of `AUTH_DHIS2_URL` or `AUTH_USERS`.

A site account is made on your computer; the password never leaves it:

```bash
node scripts/hash-password.mjs admin "a long password"
# prints: admin:scrypt$16384$…   (several accounts: join the lines with commas)
```

Paste the printed line as the value of `AUTH_USERS`.

### Managing accounts in the site

`AUTH_USERS` only seeds the first administrator. After that, an administrator manages
everyone in the site: the account menu (top right) → **Manage users** adds people (with
a typed or generated password, shown once), resets passwords, makes people
administrators, and disables or deletes accounts. Everyone can change their own password
under **My account and password**; anyone given a password by an administrator must
replace it at first sign-in. A changed password, a disabled account or a removed
administrator role takes effect on the next click, including in other browsers.

These accounts are saved in `~/dhis2-analysis-data/users.json` (or `AUTH_STORE`),
outside the app folder, so deleting the app's files to update it keeps them. The file
holds only scrypt hashes, never passwords. Once an `AUTH_USERS` account is changed in
the site (e.g. the administrator changes their own password), the file's copy is the one
that counts.

If every administrator is locked out, open the file in File Manager and delete it (the
`AUTH_USERS` administrator works again), or remove just one account's entry.

**Every person uses their own DHIS2 token.** After signing in, each person opens
**Connection** and enters their own personal access token, so the site shows only what
their own DHIS2 account may see. Do **not** set `DHIS2_TOKEN` here: that would give every
signed-in person the same account. The saved token belongs to the person who entered it:
signing out forgets it, the next person to sign in on the same browser cannot use it, and
someone who signed in with a DHIS2 account cannot save a token that belongs to a different
DHIS2 user.

Do not set `COOKIE_SECURE=false`: cPanel serves the app over HTTPS with AutoSSL, and the
sign-in and token cookies need that.

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
| The sign-in page says "Sign-in is not set up yet" | `AUTH_SECRET` is missing or too short, or neither `AUTH_DHIS2_URL` nor `AUTH_USERS` is set. Add them and **Restart** the app. |
| "Wrong username or password" for a correct DHIS2 login | `AUTH_DHIS2_URL` points at the wrong server, or the account is not on `AUTH_ALLOWED_USERS`. |
| "Too many failed attempts" | Eight wrong passwords in 15 minutes from one address or for one account. Wait 15 minutes, or restart the app. |
| "This token belongs to the DHIS2 user …" | The token was made in a different DHIS2 account from the one signed in with. Create a token in your own account. |
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
