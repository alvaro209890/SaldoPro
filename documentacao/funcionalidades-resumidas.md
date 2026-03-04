# Funcionalidades Resumidas do SaldoPro

Este arquivo resume, de forma direta, o que o sistema faz hoje.

## Acesso e conta

- Cadastro com nome, email, senha e numero de WhatsApp.
- Login com email e senha.
- Recuperacao e redefinicao de senha.
- Protecao de rotas para usuarios autenticados.

## Painel principal

- Dashboard com resumo financeiro do mes.
- Cards de receitas, despesas e saldo.
- Graficos de evolucao e distribuicao de gastos.
- Lista de transacoes recentes.

## Transacoes

- Criacao manual de receitas e despesas.
- Edicao e exclusao de transacoes.
- Filtros por texto, tipo, categoria, metodo de pagamento, data e valor.
- Ordenacao por data, valor e descricao.

## Categorias

- Categorias de receita e despesa.
- Criacao, edicao e exclusao de categorias.
- Categorias padrao criadas no bootstrap do usuario.

## Relatorios

- Resumo mensal de receitas, despesas e saldo.
- Analise de despesas por categoria.
- Analise de despesas por metodo de pagamento.
- Lista de maiores lancamentos.
- Exportacao CSV.

## Lembretes

- Lembretes comuns.
- Lembretes a pagar.
- Lembretes a receber.
- Edicao, exclusao e marcacao de concluido.
- Filtros por status e tipo.

## Recorrencias

- Criacao de transacoes recorrentes.
- Frequencias semanal, mensal e anual.
- Pausar e reativar recorrencias.
- Geracao automatica de lancamentos vencidos.

## IA no painel (premium)

- Chat com IA no painel web.
- Historico de conversas.
- Criacao, atualizacao e exclusao de transacoes pela IA.

## Metas (premium)

- Questionario financeiro inicial.
- Geracao de metas com IA.
- Criacao manual de metas.
- Edicao, conclusao, pausa e exclusao.
- Filtros e visao de progresso.

## Arquivos / documentos (premium)

- Upload manual de arquivos.
- Biblioteca de imagens, PDFs e ZIPs.
- Armazenamento de imagens enviadas pelo painel e pelo WhatsApp.
- Edicao de nome, descricao e tags.
- Download e exclusao.
- Controle de espaco usado.

## Storage e armazenamento

- O sistema usa storage no Supabase para guardar arquivos do usuario.
- As imagens podem ser salvas como documentos e depois reabertas no painel.
- PDFs e ZIPs seguem o mesmo fluxo de armazenamento.
- Existe fluxo de arquivo pendente quando o usuario envia um arquivo sem nome claro no WhatsApp.
- Depois de confirmado, o arquivo sai da area pendente e vai para a biblioteca final do usuario.
- O sistema gera links temporarios para preview e download dos arquivos.
- O painel mostra estatisticas de armazenamento por quantidade de arquivos e espaco utilizado.
- O painel admin mostra uso real do bucket, separados em arquivos prontos e pendentes.

## WhatsApp

- Registro de gastos e receitas por texto.
- Uso por audio com transcricao.
- Leitura de comprovantes e imagens financeiras.
- Salvamento de imagens como arquivo quando nao forem tratadas como lancamento financeiro.
- Criacao de lembretes pelo chat.
- Criacao de recorrencias pelo chat.
- Consulta de saldo e panorama financeiro.
- Salvamento e reenvio de documentos (premium).
- Acompanhamento de metas (premium).
- Desfazer a ultima acao em varios fluxos.

## Planos e cobranca

- Tela de planos com status da assinatura.
- Checkout por cartao via Mercado Pago.
- Planos mensal, trimestral e anual.
- Cancelamento de assinatura.
- Controle de recursos premium por feature gate.

## Painel admin

- Visao geral de operacao.
- Monitoramento do backend.
- Monitoramento da conexao WhatsApp.
- Reset de sessao e renovacao de QR.
- Gestao de usuarios.
- Gestao de assinaturas.
- Concessao manual de premium.
- Analise de uso de storage.

## Limites importantes

- Plano gratis com WhatsApp limitado a 2 mensagens de IA por dia.
- Premium libera IA ilimitada no WhatsApp.
- Documentos limitados a imagens, PDF e ZIP.
- Tamanho padrao de arquivo: ate 10 MB.
- Apenas um slot de WhatsApp ativo na implementacao atual.

## Leitura rapida

Em resumo, o SaldoPro e um sistema de controle financeiro com painel web e forte operacao via WhatsApp, com os modulos premium concentrados em IA, metas, documentos e uso ilimitado da automacao conversacional.
