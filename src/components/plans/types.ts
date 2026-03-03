import type { LucideIcon } from 'lucide-react';
import type { BillingPlanCode, BillingStatusResponse } from '@/services/billing';

export type CheckoutStage = 'select' | 'checkout';

export type BillingSubscriptionStatus = BillingStatusResponse['subscription']['status'];

export interface PremiumBenefit {
  title: string;
  description: string;
  icon: LucideIcon;
}

export interface PlanPositioning {
  code: BillingPlanCode;
  headline: string;
  subline: string;
  highlightLabel: string;
}
