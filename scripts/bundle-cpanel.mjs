/**
 * Assemble the upload bundle for cPanel shared hosting from a finished
 * `next build` (output: "standalone"). Run through `npm run build:cpanel`.
 *
 * The result is dist/cpanel/, holding everything the server needs and nothing
 * it does not: the standalone server and its own node_modules, the static
 * assets, and the Passenger startup file. dist/dhis2-analysis-cpanel.zip is the
 * same folder zipped for the cPanel File Manager. No npm install happens on the
 * server, and no build does either — shared hosting has neither the memory nor
 * the time limits for one.
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standalone = join(root, ".next", "standalone");
const staticDir = join(root, ".next", "static");
const publicDir = join(root, "public");
const out = join(root, "dist", "cpanel");
const zip = join(root, "dist", "dhis2-analysis-cpanel.zip");

if (!existsSync(join(standalone, "server.js"))) {
  console.error(
    "No standalone build found. Run `npm run build` first (or `npm run build:cpanel`, which does both).",
  );
  process.exit(1);
}

rmSync(join(root, "dist"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The standalone folder has server.js, a trimmed node_modules and .next/server,
// but by design not the static assets or public/ — those are copied beside it.
cpSync(standalone, out, { recursive: true });
cpSync(staticDir, join(out, ".next", "static"), { recursive: true });
if (existsSync(publicDir)) cpSync(publicDir, join(out, "public"), { recursive: true });
cpSync(join(root, "deploy", "cpanel", "app.js"), join(out, "app.js"));

// A secrets file must never travel with the bundle; settings go in cPanel's
// environment-variable table instead.
for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  rmSync(join(out, name), { force: true });
}

const zipped = makeZip(out, zip);

console.log(`Bundle folder: ${out}`);
if (zipped) {
  const mb = (statSync(zip).size / 1024 / 1024).toFixed(1);
  console.log(`Upload file:   ${zip} (${mb} MB)`);
} else {
  console.log("No zip tool was found; zip the bundle folder yourself before uploading.");
}
console.log("Next: DEPLOY-CPANEL.md, step 3.");

/**
 * Zip with what the platform ships: Windows' own tar (bsdtar, which writes zip
 * files; named by full path because a Git Bash shell puts GNU tar first on
 * PATH) with Compress-Archive as fallback, and `zip` elsewhere.
 */
function makeZip(folder, target) {
  const attempts =
    process.platform === "win32"
      ? [
          [
            join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
            ["-a", "-cf", target, "-C", folder, "."],
          ],
          [
            "powershell.exe",
            [
              "-NoProfile",
              "-Command",
              `Compress-Archive -Path '${join(folder, "*")}' -DestinationPath '${target}' -Force`,
            ],
          ],
        ]
      : [
          ["zip", ["-qr", target, "."], folder],
          ["tar", ["-a", "-cf", target, "-C", folder, "."]],
        ];
  for (const [cmd, args, cwd] of attempts) {
    const result = spawnSync(cmd, args, { cwd, stdio: "ignore" });
    if (result.status === 0 && existsSync(target)) return true;
    rmSync(target, { force: true });
  }
  return false;
}
