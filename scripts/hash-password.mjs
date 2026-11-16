/**
 * Make the values sign-in needs, without storing any password.
 *
 *   node scripts/hash-password.mjs --secret
 *       prints a fresh AUTH_SECRET
 *
 *   node scripts/hash-password.mjs <username> <password>
 *       prints one AUTH_USERS entry: username:scrypt$…
 *       join several with commas: alice:scrypt$…,bob:scrypt$…
 *
 * Paste the output into the server's .env file (DEPLOY-DOCKER.md), then
 * restart the app with docker compose up -d. Run it on your own computer; the password never
 * leaves it and is not written anywhere.
 */
import { randomBytes, scrypt } from "node:crypto";

const args = process.argv.slice(2);

if (args[0] === "--secret") {
  console.log(randomBytes(32).toString("base64url"));
  process.exit(0);
}

const [username, password] = args;
if (!username || !password || args.length !== 2) {
  console.error('Usage:\n  node scripts/hash-password.mjs --secret\n  node scripts/hash-password.mjs <username> "<password>"');
  process.exit(1);
}
if (/[,:\s]/.test(username)) {
  console.error("The username cannot contain commas, colons or spaces.");
  process.exit(1);
}
if (password.length < 10) {
  console.error("Use a password of at least 10 characters.");
  process.exit(1);
}

const cost = 16384;
const salt = randomBytes(16);
scrypt(password, salt, 32, { N: cost, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
  if (error) throw error;
  console.log(`${username}:scrypt$${cost}$${salt.toString("base64url")}$${key.toString("base64url")}`);
});
