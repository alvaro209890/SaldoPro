import {
  Archive,
  ArrowRight,
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
    text: 'Na aba Ajustes, escolha quais numeros podem falar com a IA. Assim, so as pessoas certas conseguem usar seu atendimento no WhatsApp.'
  },
  {
    number: '02',
    title: 'Fale do seu jeito',
    text: 'Nao precisa decorar comandos. Escreva ou mande audio como voce falaria no dia a dia: a IA entende pedidos simples e diretos.'
  },
  {
    number: '03',
    title: 'Revise quando quiser',
    text: 'Tudo o que a IA registrar pode ser acompanhado, corrigido e organizado no painel, incluindo transacoes, arquivos, lembretes e metas.'
  }
];

const whatsappInputs = [
  {
    icon: MessageSquare,
    title: 'Texto livre',
    accent: 'from-emerald-500/20 to-emerald-500/5',
    iconColor: 'text-emerald-300',
    example: 'Paguei 68 no almoco e 12 no estacionamento.',
    result: 'A IA separa, classifica e registra cada movimentacao sem voce precisar preencher campos.'
  },
  {
    icon: Mic,
    title: 'Audio',
    accent: 'from-sky-500/20 to-sky-500/5',
    iconColor: 'text-sky-300',
    example: 'Recebi 350 de um freela hoje cedo.',
    result: 'O audio vira texto e segue o mesmo fluxo de registro, consulta, lembrete ou organizacao.'
  },
  {
    icon: ImageIcon,
    title: 'Imagem',
    accent: 'from-amber-500/20 to-amber-500/5',
    iconColor: 'text-amber-300',
    example: 'Foto de comprovante, boleto, recibo, contrato ou print importante.',
    result: 'A IA pode ler comprovantes e boletos. Se nao for algo financeiro, a imagem tambem pode ser guardada para consulta futura.'
  },
  {
    icon: FileText,
    title: 'PDF',
    accent: 'from-rose-500/20 to-rose-500/5',
    iconColor: 'text-rose-300',
    example: 'Envie um PDF com um texto dizendo o que e aquele arquivo.',
    result: 'Se voce mandar um nome junto, ele vira o titulo. Se nao mandar, a IA pede o nome antes de guardar.'
  },
  {
    icon: Archive,
    title: 'ZIP',
    accent: 'from-orange-500/20 to-orange-500/5',
    iconColor: 'text-orange-300',
    example: 'Envie um .zip para guardar materiais ou arquivos compactados.',
    result: 'Funciona como os outros arquivos: com nome fica pronto mais rapido; sem nome, a IA pede um titulo.'
  }
];

const playbooks = [
  {
    title: 'Registrar gastos e receitas',
    summary: 'O fluxo principal do SaldoPro. A IA entende valor, contexto e tipo de movimentacao com pouca friccao.',
    bullets: [
      'Pode registrar varias movimentacoes na mesma mensagem.',
      'Entende expressoes como "agora", "ontem", "hoje cedo" e "mais tarde".',
      'Serve para despesa, receita e ajustes simples do dia a dia.'
    ],
    sampleUser: '"Gastei 42 no mercado, 18 na farmacia e recebi 600 de um cliente."',
    sampleAi: 'A IA cria os lancamentos separados e escolhe a melhor categoria disponivel.'
  },
  {
    title: 'Consultar sua situacao financeira',
    summary: 'Voce pode pedir saldo, panorama do mes, revisar registros recentes e ate perguntar se esta gastando demais.',
    bullets: [
      'Pergunte sobre o mes atual ou um periodo especifico.',
      'Peca resumo de receitas, despesas e saldo restante.',
      'Use isso para decidir se pode gastar ou se precisa frear.'
    ],
    sampleUser: '"Como esta meu mes? Quanto ainda posso gastar?"',
    sampleAi: 'A IA resume entradas, saidas, saldo e traduz isso em uma resposta objetiva.'
  },
  {
    title: 'Criar contas recorrentes',
    summary: 'Gastos e receitas que se repetem podem virar compromissos recorrentes para voce nao registrar tudo de novo.',
    bullets: [
      'Funciona para aluguel, salario, assinaturas, parcelas e contas fixas.',
      'Voce pode falar "todo mes", "mensal", "toda semana" ou "todo ano".',
      'Isso ajuda a manter previsibilidade e evita esquecimentos.'
    ],
    sampleUser: '"Pago 1200 de aluguel todo mes no dia 5."',
    sampleAi: 'A IA entende que isso se repete e deixa esse compromisso muito mais facil de acompanhar.'
  },
  {
    title: 'Guardar documentos',
    summary: 'O WhatsApp tambem funciona como um lugar rapido para guardar comprovantes, contratos, recibos e materiais importantes.',
    bullets: [
      'Imagens podem ser lidas como comprovantes e tambem guardadas.',
      'PDF e ZIP entram no mesmo fluxo de organizacao de arquivos.',
      'Quando voce manda um nome junto, o arquivo fica muito mais facil de achar depois.',
      'Depois, voce pode pedir o arquivo salvo de volta no proprio WhatsApp.'
    ],
    sampleUser: '"Contrato social 2026" + envio do PDF',
    sampleAi: 'O arquivo e salvo com esse titulo e fica disponivel na area de documentos.'
  },
  {
    title: 'Criar lembretes por texto ou audio',
    summary: 'Voce pode usar a IA para marcar compromissos, contas, cobrancas e alertas sem abrir formularios.',
    bullets: [
      'Funciona para lembretes gerais, contas a pagar e contas a receber.',
      'Pode ser criado por texto ou por audio no WhatsApp.',
      'A IA entende vencimento, valor, titulo e tipo do lembrete.',
      'Quando chegar a hora, o aviso volta para voce no WhatsApp.'
    ],
    sampleUser: '"Me lembra amanha as 9h de pagar a conta de luz de 186 reais."',
    sampleAi: 'A IA cria o lembrete com valor, data, tipo e te avisa no horario programado.'
  },
  {
    title: 'Editar, corrigir e desfazer',
    summary: 'Se algo sair errado, voce nao precisa abrir o painel na mesma hora. Da para corrigir no proprio WhatsApp.',
    bullets: [
      'Voce pode pedir para alterar valor, descricao, data ou categoria.',
      'Palavras como "desfazer", "cancela" e "errei" ajudam a voltar a ultima acao.',
      'Tambem da para concluir lembretes, reabrir e apagar quando necessario.',
      'O painel continua disponivel para revisoes mais detalhadas.'
    ],
    sampleUser: '"Errei, corrige esse valor para 89."',
    sampleAi: 'A IA ajusta o que for possivel e te confirma o que foi alterado.'
  },
  {
    title: 'Pedir arquivos salvos de volta',
    summary: 'Voce pode recuperar imagens e documentos que ja guardou sem precisar procurar manualmente no painel.',
    bullets: [
      'Peca o arquivo pelo nome, assunto ou pelo contexto em que ele foi salvo.',
      'A IA procura entre os seus arquivos recentes e tenta achar o melhor resultado.',
      'Se houver duvida, ela pode te mostrar as opcoes para voce escolher.',
      'Depois disso, ela envia o arquivo de volta no WhatsApp.'
    ],
    sampleUser: '"Me manda de novo aquele comprovante do pix da oficina."',
    sampleAi: 'A IA procura o documento salvo mais relevante e devolve o arquivo no chat.'
  },
  {
    title: 'Acompanhar metas pelo WhatsApp',
    summary: 'As metas criadas no painel tambem podem ser consultadas e movimentadas no WhatsApp.',
    bullets: [
      'Voce pode pedir andamento, quanto falta, prioridade e prazo.',
      'Tambem da para atualizar progresso, concluir, pausar, reativar e ajustar dados.',
      'A IA usa o que ja esta cadastrado para responder com mais contexto.',
      'Isso ajuda a manter suas metas vivas no dia a dia.'
    ],
    sampleUser: '"Como estao minhas metas? Atualiza a reserva para 2 mil."',
    sampleAi: 'A IA explica o progresso, mostra o que falta e, se voce pedir, ajusta a meta.'
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
      'O aviso retorna no WhatsApp, deixando o acompanhamento mais pratico e dificil de esquecer.'
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
      'A IA interpreta prazo, valor, titulo e tipo do lembrete sem voce precisar abrir formularios.'
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
      'Isso vale para imagens, PDFs e outros arquivos que voce ja guardou.',
      'Sua conversa vira tambem um jeito rapido de consultar seus arquivos.'
    ]
  },
  {
    icon: Target,
    title: 'Metas e objetivos',
    color: 'text-fuchsia-300',
    bg: 'bg-fuchsia-500/10',
    border: 'border-fuchsia-400/15',
    bullets: [
      'A aba de Metas ajuda a transformar planos em objetivos com acompanhamento real.',
      'Voce pode organizar metas ativas, concluidas e pausadas.',
      'A IA tambem pode comentar andamento e te ajudar a manter foco no que importa.'
    ]
  }
];

const panelModules = [
  {
    icon: BarChart3,
    title: 'Dashboard',
    text: 'Visao rapida do seu momento financeiro, com leitura de saldo, ritmo de gastos e principais sinais do mes.'
  },
  {
    icon: Receipt,
    title: 'Transacoes',
    text: 'Lugar ideal para revisar, editar, excluir e conferir com calma tudo o que foi registrado no WhatsApp.'
  },
  {
    icon: FolderOpen,
    title: 'Documentos',
    text: 'Central para revisar, baixar e organizar imagens, PDFs e outros arquivos que voce guardou.'
  },
  {
    icon: BellRing,
    title: 'Lembretes',
    text: 'Controle de vencimentos, pagamentos, recebimentos e alertas gerais. Voce cria no WhatsApp e acompanha aqui.'
  },
  {
    icon: Target,
    title: 'Metas',
    text: 'Espaco para criar, acompanhar e revisar objetivos financeiros de curto e longo prazo.'
  }
];

const everydayCommands = [
  {
    title: 'Corrigir algo que saiu errado',
    example: '"Errei, desfaz isso" ou "corrige para 79 reais".',
    explanation: 'Use quando um lancamento, lembrete ou ajuste for registrado de forma errada e voce quiser agir na hora.'
  },
  {
    title: 'Marcar uma conta para depois',
    example: '"Me lembra dia 10 de pagar o aluguel."',
    explanation: 'Ideal para nao esquecer vencimentos e pagamentos recorrentes do dia a dia.'
  },
  {
    title: 'Trazer um arquivo de volta',
    example: '"Me manda o PDF do contrato que eu salvei."',
    explanation: 'Serve para buscar imagens, PDFs e outros arquivos que voce ja guardou pelo chat.'
  },
  {
    title: 'Consultar metas e progresso',
    example: '"Quanto falta para minha meta de reserva?"',
    explanation: 'A IA explica seu andamento e pode te ajudar a atualizar o progresso ou reorganizar prioridades.'
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
    answer: 'Use o WhatsApp para velocidade e praticidade. Use o painel para revisar historico, corrigir com calma, consultar relatorios, organizar arquivos, administrar lembretes e acompanhar metas.'
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
  },
  {
    question: 'Posso registrar algo recorrente, como aluguel ou salario?',
    answer: 'Sim. Se voce falar que algo acontece todo mes, toda semana ou todo ano, a IA pode tratar isso como um compromisso recorrente.'
  },
  {
    question: 'Posso acompanhar metas sem abrir a aba de metas toda hora?',
    answer: 'Sim. Voce pode perguntar pelo WhatsApp como suas metas estao, quanto falta para atingir cada uma e ate pedir ajustes no progresso.'
  }
];

export function ManualTab() {
  return (
    <div className="space-y-8 animate-fade-in">
      <section className="relative overflow-hidden rounded-[1.5rem] border border-surface-800 bg-[#081116] px-4 py-6 shadow-2xl sm:rounded-[2rem] sm:px-10 sm:py-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.12),_transparent_30%),radial-gradient(circle_at_bottom_left,_rgba(249,115,22,0.12),_transparent_28%)]" />
        <div className="relative grid gap-6 sm:gap-8 lg:grid-cols-[1.35fr_0.95fr] lg:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-200">
              <Sparkles className="h-3.5 w-3.5" />
              Manual pratico
            </div>
            <h2 className="mt-5 max-w-3xl text-2xl font-black tracking-tight text-white sm:text-4xl">
              Use o SaldoPro como uma central financeira no WhatsApp.
            </h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
              A ideia e simples: voce resolve o que precisa pelo WhatsApp com rapidez e usa o painel
              quando quiser revisar, organizar melhor e enxergar o quadro completo.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                'Registros em texto, audio e imagem',
                'Leitura de comprovantes e cupons',
                'Salvamento e reenvio de imagens, PDF e ZIP',
                'Lembretes, recorrencias e metas com revisao completa'
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

          <div className="rounded-[1.25rem] border border-white/8 bg-[#0d171c]/95 p-4 shadow-xl sm:rounded-[1.75rem] sm:p-5">
            <div className="flex items-center gap-3 border-b border-white/6 pb-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-300">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Fluxo ideal</p>
                <p className="text-xs text-slate-400">Como aproveitar melhor no dia a dia</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {quickStartSteps.map((step) => (
                <div key={step.number} className="flex flex-col gap-3 rounded-2xl border border-white/6 bg-white/[0.03] p-4 sm:flex-row sm:gap-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#13232b] text-sm font-bold text-emerald-300 sm:h-10 sm:w-10">
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

      <section className="rounded-[1.5rem] border border-surface-800 bg-[#0b1318] p-4 shadow-2xl sm:rounded-[2rem] sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Entradas aceitas</p>
            <h3 className="mt-2 text-xl font-bold text-white sm:text-2xl">Tudo o que voce pode mandar no WhatsApp</h3>
          </div>
          <p className="max-w-xl text-sm leading-6 text-slate-400">
            Quanto mais natural for sua mensagem, mais facil fica para a IA entender o que voce quer fazer.
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {whatsappInputs.map((item) => {
            const IconComponent = item.icon;
            return (
              <div
                key={item.title}
                className={`rounded-[1.25rem] border border-white/8 bg-gradient-to-br ${item.accent} p-4 shadow-lg sm:rounded-[1.5rem] sm:p-5`}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black/20">
                  <IconComponent className={`h-5 w-5 ${item.iconColor}`} />
                </div>
                <h4 className="mt-4 text-base font-semibold text-white">{item.title}</h4>
                <p className="mt-3 text-sm leading-6 text-slate-200 sm:min-h-[52px]">{item.example}</p>
                <div className="mt-4 rounded-2xl border border-black/10 bg-black/15 px-3 py-3">
                  <p className="text-xs leading-5 text-slate-300">{item.result}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-surface-800 bg-[#081116] p-4 shadow-2xl sm:rounded-[2rem] sm:p-8">
        <div className="grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
          {playbooks.map((playbook) => (
            <div key={playbook.title} className="rounded-3xl border border-white/8 bg-[#0d171c] p-4 sm:rounded-[1.6rem] sm:p-5">
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

      <section className="rounded-[1.5rem] border border-surface-800 bg-[#0d1118] p-4 shadow-2xl sm:rounded-[2rem] sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">Automacoes no WhatsApp</p>
            <h3 className="mt-2 text-xl font-bold text-white sm:text-2xl">O que a IA faz alem de registrar gastos</h3>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-400">
            O WhatsApp nao serve so para registrar gasto. Ele tambem pode te ajudar a lembrar, guardar, reenviar e acompanhar o que importa.
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {automationCards.map((card) => {
            const IconComponent = card.icon;
            return (
              <div key={card.title} className={`rounded-[1.25rem] border ${card.border} ${card.bg} p-4 sm:rounded-[1.5rem] sm:p-5`}>
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

      <section className="rounded-[1.5rem] border border-surface-800 bg-[#11131a] p-4 shadow-2xl sm:rounded-[2rem] sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Atalhos do dia a dia</p>
            <h3 className="mt-2 text-xl font-bold text-white sm:text-2xl">Pedidos que muita gente usa com frequencia</h3>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-400">
            Estes exemplos ajudam a entender como a IA pode te acompanhar alem do basico.
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {everydayCommands.map((item) => (
            <div key={item.title} className="rounded-3xl border border-white/8 bg-[#101b21] p-4 sm:rounded-[1.4rem] sm:p-5">
              <p className="text-base font-semibold text-white">{item.title}</p>
              <div className="mt-3 rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Exemplo</p>
                <p className="mt-2 text-sm italic text-slate-200">{item.example}</p>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-400">{item.explanation}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[1.5rem] border border-surface-800 bg-[#0b1318] p-4 shadow-2xl sm:rounded-[2rem] sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-300">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white sm:text-2xl">Como a area web complementa o WhatsApp</h3>
              <p className="mt-1 text-sm text-slate-400">Velocidade no chat, profundidade no painel.</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {panelModules.map((module) => {
              const IconComponent = module.icon;
              return (
                <div key={module.title} className="rounded-3xl border border-white/8 bg-[#101b21] p-4 sm:rounded-[1.4rem] sm:p-5">
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
          <div className="rounded-[1.5rem] border border-surface-800 bg-[#101017] p-4 shadow-2xl sm:rounded-[2rem] sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-300">
                <Undo2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white sm:text-xl">Recuperacao rapida</h3>
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
              Se a IA interpretar algo errado, use uma dessas palavras e continue a conversa com a correcao certa.
            </p>
          </div>

          <div className="rounded-[1.5rem] border border-surface-800 bg-[#12150f] p-4 shadow-2xl sm:rounded-[2rem] sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-lime-500/10 text-lime-300">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white sm:text-xl">Autorizacao e seguranca</h3>
                <p className="text-sm text-slate-400">Controle quem pode acionar sua IA.</p>
              </div>
            </div>

            <div className="mt-5 space-y-3 text-sm text-slate-300">
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                Apenas numeros autorizados na aba Ajustes recebem resposta automatica.
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                Isso reduz ruido, protege seu fluxo e evita uso por terceiros.
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                O painel continua sendo seu ponto de revisao, organizacao e controle final.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-surface-800 bg-[#0b1318] p-4 shadow-2xl sm:rounded-[2rem] sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300">Perguntas frequentes</p>
            <h3 className="mt-2 text-xl font-bold text-white sm:text-2xl">Duvidas comuns no uso diario</h3>
          </div>
          <p className="max-w-xl text-sm leading-6 text-slate-400">
            Quanto mais claro o seu pedido, mais rapida e natural tende a ficar a experiencia.
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {faqItems.map((item) => (
            <div key={item.question} className="rounded-3xl border border-white/8 bg-[#101b21] p-4 sm:rounded-[1.4rem] sm:p-5">
              <p className="text-base font-semibold text-white">{item.question}</p>
              <p className="mt-3 text-sm leading-6 text-slate-400">{item.answer}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
