import type { NextFunction, Request, Response } from 'express';
import { verifyAdminSessionToken } from '../lib/admin-session';

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.header('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Admin session missing.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  const verification = verifyAdminSessionToken(token);
  if (!verification.valid) {
    res.status(401).json({ error: 'Admin session invalid or expired.' });
    return;
  }

  (req as Request & { adminExpiresAt: string }).adminExpiresAt = verification.expiresAt;
  next();
}
