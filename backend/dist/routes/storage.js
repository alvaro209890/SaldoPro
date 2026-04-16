"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStorageRouter = createStorageRouter;
const express_1 = require("express");
const document_storage_1 = require("../lib/document-storage");
function createStorageRouter() {
    const router = (0, express_1.Router)();
    router.get('/api/storage/signed', async (req, res, next) => {
        try {
            const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
            if (!token) {
                res.status(400).json({ error: 'Missing token.' });
                return;
            }
            const file = await (0, document_storage_1.readSignedDocument)(token);
            res.type(file.mimeType);
            res.setHeader('Cache-Control', 'private, max-age=60');
            res.sendFile(file.absolutePath);
        }
        catch (error) {
            next(error);
        }
    });
    return router;
}
