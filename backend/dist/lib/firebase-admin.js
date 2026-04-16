"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureFirebaseAdmin = ensureFirebaseAdmin;
const app_1 = require("firebase-admin/app");
const env_1 = require("../config/env");
function ensureFirebaseAdmin() {
    if ((0, app_1.getApps)().length > 0)
        return true;
    if (!env_1.env.firebaseCredentials)
        return false;
    (0, app_1.initializeApp)({
        credential: (0, app_1.cert)({
            projectId: env_1.env.firebaseCredentials.projectId,
            clientEmail: env_1.env.firebaseCredentials.clientEmail,
            privateKey: env_1.env.firebaseCredentials.privateKey.replace(/\\n/g, '\n')
        })
    });
    return true;
}
