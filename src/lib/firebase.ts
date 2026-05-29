import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyDMnrR1Lx4-W_sg_hqW-1FIPTKY_uQeXPU').trim(),
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'cybergis-8ed59.firebaseapp.com').trim(),
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'cybergis-8ed59').trim(),
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'cybergis-8ed59.firebasestorage.app').trim(),
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '214506141085').trim(),
  appId: (import.meta.env.VITE_FIREBASE_APP_ID ?? '1:214506141085:web:0a3c2da711ac32e2f7ab74').trim(),
  measurementId: (import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? '').trim()
};

export const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
