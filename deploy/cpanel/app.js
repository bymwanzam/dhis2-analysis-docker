/**
 * Startup file for cPanel's "Setup Node.js App" (Phusion Passenger).
 *
 * Passenger loads this file, replaces the port the server listens on with its
 * own socket, and routes the domain to it. Two things have to be settled before
 * the Next.js standalone server starts:
 *
 *  - HOSTNAME. The cPanel shell sets it to the machine's host name, and the
 *    standalone server would then try to bind to that name and fail. Passenger
 *    owns the socket anyway, so bind to loopback.
 *  - NODE_ENV. The Secure flag on the login cookie depends on it; Passenger sets
 *    it in Production mode, and this keeps it set if the mode is changed.
 */
process.env.HOSTNAME = "127.0.0.1";
process.env.PORT = process.env.PORT || "3000";
process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.NEXT_TELEMETRY_DISABLED = "1";

// The standalone server is CommonJS, and so is this file: Passenger loads it with require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("./server.js");
