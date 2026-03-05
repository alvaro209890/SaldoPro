"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requirePlanFeature = requirePlanFeature;
const subscription_access_1 = require("../lib/subscription-access");
const logger_1 = require("../lib/logger");
// Temporary maintenance mode: keep billing/subscription code intact,
// but bypass premium feature enforcement on protected routes.
const PLAN_FEATURE_ENFORCEMENT_ENABLED = false;
function requirePlanFeature(feature, options = {}) {
    const code = options.code ?? 'PLAN_REQUIRED';
    const message = options.message ?? 'Esta funcionalidade exige um plano ativo.';
    return async (req, res, next) => {
        const uid = req.uid;
        if (!uid) {
            res.status(401).json({ error: 'Token de autenticacao ausente.' });
            return;
        }
        if (!PLAN_FEATURE_ENFORCEMENT_ENABLED) {
            next();
            return;
        }
        try {
            const access = await (0, subscription_access_1.getUserPlanAccess)(uid);
            if ((0, subscription_access_1.isFeatureEnabled)(access.features, feature)) {
                next();
                return;
            }
            res.status(402).json({
                code,
                message,
                feature,
                subscriptionStatus: access.subscriptionStatus
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to evaluate plan feature access', {
                uid,
                feature,
                error: error instanceof Error ? error.message : 'unknown'
            });
            res.status(500).json({
                error: 'Nao foi possivel validar o acesso ao plano no momento.'
            });
        }
    };
}
