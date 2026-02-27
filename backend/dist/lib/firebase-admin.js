"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureFirebaseAdmin = ensureFirebaseAdmin;
const app_1 = require("firebase-admin/app");
const env_1 = require("../config/env");
function ensureFirebaseAdmin() {
    if ((0, app_1.getApps)().length > 0)
        return;
    (0, app_1.initializeApp)({
        credential: (0, app_1.cert)({
            projectId: env_1.env.firebaseProjectId,
            clientEmail: env_1.env.firebaseClientEmail,
            privateKey: env_1.env.firebasePrivateKey.replace(/\\n/g, '\n')
        })
    });
}
