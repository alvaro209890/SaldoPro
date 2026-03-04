# Painel Admin

## O que e

Existe um painel administrativo separado do app principal.

Ele tem build proprio (`admin`) e fica separado da interface do usuario final.

## Como o acesso funciona

O admin usa:

- login por senha administrativa;
- sessao guardada em token local;
- validacao de sessao no backend.

Observacao de seguranca:

- a senha vem de variavel de ambiente;
- o codigo tambem possui fallback hardcoded caso a variavel nao exista;
- isso e um risco operacional e deve ser eliminado em ambiente real.

## Abas do painel admin

O admin foi dividido em cinco areas:

- Visao Geral
- Operacao
- Usuarios
- Assinaturas
- Storage

## 1. Visao Geral

Mostra indicadores agregados, como:

- usuarios ativos;
- total de usuarios;
- usuarios bloqueados;
- mensagens de WhatsApp;
- ultima atividade;
- ranking de usuarios por volume de mensagens.

Tambem inclui graficos simples de crescimento e distribuicao.

## 2. Operacao

Focada em saude tecnica do backend e do WhatsApp.

Ela mostra:

- status do backend;
- uptime;
- status da sessao de WhatsApp;
- alertas recentes;
- eventos recentes do WhatsApp;
- QR disponivel para reconectar;
- botoes para resetar sessao e renovar QR.

## 3. Usuarios

Permite suporte operacional por usuario:

- listar usuarios;
- buscar por nome, email ou UID;
- filtrar bloqueados, sem WhatsApp e inativos;
- abrir detalhes de um usuario;
- ver metricas de uso;
- bloquear e desbloquear conta;
- bloquear ou liberar assinatura manualmente;
- voltar o usuario ao modo automatico de assinatura;
- enviar mensagem direta via WhatsApp;
- ver historico de mensagens;
- ver transacoes recentes;
- ver lembretes recentes.

## 4. Assinaturas

Central de billing e concessao de acesso.

Permite:

- listar assinaturas;
- filtrar por status;
- buscar por usuario;
- ver estimativa de receita mensal;
- identificar assinaturas manuais;
- bloquear premium de um usuario;
- conceder acesso premium por dias;
- acompanhar proximas cobrancas.

## 5. Storage

Mostra uso real do bucket de documentos.

A tela detalha:

- total do bucket;
- arquivos prontos;
- arquivos pendentes;
- usuarios com consumo;
- distribuicao por usuario;
- objetos fora do padrao esperado.

Isso e importante porque o produto usa um fluxo de documentos "pendente" e "finalizado".

## O que o painel admin faz de forma critica

- Mantem a operacao do WhatsApp viva.
- Permite recuperar sessao com QR.
- Permite suporte direto ao usuario.
- Permite override de assinatura.
- Permite auditar documentos e uso de storage.

## O que o painel admin nao faz hoje

- Nao parece usar controle de perfis administrativos multiplos.
- Nao existe RBAC visivel no frontend admin.
- Nao existe fluxo de 2FA para admin no codigo atual.
- O acesso depende basicamente da senha administrativa e da sessao emitida pelo backend.

## Resumo

O painel admin atual e um console operacional forte, voltado para:

- atendimento;
- monitoramento;
- cobranca;
- recuperacao de sessao do WhatsApp;
- governanca de storage.

Para um produto com foco em WhatsApp, esta area e essencial para manter a operacao.
