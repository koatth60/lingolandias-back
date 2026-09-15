/**
 * Origins allowed to call the API and open a socket.
 *
 * Replaces `origin: '*'`, which let any website on the internet make
 * authenticated cross-origin calls on behalf of a logged-in user.
 *
 * Kept in one module because the HTTP server (main.ts) and the websocket
 * gateway configure CORS separately and must not drift apart — a socket that
 * accepts an origin the REST API rejects is the same hole with extra steps.
 *
 * Extra origins can be added at deploy time via CORS_EXTRA_ORIGINS
 * (comma-separated) without a code change; localhost is always included so
 * local development against a remote backend keeps working.
 */
const STATIC_ORIGINS = [
  'https://lingolandias.com',
  'https://www.lingolandias.com',
  'https://backend.lingolandias.com',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  'http://localhost:2000',
];

const fromEnv = (process.env.CORS_EXTRA_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');

export const allowedOrigins: string[] = [
  ...new Set([...STATIC_ORIGINS, ...fromEnv, ...(frontendUrl ? [frontendUrl] : [])]),
];

/**
 * Socket.IO's origin check. Requests with no Origin header (native mobile
 * clients, server-to-server, curl) are allowed through: CORS is a browser
 * mechanism and rejecting them here would break the Android app without
 * adding any protection.
 */
export const isAllowedOrigin = (origin?: string): boolean =>
  !origin || allowedOrigins.includes(origin);
