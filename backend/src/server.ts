import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { env } from './config/env';
import { logger } from './lib/logger';
import { healthRouter } from './routes/health';
import { createQrPageRouter } from './routes/qr-page';
import { createWhatsAppRouter } from './routes/whatsapp';
import { createAiChatRouter } from './routes/ai-chat';
import { createDataRouter } from './routes/data';
import { WhatsAppClientsManager } from './whatsapp/manager';

const app = express();
const whatsappManager = new WhatsAppClientsManager();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(healthRouter);
app.use(createQrPageRouter(whatsappManager));
app.use('/api/whatsapp', createWhatsAppRouter(whatsappManager));
app.use('/api/ai', createAiChatRouter());
app.use('/api/data', createDataRouter());

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled backend error', error);
  const message = error instanceof Error ? error.message : 'Internal server error';
  res.status(500).json({ error: message });
});

const server = app.listen(env.port, () => {
  logger.info('Backend server started', { port: env.port, nodeEnv: env.nodeEnv });
});

void whatsappManager.startAll().catch((error) => {
  logger.error('Failed to start WhatsApp clients manager', error);
});

// Keep-alive: pings own /healthz every 5 minutes to prevent Render free-tier spin-down
if (env.backendUrl) {
  const KEEP_ALIVE_MS = 5 * 60 * 1000;
  setInterval(() => {
    fetch(`${env.backendUrl}/healthz`).catch(() => { });
  }, KEEP_ALIVE_MS);
  logger.info('Keep-alive enabled', { url: `${env.backendUrl}/healthz`, intervalMs: KEEP_ALIVE_MS });
}

const shutdown = async (signal: string): Promise<void> => {
  logger.warn('Shutdown signal received — closing gracefully', { signal });
  server.close();
  await whatsappManager.shutdownAll();
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

// Prevent Baileys internal errors (Boom, SessionError, etc.) from crashing the process
process.on('uncaughtException', (error) => {
  const isBoom = (error as { isBoom?: boolean }).isBoom === true;
  const isSessionError = error.name === 'SessionError' || error.message?.includes('No session record');
  const isConnectionClosed = error.message?.includes('Connection Closed');

  if (isBoom || isSessionError || isConnectionClosed) {
    logger.warn('Caught non-fatal Baileys error (process stays alive)', {
      name: error.name,
      message: error.message
    });
    return;
  }

  logger.error('Uncaught exception — process will exit', {
    name: error.name,
    message: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  const isBoom = (err as { isBoom?: boolean }).isBoom === true;

  if (isBoom || err.message?.includes('Connection Closed') || err.message?.includes('No session record')) {
    logger.warn('Caught non-fatal unhandled rejection (Baileys)', {
      message: err.message
    });
    return;
  }

  logger.error('Unhandled rejection', {
    name: err.name,
    message: err.message,
    stack: err.stack
  });
});
