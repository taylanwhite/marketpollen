/**
 * Local dev: run the Express API on port 3001. Use after: npm run build:handlers && npm run build:server
 */
import app from './server.js';

// Keep server up on unhandled rejections (log and continue)
process.on('unhandledRejection', (reason, promise) => {
  console.error('[API] Unhandled rejection:', reason);
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`API (Express) on http://localhost:${PORT}`);
  console.log('Start Vite in another terminal; it proxies /api here.');
});
