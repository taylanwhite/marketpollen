/**
 * Vercel serverless entry for /api. Re-exports the Express app so all /api/* requests
 * hit this single function. Requires rewrite: /api/:path* -> /api in vercel.json.
 */
import app from '../server.js';
export default app;
