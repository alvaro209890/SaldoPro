import express, { type NextFunction, type Request, type Response } from 'express';
import { env } from './config/env';
import { logger } from './lib/logger';
import { healthRouter } from './routes/health';
import { createQrPageRouter } from './routes/qr-page';
import { createWhatsAppRouter } from './routes/whatsapp';
import { WhatsAppClient } from './whatsapp/client';

const app = express();
const whatsappClient = new WhatsAppClient();

app.use(express.json({ limit: '1mb' }));
app.use(healthRouter);
app.use(createQrPageRouter(whatsappClient));
app.use('/api/whatsapp', createWhatsAppRouter(whatsappClient));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled backend error', error);
  const message = error instanceof Error ? error.message : 'Internal server error';
  res.status(500).json({ error: message });
});

const server = app.listen(env.port, () => {
  logger.info('Backend server started', { port: env.port, nodeEnv: env.nodeEnv });
});

void whatsappClient.start().catch((error) => {
  logger.error('Failed to start WhatsApp client', error);
});

// Keep-alive: pings own /healthz every 5 minutes to prevent Render free-tier spin-down
if (env.backendUrl) {
  const KEEP_ALIVE_MS = 5 * 60 * 1000;
  setInterval(() => {
    fetch(`${env.backendUrl}/healthz`).catch(() => {});
  }, KEEP_ALIVE_MS);
  logger.info('Keep-alive enabled', { url: `${env.backendUrl}/healthz`, intervalMs: KEEP_ALIVE_MS });
}

const shutdown = async (signal: string): Promise<void> => {
  logger.warn('Shutdown signal received — closing gracefully', { signal });
  server.close();
  await whatsappClient.shutdown();
  // Brief pause so the WebSocket close frame is sent before the process exits
  await new Promise((resolve) => setTimeout(resolve, 500));
  process.exit(0);
};

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

