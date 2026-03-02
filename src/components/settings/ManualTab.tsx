import { MessageSquare, Mic, DollarSign, Image as ImageIcon, Zap, Calendar, TrendingUp, Settings as SettingsIcon } from 'lucide-react';

export function ManualTab() {
    return (
        <div className="space-y-8 animate-fade-in">
            {/* Intro */}
            <section className="relative overflow-hidden rounded-3xl border border-surface-800 bg-[#0c1216] shadow-2xl p-6 sm:p-10">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
                <h2 className="text-2xl font-bold text-white mb-4 relative z-10">Manual do Usuário - SaldoPro</h2>
                <p className="text-gray-400 leading-relaxed relative z-10 max-w-4xl">
                    Bem-vindo! O SaldoPro foi criado para simplificar o seu acompanhamento financeiro diário.
                    Nossa principal inovação é a integração direta com o WhatsApp, permitindo que você organize
                    suas finanças apenas conversando com uma Inteligência Artificial avançada, de forma natural,
                    sem precisar iniciar o app para cada gasto de rotina.
                </p>
            </section>

            {/* Integração WhatsApp - FOCO PRINCIPAL */}
            <section className="relative overflow-hidden rounded-3xl border border-indigo-500/30 bg-gradient-to-br from-[#0c1216] to-indigo-950/20 shadow-2xl shadow-indigo-500/10 p-6 sm:p-10">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                        <MessageSquare className="w-6 h-6 text-green-400" />
                    </div>
                    <h2 className="text-2xl font-bold text-white">O Poder da IA no WhatsApp</h2>
                </div>
                <p className="text-gray-300 mb-8 max-w-3xl">
                    Sua secretária financeira particular funciona 24 horas por dia. O assistente de Inteligência Artificial processa
                    texto, transcrições de áudio e até imagens de recibos, identificando valores e categorizando tudo no piloto automático.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-[#0a0f12]/80 backdrop-blur-sm p-6 rounded-2xl border border-surface-800/80 hover:border-indigo-500/50 transition-colors shadow-lg">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                                <Zap className="w-5 h-5 text-indigo-400" />
                            </div>
                            <h3 className="font-semibold text-gray-100">Registros Ágeis via Texto</h3>
                        </div>
                        <p className="text-sm text-gray-400 mb-4 h-14">
                            Sem comandos robóticos. Fale naturalmente e a IA deduz o valor, a ação e a categoria certa.
                        </p>
                        <div className="bg-[#0c1216] flex flex-col justify-between rounded-xl p-4 border border-surface-800 text-sm h-36">
                            <div>
                                <p className="text-green-400 font-medium mb-1">Você diz:</p>
                                <p className="text-gray-300 mb-3 italic">"Gastei 45 reais na padaria agora"</p>
                            </div>
                            <div>
                                <p className="text-indigo-400 font-medium mb-1">A IA faz:</p>
                                <p className="text-gray-300">Nova despesa "Padaria", R$ 45,00 na categoria Alimentação.</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-[#0a0f12]/80 backdrop-blur-sm p-6 rounded-2xl border border-surface-800/80 hover:border-indigo-500/50 transition-colors shadow-lg">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                <Mic className="w-5 h-5 text-blue-400" />
                            </div>
                            <h3 className="font-semibold text-gray-100">Transcrições de Áudios</h3>
                        </div>
                        <p className="text-sm text-gray-400 mb-4 h-14">
                            Sem tempo? Envie um áudio! A IA transcreve seu áudio instantaneamente e processa os dados de forma idêntica ao texto.
                        </p>
                        <div className="bg-[#0c1216] flex flex-col justify-between rounded-xl p-4 border border-surface-800 text-sm h-36">
                            <div>
                                <p className="text-green-400 font-medium mb-1">Você diz (Áudio):</p>
                                <p className="text-gray-300 mb-3 italic">"Comprei 100 de gasolina e paguei 20 no lava-jato junto"</p>
                            </div>
                            <div>
                                <p className="text-indigo-400 font-medium mb-1">A IA faz:</p>
                                <p className="text-gray-300">Separa os gastos: Combustível (R$ 100) e Lavagem (R$ 20).</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-[#0a0f12]/80 backdrop-blur-sm p-6 rounded-2xl border border-surface-800/80 hover:border-indigo-500/50 transition-colors shadow-lg">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                                <DollarSign className="w-5 h-5 text-orange-400" />
                            </div>
                            <h3 className="font-semibold text-gray-100">Consultas e Resumos</h3>
                        </div>
                        <p className="text-sm text-gray-400 mb-4 h-14">
                            Tenha clareza com um pedido simples. Peça para resumir o orçamento, entender gastos pendentes e mais.
                        </p>
                        <div className="bg-[#0c1216] flex flex-col justify-between rounded-xl p-4 border border-surface-800 text-sm h-36">
                            <div>
                                <p className="text-green-400 font-medium mb-1">Você diz:</p>
                                <p className="text-gray-300 mb-3 italic">"Como está meu saldo para o resto do mês?"</p>
                            </div>
                            <div>
                                <p className="text-indigo-400 font-medium mb-1">A IA faz:</p>
                                <p className="text-gray-300">Levanta suas despesas totais, seu orçamento alvo e calcula o saldo diário restante.</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-[#0a0f12]/80 backdrop-blur-sm p-6 rounded-2xl border border-surface-800/80 hover:border-indigo-500/50 transition-colors shadow-lg">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-lg bg-pink-500/10 flex items-center justify-center">
                                <ImageIcon className="w-5 h-5 text-pink-400" />
                            </div>
                            <h3 className="font-semibold text-gray-100">Leitura de Imagens e Recibos</h3>
                        </div>
                        <p className="text-sm text-gray-400 mb-4 h-14">
                            Evite trabalho. Printe notas fiscais, faturas ou envio fotos. A inteligência artificial pode analisar pixels.
                        </p>
                        <div className="bg-[#0c1216] flex flex-col justify-between rounded-xl p-4 border border-surface-800 text-sm h-36">
                            <div>
                                <p className="text-green-400 font-medium mb-1">Você faz:</p>
                                <p className="text-gray-300 mb-3 italic">Envia "Foto de um comprovante no Atacadão no valor de R$ 345,90"</p>
                            </div>
                            <div>
                                <p className="text-indigo-400 font-medium mb-1">A IA faz:</p>
                                <p className="text-gray-300">Reconhece os números na imagem, solicita apenas um título e conclui o registro do total.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-8 bg-indigo-500/5 rounded-2xl p-6 border border-indigo-500/20 shadow-inner">
                    <h4 className="flex items-center gap-2 text-indigo-300 font-semibold mb-3">
                        <Zap className="w-4 h-4" /> Dica de Ouro: Desfazer Rápido
                    </h4>
                    <p className="text-sm text-gray-400 leading-relaxed">
                        Se você disser uma informação incorreta ou simplesmente não gostou de como a IA estruturou o registro, não é preciso abrir o aplicativo web para arrumar ou deletar! Simplesmente envie palavras-chave como <span className="text-white bg-surface-800/80 px-2 py-0.5 rounded font-mono text-xs">desfazer</span>, <span className="text-white bg-surface-800/80 px-2 py-0.5 rounded font-mono text-xs">cancela</span> ou <span className="text-white bg-surface-800/80 px-2 py-0.5 rounded font-mono text-xs">errei</span>. A IA reverterá sua última ação instantaneamente e aguardará as novas instruções.
                    </p>
                </div>
            </section>

            {/* Funcionalidades do Painel Web */}
            <section className="relative overflow-hidden rounded-3xl border border-surface-800 bg-[#0c1216] shadow-2xl p-6 sm:p-10 mb-8">
                <h2 className="text-xl font-semibold text-white mb-6">Módulos do Painel Web</h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="p-5 bg-[#0f1419] rounded-2xl border border-surface-800/50 hover:bg-[#151b22] transition-colors cursor-default">
                        <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center mb-4">
                            <TrendingUp className="w-5 h-5 text-teal-400" />
                        </div>
                        <h3 className="text-gray-200 font-medium mb-2">Visão Geral (Dashboard)</h3>
                        <p className="text-sm text-gray-500">Acompanhe gráficos visuais fáceis de entender. Mostramos seu orçamento total vs gastos efetuados, além do seu volume livre diário.</p>
                    </div>

                    <div className="p-5 bg-[#0f1419] rounded-2xl border border-surface-800/50 hover:bg-[#151b22] transition-colors cursor-default">
                        <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center mb-4">
                            <Calendar className="w-5 h-5 text-purple-400" />
                        </div>
                        <h3 className="text-gray-200 font-medium mb-2">Transações</h3>
                        <p className="text-sm text-gray-500">Listagem, filtros inteligentes de despesas e receitas, com ferramentas para excluir entradas antigas e refinar manualmente lançamentos duvidosos.</p>
                    </div>

                    <div className="p-5 bg-[#0f1419] rounded-2xl border border-surface-800/50 hover:bg-[#151b22] transition-colors cursor-default">
                        <div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center mb-4">
                            <SettingsIcon className="w-5 h-5 text-yellow-400" />
                        </div>
                        <h3 className="text-gray-200 font-medium mb-2">Autorização Segura</h3>
                        <p className="text-sm text-gray-500">Para garantir o absoluto sigilo dos seus dados de IA, apenas os números liberados nos Ajustes por você receberão processamento do bot do WhatsApp.</p>
                    </div>
                </div>
            </section>
        </div>
    );
}
