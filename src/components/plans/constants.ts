import {
  Bot,
  FileArchive,
  FileImage,
  FileText,
  History,
  MessageSquareShare,
  ShieldCheck,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import type { BillingPlanCode } from '@/services/billing';
import type { PlanPositioning, PremiumBenefit } from './types';

export const PLAN_BADGES: Record<BillingPlanCode, string> = {
  monthly: 'Entrada rapida',
  quarterly: 'Mais escolhido',
  yearly: 'Maior economia',
};

export const PLAN_POSITIONING: Record<BillingPlanCode, PlanPositioning> = {
  monthly: {
    code: 'monthly',
    headline: 'Comece leve e entre no premium agora.',
    subline: 'Ideal para ativar o pacote completo com o menor investimento.',
    highlightLabel: 'Acesso imediato',
  },
  quarterly: {
    code: 'quarterly',
    headline: 'Equilibrio entre caixa, valor e resultado.',
    subline: 'A melhor troca entre custo mensal e ritmo de uso.',
    highlightLabel: 'Melhor custo-beneficio',
  },
  yearly: {
    code: 'yearly',
    headline: 'Menor custo por periodo para quem usa de verdade.',
    subline: 'Feito para quem quer pagar menos no longo prazo.',
    highlightLabel: 'Maior desconto',
  },
};

export const PREMIUM_BENEFITS: PremiumBenefit[] = [
  {
    title: 'IA sem limite diario',
    description: 'WhatsApp sem a trava diaria e chat IA liberado no painel.',
    icon: Zap,
  },
  {
    title: 'Metas inteligentes',
    description: 'Crie, ajuste e acompanhe metas com ajuda real da IA.',
    icon: Target,
  },
  {
    title: 'Arquivos sempre a mao',
    description: 'Guarde imagens, PDFs e ZIPs e recupere tudo quando precisar.',
    icon: FileText,
  },
  {
    title: 'Historico premium',
    description: 'Converse com mais contexto e mantenha o historico util salvo.',
    icon: History,
  },
];

export const PLAN_INCLUDED_ITEMS = [
  { label: 'IA no painel', icon: Bot },
  { label: 'WhatsApp sem limite', icon: MessageSquareShare },
  { label: 'Metas e arquivos', icon: Sparkles },
];

export const PREMIUM_UNLOCK_ITEMS = [
  { label: 'Salvar imagens', icon: FileImage },
  { label: 'Salvar PDFs', icon: FileText },
  { label: 'Salvar ZIPs', icon: FileArchive },
  { label: 'Metas com IA', icon: Target },
  { label: 'Checkout protegido', icon: ShieldCheck },
];

export const BASIC_PLAN_FEATURES = [
  'Dashboard basico',
  'Categorias',
  'Transacoes',
  'Lembretes',
  'Recorrencias',
  'Perfil financeiro',
];

export const PREMIUM_PLAN_FEATURES = [
  'Tudo do basico',
  'IA no painel',
  'IA no WhatsApp sem limite',
  'Metas com apoio inteligente',
  'Imagens, PDFs e ZIPs',
  'Historico e fluxos premium',
];
