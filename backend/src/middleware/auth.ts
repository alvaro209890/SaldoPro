import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.header('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (token.length === 0 || token !== env.whatsappApiToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

