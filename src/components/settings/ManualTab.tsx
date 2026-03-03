import {
  ArrowRight,
  Archive,
  BarChart3,
  BellRing,
  Bot,
  CheckCircle2,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  Receipt,
  ShieldCheck,
  Sparkles,
  Target,
  Undo2
} from 'lucide-react';

const quickStartSteps = [
  {
    number: '01',
    title: 'Autorize seu numero',
    text: 'Na aba Ajustes, cadastre os numeros que podem falar com a IA. So numeros autorizados recebem resposta no WhatsApp.'
  },
  {
    number: '02',
    title: 'Use linguagem natural',
    text: 'Voce nao precisa decorar comandos. Escreva ou grave do jeito que falaria com uma secretaria financeira.'
  },
  {
    number: '03',
    title: 'Revise no painel',
    text: 'Tudo o que a IA registrar pode ser acompanhado, editado e complementado no painel web, incluindo documentos, lembretes e metas.'
  }
];

const whatsappInputs = [
  {
    icon: MessageSquare,
    title: 'Texto livre',
    accent: 'from-emerald-500/20 to-emerald-500/5',
    iconColor: 'text-emerald-300',
    example: 'Paguei 68 no almoco e 12 no estacionamento.',
    result: 'A IA separa, classifica e salva cada lancamento.'
  },
  {
    icon: Mic,
    title: 'Audio',
    accent: 'from-sky-500/20 to-sky-500/5',
    iconColor: 'text-sky-300',
    example: 'Recebi 350 de um freela hoje cedo.',
    result: 'O audio e transcrito e processado como se fosse texto.'
  },
  {
    icon: ImageIcon,
    title: 'Imagem',
    accent: 'from-amber-500/20 to-amber-500/5',
    iconColor: 'text-amber-300',
    example: 'Foto de comprovante, cupom, boleto, recibo ou print importante.',
    result: 'A leitura visual identifica valores, datas e contexto. Se nao for financeiro, a imagem tambem pode ser guardada como arquivo.'
  },
  {
    icon: FileText,
    title: 'PDF',
    accent: 'from-rose-500/20 to-rose-500/5',
    iconColor: 'text-rose-300',
    example: 'Envie um PDF com legenda e a legenda vira o titulo.',
    result: 'Sem legenda, a IA pede um nome antes de salvar.'
  },
  {
    icon: Archive,
    title: 'ZIP',
    accent: 'from-orange-500/20 to-orange-500/5',
    iconColor: 'text-orange-300',
    example: 'Envie um .zip para guardar materiais ou arquivos compactados.',
    result: 'O fluxo segue a mesma regra: legenda salva, sem legenda pede titulo.'
  }
];

const playbooks = [
  {
    title: 'Registrar gastos e receitas',
    summary: 'O fluxo principal do SaldoPro. A IA entende valor, tipo, horario e categoria com pouca friccao.',
    bullets: [
      'Pode registrar varias movimentacoes na mesma mensagem.',
      'Entende contexto como "agora", "ontem", "hoje cedo".',
      'Serve para despesa, receita, transferencia e ajustes simples.'
    ],
    sampleUser: '"Gastei 42 no mercado, 18 na farmacia e recebi 600 de um cliente."',
    sampleAi: 'A IA cria os lancamentos separados e usa a melhor categoria disponivel.'
  },
  {
    title: 'Consultar situacao financeira',
    summary: 'Voce pode pedir resumo, saldo, tendencia, panorama do mes ou revisar registros recentes.',
    bullets: [
      'Pergunte sobre o mes atual ou periodos especificos.',
      'Peca resumo de receitas, despesas e saldo restante.',
      'Use isso para decidir se pode gastar ou precisa reduzir ritmo.'
    ],
    sampleUser: '"Como esta meu mes? Quanto ainda posso gastar?"',
    sampleAi: 'A IA resume entradas, saidas, saldo e traduz isso em uma resposta objetiva.'
  },
  {
    title: 'Guardar documentos',
    summary: 'O WhatsApp tambem funciona como ponto de entrada para seus arquivos mais importantes.',
    bullets: [
      'Imagens podem ser analisadas como comprovantes e tambem salvas como arquivo.',
      'PDF e ZIP entram no fluxo de salvamento de documentos pelo WhatsApp.',
      'Se houver legenda, ela vira o titulo. Se nao houver, a IA pede o titulo.',
      'Depois, voce pode pedir o arquivo salvo de volta no proprio WhatsApp.'
    ],
    sampleUser: '"Contrato social 2026" + envio do PDF',
    sampleAi: 'O arquivo e salvo com esse titulo e fica disponivel na area de documentos.'
  },
  {
    title: 'Criar lembretes por texto ou audio',
    summary: 'Voce pode usar a IA para marcar compromissos, contas, cobrancas e alertas sem abrir formulários.',
    bullets: [
      'Funciona para lembretes gerais, contas a pagar e contas a receber.',
      'Pode ser criado por texto ou por audio no WhatsApp.',
      'A IA entende contexto de vencimento, valor e titulo do lembrete.',
      'Quando chegar a hora, o aviso pode voltar para voce no WhatsApp.'
    ],
    sampleUser: '"Me lembra amanha as 9h de pagar a conta de luz de 186 reais."',
    sampleAi: 'A IA cria o lembrete com valor, data, tipo e te avisa no horario programado.'
  },
  {
    title: 'Pedir arquivos salvos de volta',
    summary: 'Voce pode recuperar imagens e documentos que ja guardou sem precisar entrar manualmente na aba de documentos.',
    bullets: [
      'Peça o arquivo pelo nome, assunto ou contexto.',
      'A IA busca entre os arquivos recentes e tenta encontrar o melhor match.',
      'Se houver duvida, ela pode te mostrar as opcoes para voce escolher.',
      'Depois disso, ela envia o arquivo de volta no WhatsApp.'
    ],
    sampleUser: '"Me manda de novo aquele comprovante do pix da oficina."',
    sampleAi: 'A IA procura o documento salvo mais relevante e devolve o arquivo no chat.'
  }
];

const automationCards = [
  {
    icon: BellRing,
    title: 'Lembretes que voltam no WhatsApp',
    color: 'text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-400/15',
    bullets: [
      'A IA pode te lembrar de tarefas simples e compromissos financeiros.',
      'Serve para contas a pagar, valores a receber e lembretes gerais.',
      'O aviso retorna no WhatsApp, deixando o acompanhamento mais pratico.'
    ]
  },
  {
    icon: MessageSquare,
    title: 'Criacao por texto ou audio',
    color: 'text-emerald-300',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-400/15',
    bullets: [
      'Voce pode escrever: "me lembra sexta de cobrar 500 do cliente".',
      'Ou mandar audio dizendo a mesma coisa, sem perder contexto.',
      'A IA interpreta prazo, valor, titulo e tipo do lembrete.'
    ]
  },
  {
    icon: FolderOpen,
    title: 'Reenvio de imagens e documentos salvos',
    color: 'text-cyan-300',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-400/15',
    bullets: [
      'Arquivos guardados podem ser pedidos de volta pelo WhatsApp.',
      'Isso vale para imagens, PDFs e outros documentos que ja foram salvos.',
      'A conversa vira tambem um ponto de consulta do seu proprio acervo.'
    ]
  },
  {
    icon: Target,
    title: 'Metas e objetivos',
    color: 'text-fuchsia-300',
    bg: 'bg-fuchsia-500/10',
    border: 'border-fuchsia-400/15',
    bullets: [
      'A aba de Metas ajuda a transformar desejos em objetivos acompanhaveis.',
      'Voce pode organizar metas ativas, concluidas e canceladas.',
      'O painel complementa o que a IA registra no dia a dia com direcao de longo prazo.'
    ]
  }
];

const panelModules = [
  {
    icon: BarChart3,
    title: 'Dashboard',
    text: 'Visao rapida do seu desempenho financeiro, com leitura de saldo, ritmo de gastos e principais indicadores.'
  },
  {
    icon: FolderOpen,
    title: 'Documentos',
    text: 'Central para revisar, baixar e organizar imagens, PDFs e outros arquivos salvos pelo WhatsApp ou enviados direto pelo painel.'
  },
  {
    icon: BellRing,
    title: 'Lembretes',
    text: 'Controle de vencimentos, pagamentos, recebimentos e alertas gerais. O lembrete pode nascer no WhatsApp e ser auditado aqui.'
  },
  {
    icon: Target,
    title: 'Metas',
    text: 'Espaco para criar, acompanhar e revisar objetivos financeiros com base no seu historico real de gastos e receitas.'
  }
];

const faqItems = [
  {
    question: 'Preciso falar de um jeito especifico com a IA?',
    answer: 'Nao. O ideal e escrever do jeito mais natural possivel, com informacoes como valor, contexto e tipo do gasto ou receita.'
  },
  {
    question: 'Posso corrigir um registro errado sem abrir o painel?',
    answer: 'Sim. Palavras como "desfazer", "cancela" e "errei" ajudam a reverter a ultima acao e retomar o fluxo.'
  },
  {
    question: 'Quando usar o painel em vez do WhatsApp?',
    answer: 'Use o WhatsApp para velocidade. Use o painel para revisar historico, ajustar detalhes, consultar relatorios, organizar documentos, administrar lembretes e acompanhar metas.'
  },
  {
    question: 'O que acontece se eu enviar um arquivo sem legenda?',
    answer: 'Para PDF e ZIP, a IA segura o arquivo e pede um titulo antes de concluir o salvamento.'
  },
  {
    question: 'Posso pedir uma imagem ou PDF que ja salvei?',
    answer: 'Sim. Se o arquivo ja estiver salvo, voce pode pedir de volta no WhatsApp usando o nome, assunto ou contexto do documento.'
  },
  {
    question: 'A IA consegue me lembrar de contas a pagar e receber?',
    answer: 'Sim. Ela pode registrar lembretes financeiros como pagar aluguel, cobrar cliente, receber parcela ou qualquer outro evento importante.'
  }
];

export function ManualTab() {
  return (
    <div className="space-y-8 animate-fade-in">
      <section className="relative overflow-hidden rounded-[2rem] border border-surface-800 bg-[#081116] px-6 py-8 shadow-2xl sm:px-10 sm:py-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.12),_transparent_30%),radial-gradient(circle_at_bottom_left,_rgba(249,115,22,0.12),_transparent_28%)]" />
        <div className="relative grid gap-8 lg:grid-cols-[1.35fr_0.95fr] lg:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-200">
              <Sparkles className="h-3.5 w-3.5" />
              Manual pratico
            </div>
            <h2 className="mt-5 max-w-3xl text-3xl font-black tracking-tight text-white sm:text-4xl">
              Use o SaldoPro como uma central financeira conversacional.
            </h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
              O objetivo do produto e reduzir atrito: voce registra, consulta e organiza sua vida financeira
              pelo WhatsApp, e usa o painel web para revisar, aprofundar e manter tudo sob controle.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                'Registros em texto, audio e imagem',
                'Leitura de comprovantes e cupons',
                'Salvamento e reenvio de imagens, PDF e ZIP',
                'Lembretes e metas com revisao completa no painel'
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  <p className="text-sm text-slate-200">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-white/8 bg-[#0d171c]/95 p-5 shadow-xl">
            <div className="flex items-center gap-3 border-b border-white/6 pb-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-300">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Fluxo ideal</p>
                <p className="text-xs text-slate-400">Como tirar mais valor da IA</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {quickStartSteps.map((step) => (
                <div key={step.number} className="flex gap-4 rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#13232b] text-sm font-bold text-emerald-300">
                    {step.number}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{step.title}</p>
                    <p className="mt-1 text-xs leading-6 text-slate-400">{step.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-surface-800 bg-[#0b1318] p-6 shadow-2xl sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Entradas aceitas</p>
            <h3 className="mt-2 text-2xl font-bold text-white">Tudo o que voce pode mandar no WhatsApp</h3>
          </div>
          <p className="max-w-xl text-sm leading-6 text-slate-400">
            O sistema foi desenhado para capturar contexto. Quanto mais natural sua mensagem, melhor o resultado.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {whatsappInputs.map((item) => {
            const IconComponent = item.icon;
            return (
              <div
                key={item.title}
                className={`rounded-[1.5rem] border border-white/8 bg-gradient-to-br ${item.accent} p-5 shadow-lg`}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black/20">
                  <IconComponent className={`h-5 w-5 ${item.iconColor}`} />
                </div>
                <h4 className="mt-4 text-base font-semibold text-white">{item.title}</h4>
                <p className="mt-3 min-h-[52px] text-sm leading-6 text-slate-200">{item.example}</p>
                <div className="mt-4 rounded-2xl border border-black/10 bg-black/15 px-3 py-3">
                  <p className="text-xs leading-5 text-slate-300">{item.result}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-[2rem] border border-surface-800 bg-[#081116] p-6 shadow-2xl sm:p-8">
        <div className="grid gap-5 lg:grid-cols-3">
          {playbooks.map((playbook) => (
            <div key={playbook.title} className="rounded-[1.6rem] border border-white/8 bg-[#0d171c] p-5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-orange-300">
                <Receipt className="h-4 w-4" />
                Caso de uso
              </div>
              <h3 className="mt-4 text-xl font-bold text-white">{playbook.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-400">{playbook.summary}</p>

              <div className="mt-4 space-y-2">
                {playbook.bullets.map((bullet) => (
                  <div key={bullet} className="flex gap-3 text-sm text-slate-300">
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-orange-300" />
                    <span>{bullet}</span>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300">Voce diz</p>
                <p className="mt-2 text-sm italic text-slate-200">{playbook.sampleUser}</p>
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-300">O sistema faz</p>
                <p className="mt-2 text-sm text-slate-300">{playbook.sampleAi}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[2rem] border border-surface-800 bg-[#0d1118] p-6 shadow-2xl sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">Automacoes no WhatsApp</p>
            <h3 className="mt-2 text-2xl font-bold text-white">O que a IA faz alem de registrar gastos</h3>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-400">
            O fluxo conversa com suas tarefas do dia a dia: lembrar, guardar, reenviar e organizar informacoes importantes sem sair do chat.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {automationCards.map((card) => {
            const IconComponent = card.icon;
            return (
              <div key={card.title} className={`rounded-[1.5rem] border ${card.border} ${card.bg} p-5`}>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black/15">
                  <IconComponent className={`h-5 w-5 ${card.color}`} />
                </div>
                <h4 className="mt-4 text-lg font-semibold text-white">{card.title}</h4>
                <div className="mt-4 space-y-2">
                  {card.bullets.map((bullet) => (
                    <div key={bullet} className="flex gap-3 text-sm text-slate-300">
                      <ArrowRight className={`mt-0.5 h-4 w-4 shrink-0 ${card.color}`} />
                      <span>{bullet}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-surface-800 bg-[#0b1318] p-6 shadow-2xl sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-300">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-white">Como a area web complementa o WhatsApp</h3>
              <p className="mt-1 text-sm text-slate-400">Velocidade no chat, profundidade no painel.</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {panelModules.map((module) => {
              const IconComponent = module.icon;
              return (
                <div key={module.title} className="rounded-[1.4rem] border border-white/8 bg-[#101b21] p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.04]">
                    <IconComponent className="h-5 w-5 text-cyan-300" />
                  </div>
                  <h4 className="mt-4 text-base font-semibold text-white">{module.title}</h4>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{module.text}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[2rem] border border-surface-800 bg-[#101017] p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-300">
                <Undo2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Recuperacao rapida</h3>
                <p className="text-sm text-slate-400">Corrija sem sair da conversa.</p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {['desfazer', 'cancela', 'errei'].map((word) => (
                <div key={word} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                  <span className="rounded-lg bg-[#1c2630] px-2 py-1 font-mono text-xs text-white">{word}</span>
                </div>
              ))}
            </div>

            <p className="mt-4 text-sm leading-6 text-slate-400">
              Se a IA interpretar algo errado, use uma dessas palavras e continue a conversa com a correacao certa.
            </p>
          </div>

          <div className="rounded-[2rem] border border-surface-800 bg-[#12150f] p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-lime-500/10 text-lime-300">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Autorizacao e seguranca</h3>
                <p className="text-sm text-slate-400">Controle quem pode acionar sua IA.</p>
              </div>
            </div>

            <div className="mt-5 space-y-3 text-sm text-slate-300">
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                Apenas numeros autorizados na aba Ajustes recebem resposta automatica.
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                Isso reduz ruído, protege seu fluxo e evita uso por terceiros.
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                O painel continua sendo seu ponto de revisao e auditoria.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-surface-800 bg-[#0b1318] p-6 shadow-2xl sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300">Perguntas frequentes</p>
            <h3 className="mt-2 text-2xl font-bold text-white">Duvidas comuns no uso diario</h3>
          </div>
          <p className="max-w-xl text-sm leading-6 text-slate-400">
            Se voce seguir estes pontos, a experiencia tende a ficar mais rapida, previsivel e consistente.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {faqItems.map((item) => (
            <div key={item.question} className="rounded-[1.4rem] border border-white/8 bg-[#101b21] p-5">
              <p className="text-base font-semibold text-white">{item.question}</p>
              <p className="mt-3 text-sm leading-6 text-slate-400">{item.answer}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
