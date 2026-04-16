import { Router } from 'express';
import { readSignedDocument } from '../lib/document-storage';

export function createStorageRouter(): Router {
  const router = Router();

  router.get('/api/storage/signed', async (req, res, next) => {
    try {
      const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
      if (!token) {
        res.status(400).json({ error: 'Missing token.' });
        return;
      }

      const file = await readSignedDocument(token);
      res.type(file.mimeType);
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.sendFile(file.absolutePath);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
