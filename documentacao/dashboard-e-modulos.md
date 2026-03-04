# Dashboard e Modulos do Painel Principal

## Rotas publicas

O app principal tem tres telas publicas:

- `/login`
- `/register`
- `/reset-password`

## O que acontece no cadastro

No cadastro, o usuario informa:

- nome completo;
- numero de WhatsApp;
- email;
- senha.

O sistema:

- adiciona automaticamente o prefixo `55`;
- cria a conta no Firebase;
- inicializa os dados no backend;
- prepara o numero de WhatsApp para uso;
- redireciona para o dashboard.

## Rotas protegidas

Depois do login, o painel principal expoe estes modulos:

- Dashboard
- Transacoes
- Lancamento IA
- Categorias
- Relatorios
- Lembretes
- Recorrentes
- Metas
- Imagens
- Planos
- Configuracoes

## 1. Dashboard

O dashboard faz:

- saudacao inicial;
- seletor de mes;
- cards de receitas, despesas e saldo;
- card de orcamento, se existir valor > 0;
- grafico de evolucao de saldo;
- grafico de despesas por categoria;
- lista de transacoes recentes;
- criacao e edicao rapida de transacoes por modal.

Comportamento importante:

- ao abrir, ele gera automaticamente lancamentos recorrentes vencidos;
- toda a visao e baseada no mes selecionado.

Limitacao atual:

- o card de orcamento depende de um valor salvo, mas o campo de orcamento esta oculto nas configuracoes atuais, entao esse recurso existe no modelo, mas nao esta realmente exposto de forma completa.

## 2. Transacoes

O modulo de transacoes permite:

- listar receitas e despesas do mes;
- filtrar por texto;
- filtrar por tipo;
- filtrar por categoria;
- filtrar por metodo de pagamento;
- filtrar por faixa de datas;
- filtrar por valor minimo e maximo;
- ordenar por data, valor ou descricao;
- criar, editar e excluir transacoes.

Observacao pratica:

- a tela trabalha sobre o mes carregado no seletor;
- mesmo com filtros de data, ela nao vira um extrator multi-meses completo.

## 3. Lancamento IA (modulo premium)

Esta tela e o chat de IA do painel web.

Ela permite:

- criar varias conversas;
- renomear o titulo da conversa a partir da primeira mensagem;
- apagar conversas;
- manter historico salvo;
- enviar instrucoes textuais para a IA;
- receber resposta em Markdown;
- transformar resposta da IA em acoes reais no sistema.

A IA do painel consegue, via backend:

- adicionar transacoes;
- atualizar transacoes;
- excluir transacoes.

Limitacoes atuais:

- o modulo e bloqueado sem plano premium;
- o payload enviado para IA usa apenas as ultimas 10 interacoes;
- o backend aceita imagem no chat, e o componente tem estado para isso, mas a tela atual nao expoe um controle visivel de upload de imagem.

## 4. Categorias

O modulo de categorias permite:

- ver categorias de despesa;
- ver categorias de receita;
- criar novas categorias;
- editar categorias existentes;
- excluir categorias.

Detalhe importante de negocio:

- ao excluir uma categoria, as transacoes ligadas a ela nao sao excluidas;
- elas ficam sem categoria;
- a propria UI avisa que isso ainda e uma limitacao do MVP.

## 5. Relatorios

O modulo de relatorios entrega:

- resumo de receitas, despesas e saldo do mes;
- taxa de economia quando ha receita;
- tabela de despesas por categoria;
- tabela de despesas por metodo de pagamento;
- lista dos maiores lancamentos;
- exportacao CSV do mes.

Limitacoes:

- so gera relatorio quando ha transacoes;
- e focado em leitura mensal, nao em comparacao historica de varios meses.

## 6. Lembretes

O modulo de lembretes permite:

- criar lembretes comuns;
- criar lembretes a pagar;
- criar lembretes a receber;
- buscar por texto;
- filtrar por status;
- filtrar por tipo;
- marcar como concluido;
- reabrir ao alternar status;
- editar e excluir.

A tela tambem calcula:

- total de pendentes;
- total atrasado;
- total a pagar;
- total a receber.

## 7. Recorrentes

O modulo de recorrentes permite:

- criar receitas ou despesas recorrentes;
- definir frequencia semanal, mensal ou anual;
- editar;
- excluir;
- pausar;
- reativar.

Comportamento importante:

- ao abrir a tela, o sistema tenta gerar lancamentos vencidos automaticamente.

## 8. Metas (modulo premium)

A area de metas e uma das partes mais ricas do painel premium.

Ela funciona em duas fases:

- primeiro, um questionario financeiro;
- depois, o painel completo de metas.

### Questionario financeiro

O questionario coleta:

- renda mensal;
- gastos fixos;
- gastos variaveis;
- percentual desejado de economia;
- objetivos financeiros em texto.

Depois disso, a IA pode gerar metas automaticamente.

### Painel de metas

A area completa permite:

- criar meta manual;
- gerar metas via IA;
- regenerar metas via IA;
- editar meta;
- excluir meta;
- atualizar progresso;
- concluir;
- pausar;
- filtrar por status;
- destacar metas em foco.

A propria tela reforca que o WhatsApp tambem pode:

- consultar metas;
- atualizar valores;
- concluir metas;
- mudar prioridade.

Limitacao:

- o modulo inteiro fica bloqueado sem assinatura premium.

## 9. Imagens / Biblioteca de Arquivos (modulo premium)

A biblioteca de arquivos permite:

- upload manual;
- visualizar arquivos vindos do painel e do WhatsApp;
- armazenar imagens, PDFs e ZIPs;
- editar nome, descricao e tags;
- baixar;
- excluir;
- ver ultimo download;
- ver origem do arquivo.

Tambem mostra indicadores de:

- total de arquivos;
- espaco usado;
- total de tags personalizadas.

Limites atuais:

- so aceita imagem, PDF e ZIP;
- limite de 10 MB por arquivo no frontend;
- sem plano premium a rota fica bloqueada.

## 10. Planos

A tela de planos:

- mostra status da assinatura;
- mostra a quota gratis de WhatsApp;
- destaca o premium com foco em WhatsApp;
- mostra os tres planos pagos;
- faz checkout por cartao;
- permite cancelar a assinatura.

Todos os planos pagos liberam o mesmo conjunto de recursos.

## 11. Configuracoes

A tela de configuracoes e dividida em duas abas:

- Ajustes
- Manual

### Aba Ajustes

Entrega:

- resumo de perfil;
- exibicao de nome e email;
- dados de conta;
- configuracao de numeros autorizados para WhatsApp.

Limitacoes explicitadas na UI:

- dia de fechamento esta fixo no dia 1;
- moeda principal esta limitada a BRL;
- o nome e o email sao gerenciados pela conta Firebase;
- o campo de orcamento existe no schema, mas esta escondido na interface atual.

### Aba Manual

A aba manual e praticamente uma documentacao interna do produto. Ela explica:

- como usar o WhatsApp;
- exemplos de comandos;
- entradas aceitas;
- casos de uso;
- como o painel complementa o chat;
- FAQ de uso diario.

## Modulos premium bloqueados por feature gate

As rotas abaixo exigem plano ativo:

- `/app/ai`
- `/app/documents`
- `/app/goals`

Se o usuario nao tiver plano, o sistema intercepta a tela e manda para a area de planos.
