import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { env } from '../config/env';

export function ensureFirebaseAdmin(): void {
  if (getApps().length > 0) return;

  initializeApp({
    credential: cert({
      projectId: env.firebaseProjectId,
      clientEmail: env.firebaseClientEmail,
      privateKey: env.firebasePrivateKey.replace(/\\n/g, '\n')
    })
  });
}

