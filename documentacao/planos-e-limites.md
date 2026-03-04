# Planos, Precos e Limites

## Estrutura comercial atual

Os tres planos pagos usam a mesma base premium. O que muda e somente o periodo de cobranca e o valor.

## Tabela de planos

| Codigo | Nome | Valor | Cobranca | Equivalencia mensal |
| --- | --- | --- | --- | --- |
| `monthly` | Plano Mensal | R$ 20,00 | a cada 1 mes | entrada mais barata para ativar o premium |
| `quarterly` | Plano Trimestral | R$ 54,00 | a cada 3 meses | R$ 18,00/mes |
| `yearly` | Plano Anual | R$ 200,00 | a cada 12 meses | R$ 16,67/mes |

## Leitura comercial dos valores

Inferencia a partir dos precos cadastrados:

- o trimestral economiza R$ 6,00 por ciclo de 3 meses em relacao ao mensal;
- o anual economiza R$ 40,00 por ano em relacao a 12 pagamentos mensais.

## O que o plano gratis entrega

Pelo frontend e pelas regras de acesso, o plano gratis entrega:

- dashboard basico;
- transacoes;
- categorias;
- relatorios;
- lembretes;
- recorrencias;
- configuracoes;
- manual de uso;
- WhatsApp com uso limitado da IA.

## O que o plano gratis nao entrega

- IA no painel web.
- Historico premium de chat no painel.
- Metas.
- Biblioteca de documentos.
- Salvamento e recuperacao de documentos pelo WhatsApp.
- WhatsApp com IA ilimitada.

## O que qualquer plano premium libera

Todos os planos pagos liberam o mesmo pacote:

- `webAiChat`
- `webAiChatHistory`
- `goals`
- `documentStorage`
- `whatsappUnlimitedAi`
- `whatsappDocumentStorage`

Em linguagem de produto, isso significa:

- chat com IA no painel;
- historico de conversas premium;
- metas financeiras;
- armazenamento de imagens, PDFs e ZIPs;
- WhatsApp sem trava diaria de IA;
- documentos tambem acessiveis pelo WhatsApp.

## Limites praticos mais importantes

### Limite gratis do WhatsApp

- O plano gratis tem limite de 2 mensagens de IA por dia no WhatsApp.
- O reset ocorre na virada do dia no horario de Brasilia.
- Com premium, esse limite deixa de ser aplicado.

### Rate limit do WhatsApp

- Existe limitacao adicional de 10 mensagens por minuto por usuario para evitar spam.
- Se o usuario disparar mensagens em excesso, o sistema pede para aguardar.

### Limites de arquivos

- Tamanho final permitido para arquivos armazenados: ate 10 MB.
- PDFs podem chegar maiores e serem comprimidos.
- O backend aceita PDF de ate 40 MB como origem para tentar comprimir.
- Se o PDF nao puder cair para menos de 10 MB, o salvamento e recusado.

## Fluxo de pagamento

O checkout atual usa:

- Mercado Pago;
- assinatura recorrente;
- formulario de cartao embutido.

Na pratica, a tela de planos pede:

- numero do cartao;
- validade;
- CVV;
- nome no cartao;
- email;
- documento (CPF/CNPJ).

## O que a area de planos faz

- Carrega os planos do backend.
- Mostra o status atual da assinatura.
- Mostra a quota gratis restante do WhatsApp.
- Permite contratar um plano.
- Permite trocar de plano.
- Permite atualizar cartao do mesmo plano.
- Permite cancelar assinatura.

## O que a area de planos nao faz hoje

- Nao oferece PIX para assinatura.
- Nao oferece boleto para assinatura.
- Nao possui diferencas de funcionalidade entre mensal, trimestral e anual.
- Nao possui cupom, teste gratis ou downgrade automatico documentado no codigo.

## Status de assinatura tratados pelo sistema

- `none`: sem plano
- `pending`: pagamento em analise
- `authorized`: premium ativo
- `paused`: assinatura pausada
- `cancelled`: assinatura cancelada
- `rejected`: pagamento recusado

## Override administrativo

O painel admin pode:

- liberar premium manualmente;
- bloquear premium manualmente;
- devolver o usuario ao modo automatico;
- conceder acesso premium por quantidade de dias.

Isso significa que, operacionalmente, um usuario pode estar com acesso premium mesmo sem uma cobranca ativa do Mercado Pago, se houver concessao manual.
