# WhatsApp: Funcionalidade, Regras e Limites

## Papel do WhatsApp no produto

O WhatsApp e o canal mais importante do SaldoPro. Pelo codigo, ele nao e apenas um "atalho" do app: ele e uma interface principal de operacao financeira.

Por ele, o usuario consegue:

- registrar transacoes;
- consultar saldo e panorama;
- criar lembretes;
- criar recorrencias;
- guardar e pedir arquivos de volta;
- acompanhar metas;
- desfazer acoes recentes;
- pedir links do site e do painel.

## Requisitos para o usuario ser atendido

Para a IA responder no WhatsApp, o numero precisa passar por todas estas regras:

- o usuario precisa existir no sistema;
- o numero precisa estar vinculado a uma conta;
- o numero precisa estar na lista de numeros autorizados daquela conta;
- a conversa precisa ser 1:1.

Se nao houver vinculo valido, o bot responde com uma orientacao de cadastro e envia o link de registro do site.

## Regra de autorizacao

A aba de Configuracoes do painel controla os numeros autorizados.

Consequencias praticas:

- so numeros cadastrados recebem resposta automatica;
- se um numero sair da whitelist, o binding antigo deixa de valer;
- o backend tenta religar o numero a conta certa automaticamente, mas so se ele ainda estiver autorizado.

## Tipo de conversa que o bot aceita

O bot foi implementado para conversa individual.

Ele ignora:

- grupos (`@g.us`);
- status (`status@broadcast`);
- mensagens enviadas pelo proprio numero;
- eventos duplicados;
- midias vazias ou falhas de decrypt.

## Entradas aceitas

### Texto

O usuario pode escrever de forma natural. Exemplos cobertos pelo proprio sistema:

- "gastei 80 no mercado"
- "recebi 350 de um freela"
- "como esta meu mes?"
- "me lembra amanha as 9h de pagar a luz"

### Audio

- Audios sao baixados e convertidos para base64 para entrar no pipeline de IA.
- O limite tecnico de audio e 10 MB por mensagem.
- O audio segue a mesma logica de texto depois da transcricao.

### Imagem

- Imagens entram no pipeline de IA.
- Se parecer comprovante, recibo, boleto ou documento financeiro, a IA tenta extrair dados e registrar transacao.
- Se nao for financeiro, a imagem pode entrar no fluxo de salvamento como arquivo.
- O limite padrao para imagem analisada pela IA e 5 MB.

### PDF

- PDF e aceito para armazenamento.
- Se vier com legenda clara e titulo util, pode ser salvo direto.
- Se vier sem titulo claro, o sistema segura o arquivo e pede um nome antes de concluir.

### ZIP

- ZIP tambem e aceito para armazenamento.
- O fluxo e o mesmo do PDF: com nome claro salva; sem nome claro, fica pendente ate o usuario nomear.

## Tipos de arquivo aceitos no salvamento

O fluxo de documentos aceita:

- imagens (`image/*`)
- PDF
- ZIP

Nao aceita, por enquanto:

- DOCX
- XLS/XLSX
- PPT
- videos como biblioteca de documentos
- formatos arbitrarios fora de imagem/PDF/ZIP

## O que a IA faz no WhatsApp

### 1. Registrar transacoes

- Cria receitas e despesas.
- Consegue registrar varias movimentacoes em uma unica mensagem.
- Usa categorias existentes do usuario.
- Usa metodos de pagamento padrao do sistema (`pix`, `credit`, `debit`, `cash`, `transfer`, `boleto`).

### 2. Consultar situacao financeira

- Responde perguntas sobre saldo.
- Resume receitas e despesas do periodo.
- Pode interpretar perguntas abertas sobre o mes atual.

### 3. Criar transacoes recorrentes

- Entende recorrencia semanal, mensal e anual.
- Cria um item recorrente em vez de apenas um lancamento isolado, quando a mensagem indicar repeticao.

### 4. Criar e atualizar lembretes

O sistema suporta:

- lembrete comum;
- conta a pagar;
- conta a receber.

Ele tambem tenta inferir datas e horarios a partir de linguagem natural, incluindo:

- "daqui a 30 minutos"
- "em 2 horas"
- "hoje"
- "amanha"
- "depois de amanha"
- "dia 10"
- "fim do mes"
- "todo dia"
- dias da semana
- horarios como "as 9", "14:30", "a tarde", "a noite"

### 5. Enviar lembretes de volta no WhatsApp

Existe um processo em background que:

- varre lembretes vencendo;
- manda a notificacao no WhatsApp;
- marca o lembrete como notificado.

Ou seja: o WhatsApp nao serve so para criar, ele tambem serve para receber o aviso.

### 6. Desfazer a ultima acao

Existe um mecanismo de undo rapido com janela de 5 minutos para varias acoes, como:

- transacao criada;
- transacao excluida;
- recorrencia criada;
- lembrete criado;
- lembrete atualizado;
- lembrete concluido;
- lembrete excluido.

Palavras como estas foram tratadas no codigo:

- desfaz
- desfazer
- cancela
- cancelar
- errei
- anula

### 7. Guardar documentos

Quando o usuario envia imagem, PDF ou ZIP com intencao de salvar:

- o arquivo vai para um storage pendente;
- se o titulo estiver claro, o sistema finaliza e registra o documento;
- se o titulo nao estiver claro, ele pede um nome antes de salvar em definitivo.

### 8. Reenviar documentos ja salvos

O usuario pode pedir algo como:

- "me manda de novo aquele comprovante"
- "procura o contrato de aluguel"
- "cade a nota fiscal"

O backend:

- analisa intencao de busca;
- ranqueia documentos recentes por titulo, descricao e tokens;
- pode escolher direto ou reduzir ambiguidades;
- envia o arquivo de volta no chat.

### 9. Acompanhar metas

Com plano premium ativo, a IA no WhatsApp tambem consegue:

- listar metas;
- atualizar valores;
- concluir metas;
- ajustar prioridade;
- apagar metas.

### 10. Entregar links

Se o usuario pedir o link do site, painel, app ou dashboard, o bot responde com:

- link do site;
- link do painel.

## Regras de plano dentro do WhatsApp

### Plano gratis

- pode usar IA no WhatsApp;
- tem limite de 2 mensagens de IA por dia;
- nao pode salvar nem buscar documentos.

### Plano premium

- tem IA ilimitada no WhatsApp;
- pode salvar imagens, PDFs e ZIPs;
- pode pedir esses arquivos de volta;
- pode usar fluxos premium ligados a metas e historico.

## Mensagens bloqueadas por limite

Quando o usuario gratis bate o limite diario, o sistema responde com:

- aviso de que o limite gratis do dia acabou;
- chamada para assinar um plano;
- link para o painel.

## Rate limit e protecoes

- Limite de 10 mensagens por minuto por usuario.
- Mensagens muito longas sao limitadas pelas regras do backend.
- O fluxo tenta evitar sessao duplicada com lock distribuido.
- Se a sessao cair, o admin pode resetar e gerar novo QR.

## Modelo de conexao

Hoje existe um unico slot ativo:

- `wa1`

Isso significa:

- um unico numero conectado ao backend por vez;
- nenhuma arquitetura multi-instances em producao nesta base;
- a operacao depende desse slot estar saudavel.

## Operacao tecnica

O backend oferece:

- pagina de QR para conectar a sessao;
- endpoint para ver status;
- endpoint para renovar QR;
- endpoint para resetar sessao;
- envio de mensagens roteadas pelo backend;
- mensagem de boas-vindas para novos cadastros, quando a conexao estiver ativa.

## O que o WhatsApp nao faz hoje

- Nao atende grupos.
- Nao atende status.
- Nao opera com varios slots ativos.
- Nao salva formatos fora de imagem, PDF e ZIP.
- Nao conclui salvamento de PDF/ZIP sem titulo claro.
- Nao garante armazenamento de arquivo maior que 10 MB.
- Nao mantem o fluxo de documentos no plano gratis.

## Resumo executivo

O WhatsApp do SaldoPro hoje ja funciona como:

- entrada de dados;
- automacao;
- notificacao;
- busca de arquivos;
- interface de metas;
- camada de onboarding.

Essa e a parte mais forte do produto no estado atual do codigo.
