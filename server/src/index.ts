import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './lib/config.js';
import { errorHandler } from './lib/http.js';
import { loadSession, csrfGuard } from './lib/auth.js';
import { migrate } from './migrate.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { gameRouter } from './routes/game.js';
import { plansRouter, sharedRouter } from './routes/plans.js';
import { alliancesRouter } from './routes/alliances.js';
import { eventsRouter } from './routes/events.js';
import { kingdomRouter } from './routes/kingdom.js';
import { adminRouter } from './routes/admin.js';
import { appointmentsRouter } from './routes/appointments.js';
import { planningRouter } from './routes/planning.js';
import { startJobs } from './jobs/reminders.js';
import { startDiscordBot } from './discord/bot.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  }));
  app.use(express.json({ limit: '3mb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests. Slow down and try again in a minute.' } }));
  api.use(loadSession);
  api.use(csrfGuard);
  api.get('/health', (_req, res) => { res.json({ ok: true, version: config.version }); });
  api.use('/auth', authRouter);
  api.use('/me', meRouter);
  api.use('/game', gameRouter);
  api.use('/plans', plansRouter);
  api.use('/shared', sharedRouter);
  api.use('/alliances', alliancesRouter);
  api.use('/events', eventsRouter);
  api.use('/kingdom', kingdomRouter);
  api.use('/admin', adminRouter);
  api.use('/appointments', appointmentsRouter);
  api.use('/planning', planningRouter);
  api.use((_req, res) => { res.status(404).json({ error: 'Unknown API route.' }); });
  app.use('/api', api);

  // Serve the built web app in production (single deployment)
  const webDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    // index.html must never be cached, so a new version shows after an update
    app.get('*', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(webDist, 'index.html')); });
  }
  app.use(errorHandler);
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (async () => {
    await migrate();
    createApp().listen(config.port, () => console.log(`[api] Kingdom Command Center v${config.version} listening on :${config.port}`));
    if (config.runJobs) startJobs();
    startDiscordBot().catch((e) => console.error('[discord] failed to start — reminders will be logged as failed', e));
  })().catch((e) => { console.error(e); process.exit(1); });
}
