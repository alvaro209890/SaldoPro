# Visao Geral do Produto

## O que e o SaldoPro

SaldoPro e um sistema de gestao financeira pessoal com duas interfaces complementares:

- painel web para revisao, organizacao, filtros, relatorios e configuracao;
- WhatsApp com IA para registrar e consultar informacoes em linguagem natural.

Na pratica, o produto tenta reduzir atrito:

- o usuario fala com a IA no WhatsApp para agir rapido;
- o usuario abre o painel para revisar com calma e enxergar o contexto completo.

## Jornada principal do usuario

1. O usuario cria conta com nome, email, senha e numero de WhatsApp.
2. O backend faz bootstrap dos dados iniciais.
3. O sistema cria configuracoes padrao, adiciona o numero informado aos numeros autorizados e pre-vincula esse telefone a conta.
4. Categorias padrao sao disponibilizadas automaticamente.
5. Quando o WhatsApp esta conectado, o sistema tenta enviar uma mensagem de boas-vindas explicando como usar a IA.
6. O usuario passa a operar pelo painel web e/ou pelo WhatsApp.
7. Se assinar um plano, libera os modulos premium e o uso ilimitado da IA no WhatsApp.

## Stack e integracoes

- Frontend principal: React 19 + Vite.
- Painel admin: React + Vite em build separado.
- Autenticacao: Firebase Auth com email e senha.
- Banco e storage: Supabase.
- IA: Groq (chat e visao).
- Pagamentos: Mercado Pago com assinatura recorrente.
- WhatsApp: Baileys, com sessao autenticada por QR Code.

## O que o produto faz hoje

- Cadastro, login e recuperacao de senha.
- Registro manual de transacoes no painel.
- Registro de transacoes por IA no WhatsApp.
- Gestao de categorias de receita e despesa.
- Relatorios mensais com exportacao CSV.
- Lembretes comuns, a pagar e a receber.
- Transacoes recorrentes com geracao automatica de itens vencidos.
- Biblioteca de arquivos para imagens, PDFs e ZIPs.
- Metas financeiras com criacao manual e geracao assistida por IA.
- Chat com IA no painel web para operacoes financeiras.
- Controle de assinatura premium.
- Painel administrativo para operacao, suporte e cobranca.

## O que o produto nao faz hoje

Os pontos abaixo sao limites visiveis no codigo atual:

- Nao existe sincronizacao com bancos, Open Finance ou extrato automatico.
- Nao existe importacao de OFX, CSV bancario ou faturas.
- Nao existe multi-moeda real: a interface trabalha com BRL.
- Nao existe ciclo financeiro configuravel de verdade: o campo de inicio/fechamento esta travado no dia 1.
- Nao existe edicao de perfil completo dentro do app: nome e email dependem da conta Firebase.
- Nao existe colaboracao em equipe, perfis secundarios ou contas compartilhadas.
- Nao existe hierarquia de varios niveis premium: todos os planos pagos liberam o mesmo pacote.
- Nao existe mais de um slot ativo de WhatsApp: o backend opera com um unico slot (`wa1`).
- Nao existe atendimento em grupos do WhatsApp: o bot ignora grupos e status.

## Estrutura de modulos

O produto esta dividido em tres frentes:

- Painel principal do usuario.
- Canal conversacional no WhatsApp.
- Painel administrativo separado.

O painel principal concentra:

- Dashboard
- Transacoes
- Lancamento IA
- Categorias
- Relatorios
- Lembretes
- Recorrentes
- Metas
- Imagens/Documentos
- Planos
- Configuracoes + Manual

## Modelo de acesso

Existem tres niveis praticos de acesso:

- Publico: login, cadastro e redefinicao de senha.
- Usuario autenticado: dashboard basico, transacoes, categorias, relatorios, lembretes, recorrencias, configuracoes e area de planos.
- Usuario premium: chat com IA no painel, metas, armazenamento de documentos e uso ilimitado da IA no WhatsApp.

## Observacao importante sobre a experiencia

O produto nao e so um painel financeiro com um bot anexado. Pelo codigo, o WhatsApp e tratado como canal central de operacao e o painel web funciona como camada de revisao, analytics e governanca dos dados.
