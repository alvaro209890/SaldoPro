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

const shutdown = async (signal: string): Promise<void> => {
  logger.warn('Shutdown signal received', { signal });
  server.close();
  await whatsappClient.shutdown();
  process.exit(0);
};

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

