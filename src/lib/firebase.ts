import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyBpKgdfh6dqjpqa05_6DV3WbgjspbUHK34').trim(),
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'saldopro-98049.firebaseapp.com').trim(),
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'saldopro-98049').trim(),
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'saldopro-98049.firebasestorage.app').trim(),
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '20469978858').trim(),
  appId: (import.meta.env.VITE_FIREBASE_APP_ID ?? '1:20469978858:web:a51714035b70dcef896993').trim(),
  measurementId: (import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? 'G-RN11JT1CZS').trim()
};

export const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
