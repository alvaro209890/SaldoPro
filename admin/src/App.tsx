import { useEffect, useState, useMemo, type FormEvent } from 'react';
import { BACKEND_URL } from './config';
import { LineChart, Line, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { format, parseISO, startOfMonth, subMonths, isAfter } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/* ───── Storage ───── */
const STORAGE_KEY = 'saldopro_admin_token';
function readStoredToken() { return typeof window === 'undefined' ? '' : window.localStorage.getItem(STORAGE_KEY)?.trim() ?? ''; }
function persistToken(t: string) { if (typeof window === 'undefined') return; t ? window.localStorage.setItem(STORAGE_KEY, t) : window.localStorage.removeItem(STORAGE_KEY); }

/* ───── Types ───── */
interface SlotStatus { slotId: string; connected: boolean; state: string; phone: string | null; lastDisconnectReason: string | null; }
interface QrSlot { available: boolean; qrPngBase64?: string; expiresInSec?: number; reason?: string; }
interface LogEntry { timestamp: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string; meta?: Record<string, unknown>; }
interface Settings { budget: number; startDay: number; currency: string; whatsappAllowedNumbers: string[]; updatedAt: string | null; }
interface User {
  uid: string; email: string | null; displayName: string; createdAt: string | null; blocked: boolean;
  firebaseExists: boolean; whatsappAllowedNumbers: string[]; settings: Settings | null;
  metrics: { transactions: number; reminders: number; categories: number; whatsappMessages: number; lastWhatsAppMessageAt: string | null; };
  firebase: { disabled: boolean; createdAt: string | null; lastSignInAt: string | null; };
}
interface Overview {
  backend: { ok: boolean; uptime: number; timestamp: string; alerts: { warnings15m: number; errors15m: number; recent: LogEntry[]; }; };
  whatsapp: { slots: SlotStatus[]; qr: Record<string, QrSlot>; recentEvents: LogEntry[]; };
  stats: { totalUsers: number; blockedUsers: number; activeUsers: number; };
}
interface TxItem { id: string; type: 'income' | 'expense'; amount: number; date: string; description: string; paymentMethod: string; category: string; }
interface ReminderItem { id: string; reminderKind: string; title: string; amount: number | null; dueDate: string; status: string; }
interface ChatMsg { role: 'user' | 'assistant'; content: string; }
type Tab = 'overview' | 'operations' | 'users';

/* ───── Helpers ───── */
function fmtDate(v: string | null) {
  if (!v) return '—'; const p = Date.parse(v);
  return Number.isFinite(p) ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(p)) : v;
}
function fmtUptime(s: number) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}h ${m}m`; }
function fmtCurrency(v: number, c = 'BRL') { return c === 'BRL' ? `R$ ${v.toFixed(2).replace('.', ',')}` : `${c} ${v.toFixed(2)}`; }
function isInactive(v: string | null) { if (!v) return true; const p = Date.parse(v); return !Number.isFinite(p) || p < Date.now() - 7 * 86400000; }
async function parseErr(r: Response) { const p = await r.json().catch(() => null) as { error?: string } | null; return p?.error || 'Erro inesperado.'; }
async function apiFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BACKEND_URL}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(await parseErr(r));
  return r.json() as Promise<T>;
}

/* ───── Icons (inline SVG) ───── */
const Icon = ({ d, size = 18, cls = '' }: { d: string; size?: number; cls?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cls}><path d={d} /></svg>
);
const IconGrid = () => <Icon d="M3 3h7v7H3zM14 3h7v7H14zM3 14h7v7H3zM14 14h7v7H14z" />;
const IconServer = () => <Icon d="M2 5a2 2 0 012-2h16a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2V5zM2 15a2 2 0 012-2h16a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />;
const IconUsers = () => <Icon d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4-4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />;
const IconLogout = () => <Icon d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />;
const IconRefresh = () => <Icon d="M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 005.64 5.64L1 10M22.99 14.01l-4.64 4.36A9 9 0 013.51 15" />;
const IconChevron = () => <Icon d="m15 18-6-6 6-6" size={16} />;
const IconSend = () => <Icon d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" size={16} />;
const IconPhone = () => <Icon d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />;

/* ───── Stat Card ───── */
function StatCard({ label, value, sub, glow = '' }: { label: string; value: string | number; sub?: string; glow?: string }) {
  return (
    <div className={`card p-5 ${glow}`}>
      <p className="text-xs uppercase tracking-widest text-zinc-500 mb-3">{label}</p>
      <p className="stat-value text-white">{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-2">{sub}</p>}
    </div>
  );
}

/* ───── Event Explanation ───── */
function explainEvent(m: string): string {
  const l = m.toLowerCase();
  if (l.includes('connection opened')) return 'Conexão estabelecida com sucesso.';
  if (l.includes('connection closed')) return 'Conexão caiu. Reconexão automática em breve.';
  if (l.includes('socket initialized')) return 'Serviços de preparação iniciados.';
  if (l.includes('invalid whatsapp session')) return 'Sessão expirada. Novo QR será gerado.';
  if (l.includes('bad mac')) return 'Erro de descriptografia (dessincronização de chaves).';
  if (l.includes('takeover')) return 'Tomada forçada de sessão de outro processo.';
  if (l.includes('lock acquired')) return 'Direitos exclusivos de execução garantidos.';
  if (l.includes('msg_bounce') || l.includes('msg_skip')) return 'Mensagem ignorada (auto-envio ou formato inválido).';
  if (l.includes('msg_buffer')) return 'Mensagem @lid em buffer aguardando resolução.';
  if (l.includes('lid_resolved')) return 'Telefone de origem da mensagem @lid identificado.';
  if (l.includes('transcription failed')) return 'Falha temporária na transcrição de áudio.';
  if (l.includes('ai processing error')) return 'Falha no processamento da IA.';
  return '';
}

/* ════════════════════════════════════════════════════════ */
/*                       MAIN APP                          */
/* ════════════════════════════════════════════════════════ */
export function App() {
  const [token, setToken] = useState(() => readStoredToken());
  const [checking, setChecking] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [pw, setPw] = useState('');
  const [authErr, setAuthErr] = useState('');

  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');

  // Users tab
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'blocked' | 'no_wa' | 'inactive'>('all');
  const [selUid, setSelUid] = useState('');
  const [selUser, setSelUser] = useState<User | null>(null);
  const [txs, setTxs] = useState<TxItem[]>([]);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [detailUid, setDetailUid] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [dm, setDm] = useState('');
  const [dmLoading, setDmLoading] = useState(false);
  const [dmOk, setDmOk] = useState(false);
  const [waAction, setWaAction] = useState<'reset' | 'qr' | ''>('');
  const [blockingUid, setBlockingUid] = useState('');

  /* Session check */
  useEffect(() => {
    if (!token) { setChecking(false); return; }
    let c = false;
    apiFetch<{ ok: boolean }>('/api/admin/auth/session', token)
      .catch(() => { persistToken(''); if (!c) setToken(''); })
      .finally(() => { if (!c) setChecking(false); });
    return () => { c = true; };
  }, [token]);

  /* Load dashboard */
  useEffect(() => {
    if (!token) { setOverview(null); setUsers([]); return; }
    let c = false;
    const load = async (silent = false) => {
      if (!silent) setLoading(true);
      setError('');
      try {
        const [ov, us] = await Promise.all([
          apiFetch<Overview>('/api/admin/overview', token),
          apiFetch<{ users: User[] }>('/api/admin/users', token)
        ]);
        if (c) return;
        setOverview(ov); setUsers(us.users);
      } catch (e) {
        if (c) return;
        const msg = e instanceof Error ? e.message : 'Falha ao carregar.';
        setError(msg);
        if (msg.toLowerCase().includes('session')) { persistToken(''); setToken(''); }
      } finally { if (!c) setLoading(false); }
    };
    void load();
    const iv = setInterval(() => void load(true), 20_000);
    return () => { c = true; clearInterval(iv); };
  }, [token]);

  /* Load user details */
  useEffect(() => {
    if (!token || !selUid) { setSelUser(null); setTxs([]); setReminders([]); return; }
    let c = false;
    apiFetch<{ user: User | null; recentTransactions: TxItem[]; recentReminders: ReminderItem[] }>(`/api/admin/users/${selUid}`, token)
      .then(p => { if (!c && p.user) { setSelUser(p.user); setTxs(p.recentTransactions); setReminders(p.recentReminders); } })
      .catch(() => { });
    return () => { c = true; };
  }, [selUid, token]);

  /* Load messages */
  useEffect(() => {
    if (!detailUid || !token) { setMsgs([]); return; }
    let c = false;
    setMsgsLoading(true); setMsgs([]);
    apiFetch<{ messages: ChatMsg[] }>(`/api/admin/users/${detailUid}/messages`, token)
      .then(p => { if (!c) setMsgs(p.messages); })
      .catch(() => { })
      .finally(() => { if (!c) setMsgsLoading(false); });
    return () => { c = true; };
  }, [detailUid, token]);

  useEffect(() => { setDm(''); setDmOk(false); }, [selUid]);

  /* Actions */
  async function login(e: FormEvent) {
    e.preventDefault(); setAuthLoading(true); setAuthErr('');
    try {
      const r = await fetch(`${BACKEND_URL}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      if (!r.ok) throw new Error(await parseErr(r));
      const p = await r.json() as { token: string }; persistToken(p.token); setToken(p.token); setPw(''); setChecking(false);
    } catch (e) { setAuthErr(e instanceof Error ? e.message : 'Falha.'); }
    finally { setAuthLoading(false); }
  }

  async function logout() {
    if (token) try { await apiFetch('/api/admin/auth/logout', token, { method: 'POST' }); } catch { }
    persistToken(''); setToken(''); setOverview(null); setUsers([]);
  }

  async function refresh() {
    if (!token) return; setLoading(true); setError('');
    try {
      const [ov, us] = await Promise.all([apiFetch<Overview>('/api/admin/overview', token), apiFetch<{ users: User[] }>('/api/admin/users', token)]);
      setOverview(ov); setUsers(us.users);
      if (selUid) {
        const d = await apiFetch<{ user: User | null; recentTransactions: TxItem[]; recentReminders: ReminderItem[] }>(`/api/admin/users/${selUid}`, token);
        if (d.user) { setSelUser(d.user); setTxs(d.recentTransactions); setReminders(d.recentReminders); }
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha.'); }
    finally { setLoading(false); }
  }

  async function toggleBlock(u: User) {
    if (!token) return; setBlockingUid(u.uid);
    try { await apiFetch(`/api/admin/users/${u.uid}/${u.blocked ? 'unblock' : 'block'}`, token, { method: 'POST', body: JSON.stringify({ reason: u.blocked ? null : 'Admin' }) }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha.'); }
    finally { setBlockingUid(''); }
  }

  async function waAct(act: 'reset' | 'qr') {
    if (!token) return; setWaAction(act);
    try {
      const p = await apiFetch<{ slots: SlotStatus[]; qr: Record<string, QrSlot> }>(act === 'reset' ? '/api/admin/whatsapp/reset-session' : '/api/admin/whatsapp/refresh-qr', token, { method: 'POST' });
      setOverview(c => c ? { ...c, whatsapp: { ...c.whatsapp, slots: p.slots, qr: p.qr } } : c);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha.'); }
    finally { setWaAction(''); }
  }

  async function sendDm(e: FormEvent) {
    e.preventDefault(); const uid = detailUid ?? selUid; const txt = dm.trim();
    if (!token || !uid || !txt) return; setDmLoading(true); setDmOk(false);
    try {
      await apiFetch(`/api/admin/users/${uid}/message`, token, { method: 'POST', body: JSON.stringify({ text: txt }) });
      setDmOk(true); setDm('');
      if (detailUid) setMsgs(c => [...c, { role: 'assistant', content: txt }]);
      setTimeout(() => setDmOk(false), 3000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha.'); }
    finally { setDmLoading(false); }
  }

  /* Derived */
  const slot = overview?.whatsapp.slots[0] ?? null;
  const qr = slot ? overview?.whatsapp.qr[slot.slotId] : null;
  const totalTx = users.reduce((s, u) => s + u.metrics.transactions, 0);
  const totalRem = users.reduce((s, u) => s + u.metrics.reminders, 0);
  const totalWa = users.reduce((s, u) => s + u.metrics.whatsappMessages, 0);
  const latestActivity = users.reduce<string | null>((l, u) => { const c = u.metrics.lastWhatsAppMessageAt; return !c ? l : !l || c > l ? c : l; }, null);

  const filtered = users.filter(u => {
    const t = search.trim().toLowerCase();
    const match = !t || [u.displayName, u.email ?? '', u.uid, ...u.whatsappAllowedNumbers].join(' ').toLowerCase().includes(t);
    if (!match) return false;
    if (filter === 'blocked') return u.blocked;
    if (filter === 'no_wa') return u.whatsappAllowedNumbers.length === 0;
    if (filter === 'inactive') return isInactive(u.metrics.lastWhatsAppMessageAt);
    return true;
  });

  const growth = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => startOfMonth(subMonths(new Date(), 5 - i)));
    const data = months.map(m => ({ name: format(m, 'MMM/yy', { locale: ptBR }), date: m, users: 0 }));
    const min = months[0];
    users.forEach(u => {
      const c = u.createdAt ? parseISO(u.createdAt) : null;
      if (c && (isAfter(c, min) || c.getTime() === min.getTime())) {
        const b = data.find(d => d.date.getTime() === startOfMonth(c).getTime());
        if (b) b.users += 1;
      }
    });
    return data;
  }, [users]);

  /* ───── LOGIN ───── */
  if (checking) return (
    <div className="login-shell flex min-h-screen items-center justify-center">
      <div className="card p-10 text-center max-w-md w-full">
        <p className="text-xs uppercase tracking-[0.4em] text-emerald-300/60">SaldoPro</p>
        <p className="mt-4 text-lg text-white font-semibold">Validando sessão...</p>
      </div>
    </div>
  );

  if (!token) return (
    <div className="login-shell flex min-h-screen items-center justify-center px-4">
      <div className="card p-8 sm:p-10 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-400/10 border border-emerald-400/20 mb-4">
            <span className="text-2xl">💰</span>
          </div>
          <h1 className="text-2xl font-bold text-white">SaldoPro Admin</h1>
          <p className="mt-2 text-sm text-zinc-400">Painel de controle administrativo</p>
        </div>
        <form onSubmit={e => void login(e)} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider" htmlFor="pw">Senha</label>
            <input id="pw" type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-emerald-400/40 transition" placeholder="••••••••" />
          </div>
          {authErr && <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{authErr}</div>}
          <button type="submit" disabled={authLoading}
            className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-black transition hover:bg-emerald-400 disabled:opacity-50">
            {authLoading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );

  /* ───── USER DETAIL PAGE ───── */
  if (detailUid && selUser) return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/6 bg-black/60 backdrop-blur-xl px-6 py-3">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setDetailUid(null)} className="flex items-center gap-2 rounded-lg bg-white/8 px-3 py-2 text-sm text-white hover:bg-white/12 transition">
              <IconChevron /> Voltar
            </button>
            <h1 className="text-lg font-bold text-white">{selUser.displayName || 'Sem Nome'}</h1>
            <span className={selUser.blocked ? 'badge badge-rose' : 'badge badge-green'}>{selUser.blocked ? 'Bloqueado' : 'Ativo'}</span>
          </div>
          <button onClick={() => void toggleBlock(selUser)} disabled={blockingUid === selUser.uid}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${selUser.blocked ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' : 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'}`}>
            {blockingUid === selUser.uid ? '...' : selUser.blocked ? 'Desbloquear' : 'Bloquear'}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6 grid gap-5 lg:grid-cols-3">
        {/* Left: User Info */}
        <div className="space-y-5 lg:col-span-1">
          <div className="card p-5">
            <p className="text-xs uppercase tracking-widest text-zinc-500 mb-4">Informações</p>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-zinc-500">Email</dt><dd className="text-white text-right truncate ml-4">{selUser.email || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">UID</dt><dd className="text-zinc-400 text-right truncate ml-4 text-xs font-mono">{selUser.uid.slice(0, 16)}…</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Cadastro</dt><dd className="text-white">{fmtDate(selUser.createdAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Último login</dt><dd className="text-white">{fmtDate(selUser.firebase.lastSignInAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Última msg</dt><dd className="text-white">{fmtDate(selUser.metrics.lastWhatsAppMessageAt)}</dd></div>
            </dl>
            {selUser.whatsappAllowedNumbers.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/6">
                <p className="text-xs text-zinc-500 mb-2">WhatsApp</p>
                <div className="flex flex-wrap gap-1.5">
                  {selUser.whatsappAllowedNumbers.map(p => <span key={p} className="badge badge-green text-xs">{p}</span>)}
                </div>
              </div>
            )}
          </div>
          <div className="card p-5">
            <p className="text-xs uppercase tracking-widest text-zinc-500 mb-4">Métricas</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { l: 'Transações', v: selUser.metrics.transactions },
                { l: 'Lembretes', v: selUser.metrics.reminders },
                { l: 'Categorias', v: selUser.metrics.categories },
                { l: 'Mensagens', v: selUser.metrics.whatsappMessages }
              ].map(m => (
                <div key={m.l} className="rounded-lg bg-white/4 border border-white/5 p-3">
                  <p className="text-xs text-zinc-500">{m.l}</p>
                  <p className="text-lg font-bold text-white mt-1">{m.v}</p>
                </div>
              ))}
            </div>
          </div>
          {selUser.settings && (
            <div className="card p-5">
              <p className="text-xs uppercase tracking-widest text-zinc-500 mb-4">Configurações</p>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-zinc-500">Moeda</dt><dd className="text-white">{selUser.settings.currency}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Orçamento</dt><dd className="text-white">{selUser.settings.budget > 0 ? fmtCurrency(selUser.settings.budget, selUser.settings.currency) : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Dia início</dt><dd className="text-white">{selUser.settings.startDay}</dd></div>
              </dl>
            </div>
          )}
          {txs.length > 0 && (
            <div className="card p-5">
              <p className="text-xs uppercase tracking-widest text-zinc-500 mb-3">Transações Recentes</p>
              <div className="space-y-2">
                {txs.map(t => (
                  <div key={t.id} className="flex items-center justify-between text-sm py-1.5 border-b border-white/4 last:border-0">
                    <div><p className="text-white">{t.description || '—'}</p><p className="text-xs text-zinc-500">{t.date}</p></div>
                    <span className={t.type === 'income' ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                      {t.type === 'income' ? '+' : '-'}{fmtCurrency(t.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {reminders.length > 0 && (
            <div className="card p-5">
              <p className="text-xs uppercase tracking-widest text-zinc-500 mb-3">Lembretes</p>
              <div className="space-y-2">
                {reminders.map(r => (
                  <div key={r.id} className="flex items-center justify-between text-sm py-1.5 border-b border-white/4 last:border-0">
                    <div><p className="text-white">{r.title}</p><p className="text-xs text-zinc-500">{r.dueDate}</p></div>
                    <span className={r.status === 'paid' ? 'badge badge-green' : 'badge badge-amber'}>{r.status === 'paid' ? 'Pago' : 'Pendente'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Right: Chat */}
        <div className="card flex flex-col lg:col-span-2 overflow-hidden h-[750px]">
          <div className="p-5 border-b border-white/6 bg-white/3">
            <h2 className="text-base font-bold text-white">Histórico do WhatsApp</h2>
            <p className="text-xs text-zinc-500 mt-1">{msgs.length} mensagens carregadas</p>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {msgsLoading ? (
              <div className="flex h-full items-center justify-center text-zinc-500 text-sm">Carregando...</div>
            ) : msgs.length === 0 ? (
              <div className="flex h-full items-center justify-center text-zinc-500 text-sm">Sem histórico.</div>
            ) : msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] p-3.5 text-sm ${m.role === 'user' ? 'chat-bubble-user text-emerald-50' : 'chat-bubble-bot text-zinc-200'}`}>
                  <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-white/6 bg-white/3">
            <form onSubmit={e => void sendDm(e)} className="flex gap-2">
              <input type="text" value={dm} onChange={e => setDm(e.target.value)} placeholder="Mensagem direta..."
                className="flex-1 rounded-lg border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-400/40 transition" disabled={dmLoading} />
              <button type="submit" disabled={dmLoading || !dm.trim() || selUser.whatsappAllowedNumbers.length === 0}
                className="rounded-lg bg-emerald-500/20 border border-emerald-500/30 px-4 py-2.5 text-sm text-emerald-300 font-semibold hover:bg-emerald-500/30 transition disabled:opacity-40">
                {dmOk ? '✓' : <IconSend />}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );

  /* ───── MAIN DASHBOARD ───── */
  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="sidebar w-60 flex-shrink-0 sticky top-0 h-screen flex flex-col p-4">
        <div className="flex items-center gap-3 px-3 py-4 mb-6">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-lg">💰</div>
          <div><p className="text-sm font-bold text-white">SaldoPro</p><p className="text-xs text-zinc-500">Admin Panel</p></div>
        </div>
        <nav className="flex-1 space-y-1">
          <button onClick={() => setTab('overview')} className={`sidebar-link w-full ${tab === 'overview' ? 'active' : ''}`}><IconGrid /> Visão Geral</button>
          <button onClick={() => setTab('operations')} className={`sidebar-link w-full ${tab === 'operations' ? 'active' : ''}`}><IconServer /> Operação</button>
          <button onClick={() => setTab('users')} className={`sidebar-link w-full ${tab === 'users' ? 'active' : ''}`}><IconUsers /> Usuários</button>
        </nav>
        <div className="border-t border-white/6 pt-4 space-y-1">
          <button onClick={() => void refresh()} disabled={loading} className="sidebar-link w-full"><IconRefresh /> {loading ? 'Atualizando...' : 'Atualizar'}</button>
          <button onClick={() => void logout()} className="sidebar-link w-full text-rose-300/60 hover:text-rose-300"><IconLogout /> Sair</button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-b border-white/6 px-4 py-3 flex items-center justify-between">
        <p className="text-sm font-bold text-white">💰 SaldoPro Admin</p>
        <div className="flex gap-2">
          {(['overview', 'operations', 'users'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${tab === t ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-400'}`}>
              {t === 'overview' ? 'Geral' : t === 'operations' ? 'Op.' : 'Users'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 min-w-0 p-4 lg:p-6 lg:mt-0 mt-14">
        {error && <div className="mb-4 rounded-xl border border-rose-400/15 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

        {/* ──── OVERVIEW TAB ──── */}
        {tab === 'overview' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-white">Visão Geral</h1>
              <p className="text-sm text-zinc-500 mt-1">Resumo consolidado da plataforma</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Usuários ativos" value={overview?.stats.activeUsers ?? 0} sub={`${overview?.stats.totalUsers ?? 0} total`} glow="card-glow-green" />
              <StatCard label="Transações" value={totalTx.toLocaleString('pt-BR')} glow="card-glow-sky" />
              <StatCard label="Mensagens WhatsApp" value={totalWa.toLocaleString('pt-BR')} sub={`Última: ${fmtDate(latestActivity)}`} glow="card-glow-amber" />
              <StatCard label="Lembretes" value={totalRem.toLocaleString('pt-BR')} glow="card-glow-green" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Growth chart */}
              <div className="card p-5">
                <p className="text-xs uppercase tracking-widest text-zinc-500 mb-4">Novos Usuários (6 meses)</p>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={growth}><XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }} />
                      <Line type="monotone" dataKey="users" stroke="#34d399" strokeWidth={2.5} dot={{ fill: '#34d399', r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Quick stats */}
              <div className="card p-5">
                <p className="text-xs uppercase tracking-widest text-zinc-500 mb-4">Distribuição de Usuários</p>
                <div className="space-y-3">
                  {[
                    { l: 'Ativos', v: overview?.stats.activeUsers ?? 0, c: 'bg-emerald-500', t: overview?.stats.totalUsers ?? 1 },
                    { l: 'Bloqueados', v: overview?.stats.blockedUsers ?? 0, c: 'bg-rose-500', t: overview?.stats.totalUsers ?? 1 },
                    { l: 'Sem WhatsApp', v: users.filter(u => u.whatsappAllowedNumbers.length === 0).length, c: 'bg-amber-500', t: users.length || 1 },
                    { l: 'Inativos (7d)', v: users.filter(u => isInactive(u.metrics.lastWhatsAppMessageAt)).length, c: 'bg-zinc-500', t: users.length || 1 },
                  ].map(s => (
                    <div key={s.l}>
                      <div className="flex justify-between text-sm mb-1.5"><span className="text-zinc-400">{s.l}</span><span className="text-white font-semibold">{s.v}</span></div>
                      <div className="h-1.5 rounded-full bg-white/5"><div className={`h-full rounded-full ${s.c} transition-all`} style={{ width: `${Math.min(100, (s.v / s.t) * 100)}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Top users by messages */}
            <div className="card p-5">
              <p className="text-xs uppercase tracking-widest text-zinc-500 mb-4">Top Usuários por Mensagens</p>
              <table className="data-table">
                <thead><tr><th>Nome</th><th>Email</th><th>Msgs</th><th>Transações</th><th>Última Atividade</th></tr></thead>
                <tbody>
                  {[...users].sort((a, b) => b.metrics.whatsappMessages - a.metrics.whatsappMessages).slice(0, 8).map(u => (
                    <tr key={u.uid} className="cursor-pointer" onClick={() => { setSelUid(u.uid); setTab('users'); }}>
                      <td className="text-white font-medium">{u.displayName || '—'}</td>
                      <td>{u.email || '—'}</td>
                      <td className="text-white font-semibold">{u.metrics.whatsappMessages}</td>
                      <td>{u.metrics.transactions}</td>
                      <td>{fmtDate(u.metrics.lastWhatsAppMessageAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ──── OPERATIONS TAB ──── */}
        {tab === 'operations' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-white">Operação</h1>
              <p className="text-sm text-zinc-500 mt-1">Saúde do backend e sessão WhatsApp</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="card p-5 card-glow-green">
                <p className="text-xs uppercase tracking-widest text-zinc-500">Backend</p>
                <div className="flex items-center gap-2 mt-3">
                  <div className={`w-2.5 h-2.5 rounded-full pulse-dot ${overview?.backend.ok ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  <span className="text-lg font-bold text-white">{overview?.backend.ok ? 'Online' : 'Offline'}</span>
                </div>
                <p className="text-xs text-zinc-500 mt-2">Uptime: {overview ? fmtUptime(overview.backend.uptime) : '—'}</p>
              </div>

              <div className={`card p-5 ${slot?.connected ? 'card-glow-green' : 'card-glow-rose'}`}>
                <p className="text-xs uppercase tracking-widest text-zinc-500">WhatsApp</p>
                <div className="flex items-center gap-2 mt-3">
                  <div className={`w-2.5 h-2.5 rounded-full pulse-dot ${slot?.connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  <span className="text-lg font-bold text-white">{slot?.connected ? 'Conectado' : 'Desconectado'}</span>
                </div>
                {slot?.phone && <p className="text-xs text-zinc-500 mt-2"><IconPhone />{' '}{slot.phone}</p>}
              </div>

              <div className="card p-5 card-glow-amber">
                <p className="text-xs uppercase tracking-widest text-zinc-500">Alertas (15min)</p>
                <p className="stat-value text-amber-300 mt-3">{(overview?.backend.alerts.warnings15m ?? 0) + (overview?.backend.alerts.errors15m ?? 0)}</p>
                <p className="text-xs text-zinc-500 mt-2">{overview?.backend.alerts.warnings15m ?? 0} warn · {overview?.backend.alerts.errors15m ?? 0} err</p>
              </div>

              <div className="card p-5">
                <p className="text-xs uppercase tracking-widest text-zinc-500">Ações</p>
                <div className="flex flex-col gap-2 mt-3">
                  <button onClick={() => void waAct('reset')} disabled={!!waAction}
                    className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 transition disabled:opacity-50">
                    {waAction === 'reset' ? '...' : 'Resetar Sessão'}
                  </button>
                  <button onClick={() => void waAct('qr')} disabled={!!waAction}
                    className="rounded-lg bg-sky-500/10 border border-sky-500/20 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/20 transition disabled:opacity-50">
                    {waAction === 'qr' ? '...' : 'Atualizar QR'}
                  </button>
                </div>
              </div>
            </div>

            {/* QR Code */}
            {qr?.available && qr.qrPngBase64 && (
              <div className="card p-5 max-w-xs">
                <p className="text-xs uppercase tracking-widest text-zinc-500 mb-3">QR Code</p>
                <img src={`data:image/png;base64,${qr.qrPngBase64}`} alt="QR" className="w-full rounded-lg" />
                {qr.expiresInSec != null && <p className="text-xs text-zinc-500 mt-2 text-center">Expira em {qr.expiresInSec}s</p>}
              </div>
            )}

            {/* Recent alerts */}
            {overview && overview.backend.alerts.recent.length > 0 && (
              <div className="card p-5">
                <p className="text-xs uppercase tracking-widest text-zinc-500 mb-4">Alertas Recentes</p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {overview.backend.alerts.recent.map((e, i) => (
                    <div key={i} className="flex items-start gap-3 text-sm py-2 border-b border-white/4 last:border-0">
                      <span className={`badge text-xs flex-shrink-0 ${e.level === 'error' ? 'badge-rose' : 'badge-amber'}`}>{e.level}</span>
                      <div className="min-w-0"><p className="text-zinc-300 truncate">{e.message}</p><p className="text-xs text-zinc-600 mt-0.5">{fmtDate(e.timestamp)}</p></div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* WhatsApp events */}
            {overview && overview.whatsapp.recentEvents.length > 0 && (
              <div className="card p-5">
                <p className="text-xs uppercase tracking-widest text-zinc-500 mb-4">Eventos WhatsApp</p>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {overview.whatsapp.recentEvents.map((e, i) => {
                    const tip = explainEvent(e.message);
                    return (
                      <div key={i} className="text-sm py-2 border-b border-white/4 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold log-${e.level}`}>{e.level.toUpperCase()}</span>
                          <span className="text-zinc-300">{e.message}</span>
                          <span className="text-xs text-zinc-600 ml-auto flex-shrink-0">{fmtDate(e.timestamp)}</span>
                        </div>
                        {tip && <p className="text-xs text-zinc-500 mt-1 pl-10">{tip}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ──── USERS TAB ──── */}
        {tab === 'users' && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-white">Usuários</h1>
                <p className="text-sm text-zinc-500 mt-1">{filtered.length} de {users.length} usuários</p>
              </div>
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome, email ou UID..."
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-400/40 transition w-full sm:w-72" />
            </div>

            {/* Filter chips */}
            <div className="flex flex-wrap gap-2">
              {([['all', 'Todos'], ['blocked', 'Bloqueados'], ['no_wa', 'Sem WhatsApp'], ['inactive', 'Inativos']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${filter === k ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-white/5 text-zinc-400 hover:text-white'}`}>{l}</button>
              ))}
            </div>

            {/* Users table */}
            <div className="card overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Nome</th><th>Email</th><th>Status</th><th>Txs</th><th>Msgs</th><th>WhatsApp</th><th>Última Atividade</th><th></th></tr></thead>
                <tbody>
                  {filtered.map(u => (
                    <tr key={u.uid} className={`cursor-pointer ${selUid === u.uid ? 'bg-emerald-500/5' : ''}`} onClick={() => setSelUid(u.uid)}>
                      <td className="text-white font-medium">{u.displayName || '—'}</td>
                      <td className="text-zinc-400 text-xs">{u.email || '—'}</td>
                      <td><span className={u.blocked ? 'badge badge-rose' : 'badge badge-green'}>{u.blocked ? 'Bloqueado' : 'Ativo'}</span></td>
                      <td className="text-white">{u.metrics.transactions}</td>
                      <td className="text-white">{u.metrics.whatsappMessages}</td>
                      <td>{u.whatsappAllowedNumbers.length > 0 ? <span className="badge badge-green">{u.whatsappAllowedNumbers[0]}</span> : <span className="text-zinc-600">—</span>}</td>
                      <td className="text-xs">{fmtDate(u.metrics.lastWhatsAppMessageAt)}</td>
                      <td>
                        <button onClick={ev => { ev.stopPropagation(); setSelUid(u.uid); setDetailUid(u.uid); }}
                          className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold">Detalhes →</button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={8} className="text-center text-zinc-500 py-8">Nenhum usuário encontrado.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Quick user panel */}
            {selUser && !detailUid && (
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">{selUser.displayName || '—'}</h3>
                    <p className="text-xs text-zinc-500">{selUser.email || selUser.uid}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setDetailUid(selUser.uid); }}
                      className="rounded-lg bg-emerald-500/15 border border-emerald-500/25 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 transition">
                      Ver Detalhes
                    </button>
                    <button onClick={() => void toggleBlock(selUser)} disabled={blockingUid === selUser.uid}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${selUser.blocked ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                      {blockingUid === selUser.uid ? '...' : selUser.blocked ? 'Desbloquear' : 'Bloquear'}
                    </button>
                  </div>
                </div>
                <div className="grid sm:grid-cols-4 gap-3">
                  <div className="rounded-lg bg-white/4 p-3"><p className="text-xs text-zinc-500">Transações</p><p className="text-lg font-bold text-white">{selUser.metrics.transactions}</p></div>
                  <div className="rounded-lg bg-white/4 p-3"><p className="text-xs text-zinc-500">Lembretes</p><p className="text-lg font-bold text-white">{selUser.metrics.reminders}</p></div>
                  <div className="rounded-lg bg-white/4 p-3"><p className="text-xs text-zinc-500">Mensagens</p><p className="text-lg font-bold text-white">{selUser.metrics.whatsappMessages}</p></div>
                  <div className="rounded-lg bg-white/4 p-3"><p className="text-xs text-zinc-500">Cadastro</p><p className="text-sm font-semibold text-white mt-0.5">{fmtDate(selUser.createdAt)}</p></div>
                </div>
                {/* Direct message */}
                {selUser.whatsappAllowedNumbers.length > 0 && (
                  <form onSubmit={e => void sendDm(e)} className="flex gap-2 mt-4">
                    <input type="text" value={dm} onChange={e => setDm(e.target.value)} placeholder="Enviar mensagem direta..."
                      className="flex-1 rounded-lg border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-400/40 transition" disabled={dmLoading} />
                    <button type="submit" disabled={dmLoading || !dm.trim()}
                      className="rounded-lg bg-emerald-500/20 border border-emerald-500/30 px-4 py-2.5 text-sm text-emerald-300 font-semibold hover:bg-emerald-500/30 transition disabled:opacity-40">
                      {dmOk ? '✓ Enviado' : 'Enviar'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
