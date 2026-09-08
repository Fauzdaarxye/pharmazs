import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { config } from './config';
import { logger } from './logger';
import { fail } from './http/envelope';
import { errorHandler, notFoundHandler } from './http/middleware';

import { healthRouter } from './routes/health.routes';
import { authRouter } from './routes/auth.routes';
import { dashboardRouter } from './routes/dashboard.routes';
import { productsRouter } from './routes/products.routes';
import { hcpsRouter } from './routes/hcps.routes';
import { repsRouter } from './routes/reps.routes';
import { regionsRouter } from './routes/regions.routes';
import { competitorsRouter } from './routes/competitors.routes';
import { inventoryRouter } from './routes/inventory.routes';
import { metaRouter } from './routes/meta.routes';
import { analyticsRouter } from './routes/analytics.routes';
import { importsRouter } from './routes/imports.routes';
import { chatRouter } from './routes/chat.routes';

export function createApp(): Application {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins.length ? config.corsOrigins : true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      // Never let a token/password reach the access log.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    }),
  );

  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json(fail('RATE_LIMITED', 'Too many requests, please slow down'));
    },
  });
  app.use('/api', limiter);

  // Health is unauthenticated.
  app.use('/api', healthRouter);

  // Domain routers.
  app.use('/api/auth', authRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/hcps', hcpsRouter);
  app.use('/api/reps', repsRouter);
  app.use('/api/regions', regionsRouter);
  app.use('/api/competitors', competitorsRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/meta', metaRouter);
  app.use('/api/imports', importsRouter);
  app.use('/api/chat', chatRouter);
  // Analytics/ML passthrough is mounted at /api (routes carry their own subpaths).
  app.use('/api', analyticsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
