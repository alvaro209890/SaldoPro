import {
  Bot,
  FileArchive,
  FileImage,
  FileText,
  History,
  MessageCircle,
  MessageSquareShare,
  Mic,
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

export const WHATSAPP_FEATURES = [
  {
    title: 'IA ilimitada no WhatsApp',
    description: 'Mande textos e áudios sem trava diária. A IA responde sem limite de mensagens.',
    icon: MessageCircle,
  },
  {
    title: 'Adicionar gastos por mensagem',
    description: 'Diga "gastei 50 no mercado" e a transação é registrada automaticamente.',
    icon: MessageSquareShare,
  },
  {
    title: 'Consultar saldo por voz',
    description: 'Envie um áudio perguntando seu saldo e receba a resposta na hora.',
    icon: Mic,
  },
  {
    title: 'Lembretes e alertas',
    description: 'Receba avisos de contas a vencer e resumos financeiros direto no WhatsApp.',
    icon: Zap,
  },
  {
    title: 'Buscar documentos',
    description: 'Peça suas imagens, PDFs e arquivos salvos e receba direto na conversa.',
    icon: FileText,
  },
  {
    title: 'Metas com IA',
    description: 'Acompanhe metas financeiras e receba tarefas de economia via WhatsApp.',
    icon: Target,
  },
];

export const PREMIUM_BENEFITS: PremiumBenefit[] = [
  {
    title: 'WhatsApp sem limite',
    description: 'Mensagens ilimitadas para a IA financeira direto no WhatsApp.',
    icon: MessageCircle,
  },
  {
    title: 'IA no painel',
    description: 'Chat com IA no painel web, sem limites e com contexto completo.',
    icon: Bot,
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
];

export const PLAN_INCLUDED_ITEMS = [
  { label: 'IA no painel', icon: Bot },
  { label: 'WhatsApp sem limite', icon: MessageSquareShare },
  { label: 'Metas e arquivos', icon: Sparkles },
];

export const PREMIUM_UNLOCK_ITEMS = [
  { label: 'WhatsApp ilimitado', icon: MessageCircle },
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
  'WhatsApp limitado (poucas msgs/dia)',
];

export const PREMIUM_PLAN_FEATURES = [
  'Tudo do basico',
  'WhatsApp com IA ilimitada',
  'Registrar transações por mensagem',
  'Consultar saldo por voz',
  'Documentos e imagens via WhatsApp',
  'IA no painel sem limite',
  'Metas com apoio inteligente',
  'Imagens, PDFs e ZIPs',
  'Historico e fluxos premium',
];
