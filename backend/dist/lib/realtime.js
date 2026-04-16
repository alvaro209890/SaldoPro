"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscribeToUserDataChanges = subscribeToUserDataChanges;
exports.publishUserDataChange = publishUserDataChange;
const node_crypto_1 = require("node:crypto");
const listenersByUid = new Map();
function subscribeToUserDataChanges(uid, listener) {
    const listeners = listenersByUid.get(uid) ?? new Set();
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
function publishUserDataChange(uid, scope) {
    const listeners = listenersByUid.get(uid);
    if (!listeners || listeners.size === 0) {
        return;
    }
    const event = {
        id: (0, node_crypto_1.randomUUID)(),
        uid,
        scope,
        at: new Date().toISOString()
    };
    for (const listener of listeners) {
        listener(event);
    }
}
