import type { NextFunction, Request, Response } from 'express';
import {
  getUserPlanAccess,
  isFeatureEnabled,
  type PremiumFeature
} from '../lib/subscription-access';
import { logger } from '../lib/logger';

interface PlanFeatureErrorOptions {
  code?: string;
  message?: string;
}

export function requirePlanFeature(
  feature: PremiumFeature,
  options: PlanFeatureErrorOptions = {}
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const code = options.code ?? 'PLAN_REQUIRED';
  const message = options.message ?? 'Esta funcionalidade exige um plano ativo.';

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const uid = (req as Request & { uid?: string }).uid;
    if (!uid) {
      res.status(401).json({ error: 'Token de autenticacao ausente.' });
      return;
    }

    try {
      const access = await getUserPlanAccess(uid);
      if (isFeatureEnabled(access.features, feature)) {
        next();
        return;
      }

      res.status(402).json({
        code,
        message,
        feature,
        subscriptionStatus: access.subscriptionStatus
      });
    } catch (error) {
      logger.error('Failed to evaluate plan feature access', {
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
