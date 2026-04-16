import { randomUUID } from 'node:crypto';

export type UserDataChangeScope =
  | 'categories'
  | 'chat-messages'
  | 'chat-sessions'
  | 'documents'
  | 'financial-profile'
  | 'goals'
  | 'profile'
  | 'recurring-transactions'
  | 'reminders'
  | 'settings'
  | 'transactions';

export interface UserDataChangeEvent {
  id: string;
  uid: string;
  scope: UserDataChangeScope;
  at: string;
}

type UserDataChangeListener = (event: UserDataChangeEvent) => void;

const listenersByUid = new Map<string, Set<UserDataChangeListener>>();

export function subscribeToUserDataChanges(uid: string, listener: UserDataChangeListener): () => void {
  const listeners = listenersByUid.get(uid) ?? new Set<UserDataChangeListener>();
  listeners.add(listener);
  listenersByUid.set(uid, listeners);

  return () => {
    const current = listenersByUid.get(uid);
    if (!current) {
      return;
    }

    current.delete(listener);
    if (current.size === 0) {
      listenersByUid.delete(uid);
    }
  };
}

export function publishUserDataChange(uid: string, scope: UserDataChangeScope): void {
  const listeners = listenersByUid.get(uid);
  if (!listeners || listeners.size === 0) {
    return;
  }

  const event: UserDataChangeEvent = {
    id: randomUUID(),
    uid,
    scope,
    at: new Date().toISOString()
  };

  for (const listener of listeners) {
    listener(event);
  }
}
