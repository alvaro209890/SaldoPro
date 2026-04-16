import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { env } from '../config/env';

export function ensureFirebaseAdmin(): boolean {
  if (getApps().length > 0) return true;
  if (!env.firebaseCredentials) return false;

  initializeApp({
    credential: cert({
      projectId: env.firebaseCredentials.projectId,
      clientEmail: env.firebaseCredentials.clientEmail,
      privateKey: env.firebaseCredentials.privateKey.replace(/\\n/g, '\n')
    })
  });

  return true;
}
