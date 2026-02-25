import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut,
    updateProfile,
} from 'firebase/auth';
import { doc, setDoc, collection, writeBatch } from 'firebase/firestore';
import { auth, db } from './config';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from '@/utils/constants';

function generateSlug(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '-');
}

export async function registerUser(email: string, password: string, displayName: string) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const { uid } = cred.user;

    await updateProfile(cred.user, { displayName });

    // Create user profile
    await setDoc(doc(db, 'users', uid), {
        uid,
        email,
        displayName,
        createdAt: new Date().toISOString(),
    });

    // Create default settings
    await setDoc(doc(db, 'users', uid, 'settings', 'profile'), {
        budget: 0,
        startDay: 1,
        currency: 'BRL',
        whatsappAllowedNumbers: [],
        updatedAt: new Date().toISOString(),
    });

    // Seed default categories
    const batch = writeBatch(db);
    const categoriesRef = collection(db, 'users', uid, 'categories');

    [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES].forEach((cat) => {
        const slug = `${cat.type}-${generateSlug(cat.name)}`;
        batch.set(doc(categoriesRef, slug), {
            ...cat,
            createdAt: new Date().toISOString(),
        });
    });

    await batch.commit();
    return cred.user;
}

export async function loginUser(email: string, password: string) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
}

export async function resetPassword(email: string) {
    await sendPasswordResetEmail(auth, email);
}

export async function logoutUser() {
    await signOut(auth);
}
