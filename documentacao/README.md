# Documentacao do SaldoPro

Analise baseada no codigo deste repositorio em 2026-03-04.

Esta pasta documenta o produto como ele esta implementado hoje: fluxos reais, limites tecnicos, recursos gratuitos, recursos premium e a operacao do WhatsApp.

## Arquivos desta pasta

- `visao-geral-do-produto.md`: resumo executivo do sistema, jornada do usuario, stack e limites estruturais.
- `planos-e-limites.md`: precos, recursos liberados por assinatura, limites do plano gratis e regras de cobranca.
- `whatsapp.md`: documentacao detalhada do canal mais importante do produto, incluindo entradas aceitas, automacoes e restricoes.
- `dashboard-e-modulos.md`: documentacao funcional de todas as telas do painel principal.
- `painel-admin.md`: resumo do painel administrativo separado, usado para operacao, suporte e controle de assinaturas.

## Resumo rapido

O SaldoPro e uma plataforma de controle financeiro com dois centros de uso:

- o painel web, onde o usuario revisa, organiza e acompanha os dados;
- o WhatsApp, onde a IA recebe comandos em linguagem natural para registrar, consultar e automatizar rotinas financeiras.

Hoje o produto combina:

- frontend React/Vite;
- autenticacao via Firebase;
- dados e storage via Supabase;
- IA via Groq;
- cobranca recorrente via Mercado Pago;
- integracao com WhatsApp via Baileys;
- um painel admin separado para operacao.

## O que ele faz, em uma linha

Ele permite controlar receitas, despesas, lembretes, recorrencias, documentos e metas, com forte foco em uso conversacional pelo WhatsApp.

## O que ele nao faz, em uma linha

Ele ainda nao tem sincronizacao bancaria, multi-moeda real, multiempresa, multiusuario colaborativo ou multiplos numeros de WhatsApp ativos ao mesmo tempo.
