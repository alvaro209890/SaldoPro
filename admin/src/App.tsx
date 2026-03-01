import { useEffect, useState, useMemo, type FormEvent } from 'react';
import { BACKEND_URL } from './config';
import { LineChart, Line, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { format, parseISO, startOfMonth, subMonths, isAfter } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const STORAGE_KEY = 'saldopro_admin_token';

interface AdminWhatsAppSlotStatus {
  slotId: string;
  connected: boolean;
  state: string;
  phone: string | null;
  lastDisconnectReason: string | null;
}

interface AdminQrSlot {
  available: boolean;
  qrPngBase64?: string;
  expiresInSec?: number;
  reason?: string;
}

interface AdminOverview {
  backend: {
    ok: boolean;
    uptime: number;
    timestamp: string;
    alerts: {
      warnings15m: number;
      errors15m: number;
      recent: AdminLogEntry[];
    };
  };
  whatsapp: {
    slots: AdminWhatsAppSlotStatus[];
    qr: Record<string, AdminQrSlot>;
    recentEvents: AdminLogEntry[];
  };
  stats: {
    totalUsers: number;
    blockedUsers: number;
    activeUsers: number;
  };
}

interface AdminLogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  meta?: Record<string, unknown>;
}

interface AdminSettings {
  budget: number;
  startDay: number;
  currency: string;
  whatsappAllowedNumbers: string[];
  updatedAt: string | null;
}

interface AdminUser {
  uid: string;
  email: string | null;
  displayName: string;
  createdAt: string | null;
  blocked: boolean;
  firebaseExists: boolean;
  whatsappAllowedNumbers: string[];
  settings: AdminSettings | null;
  metrics: {
    transactions: number;
    reminders: number;
    categories: number;
    whatsappMessages: number;
    lastWhatsAppMessageAt: string | null;
  };
  firebase: {
    disabled: boolean;
    createdAt: string | null;
    lastSignInAt: string | null;
  };
}

interface AdminTransactionItem {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  date: string;
  monthKey: string;
  category: string;
  description: string;
  paymentMethod: string;
  createdAt: string;
  updatedAt: string;
}

interface AdminReminderItem {
  id: string;
  reminderKind: 'general' | 'payable' | 'receivable';
  title: string;
  amount: number | null;
  dueDate: string;
  dueTime?: string | null;
  status: 'pending' | 'paid';
  createdAt: string;
  updatedAt: string;
}

type QuickFilter = 'all' | 'blocked' | 'no_whatsapp' | 'no_firebase' | 'inactive';

function readStoredToken(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(STORAGE_KEY)?.trim() ?? '';
}

function persistToken(token: string): void {
  if (typeof window === 'undefined') return;
  if (token) {
    window.localStorage.setItem(STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

function formatDate(value: string | null): string {
  if (!value) return 'Sem dado';

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(parsed));
}

function formatUptime(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  return `${hours}h ${minutes}m ${remainingSeconds}s`;
}

function formatCurrency(value: number, currency = 'BRL'): string {
  if (currency === 'BRL') {
    return `R$ ${value.toFixed(2).replace('.', ',')}`;
  }
  return `${currency} ${value.toFixed(2)}`;
}

function isInactiveRecently(value: string | null): boolean {
  if (!value) return true;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return true;
  return parsed < Date.now() - 7 * 24 * 60 * 60 * 1000;
}

async function parseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error || 'Erro inesperado.';
}

async function adminFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<T>;
}

export function App() {
  const [token, setToken] = useState<string>(() => readStoredToken());
  const [checkingSession, setCheckingSession] = useState<boolean>(true);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [password, setPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState<boolean>(false);
  const [dashboardError, setDashboardError] = useState<string>('');
  const [userActionUid, setUserActionUid] = useState<string>('');
  const [whatsAppActionLoading, setWhatsAppActionLoading] = useState<'reset' | 'refreshQr' | ''>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [recentTransactions, setRecentTransactions] = useState<AdminTransactionItem[]>([]);
  const [recentReminders, setRecentReminders] = useState<AdminReminderItem[]>([]);
  const [directMessage, setDirectMessage] = useState<string>('');
  const [directMessageLoading, setDirectMessageLoading] = useState<boolean>(false);
  const [directMessageSuccess, setDirectMessageSuccess] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    async function validateSession(currentToken: string): Promise<void> {
      if (!currentToken) {
        if (!cancelled) {
          setCheckingSession(false);
        }
        return;
      }

      try {
        await adminFetch<{ ok: boolean }>('/api/admin/auth/session', currentToken);
        if (!cancelled) {
          setCheckingSession(false);
        }
      } catch {
        persistToken('');
        if (!cancelled) {
          setToken('');
          setCheckingSession(false);
        }
      }
    }

    void validateSession(token);

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token) {
      setOverview(null);
      setUsers([]);
      setSelectedUid('');
      setSelectedUser(null);
      setRecentTransactions([]);
      setRecentReminders([]);
      return;
    }

    let cancelled = false;

    async function loadDashboard(silent = false): Promise<void> {
      if (!silent) {
        setDashboardLoading(true);
      }
      setDashboardError('');

      try {
        const [overviewPayload, usersPayload] = await Promise.all([
          adminFetch<AdminOverview>('/api/admin/overview', token),
          adminFetch<{ users: AdminUser[] }>('/api/admin/users', token)
        ]);

        if (cancelled) return;

        setOverview(overviewPayload);
        setUsers(usersPayload.users);
        setSelectedUser((current) => {
          if (!current) return current;
          return usersPayload.users.find((user) => user.uid === current.uid) ?? current;
        });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Falha ao carregar o painel.';
        setDashboardError(message);
        if (message.toLowerCase().includes('session')) {
          persistToken('');
          setToken('');
        }
      } finally {
        if (!cancelled) {
          setDashboardLoading(false);
        }
      }
    }

    void loadDashboard();
    const interval = window.setInterval(() => {
      void loadDashboard(true);
    }, 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [token]);

  useEffect(() => {
    if (!token || !selectedUid) {
      setSelectedUser(null);
      setRecentTransactions([]);
      setRecentReminders([]);
      return;
    }

    let cancelled = false;

    async function loadUser(): Promise<void> {
      try {
        const payload = await adminFetch<{
          user: AdminUser;
          recentTransactions: AdminTransactionItem[];
          recentReminders: AdminReminderItem[];
        }>(`/api/admin/users/${selectedUid}`, token);
        if (!cancelled) {
          setSelectedUser(payload.user);
          setRecentTransactions(payload.recentTransactions);
          setRecentReminders(payload.recentReminders);
        }
      } catch (error) {
        if (!cancelled) {
          setDashboardError(error instanceof Error ? error.message : 'Falha ao carregar detalhes do usuário.');
        }
      }
    }

    void loadUser();

    return () => {
      cancelled = true;
    };
  }, [selectedUid, token]);

  // Reset states when selected UID changes
  useEffect(() => {
    setDirectMessage('');
    setDirectMessageSuccess(false);
  }, [selectedUid]);

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError('');

    try {
      const response = await fetch(`${BACKEND_URL}/api/admin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      const payload = await response.json() as { token: string };
      const nextToken = payload.token?.trim() ?? '';
      persistToken(nextToken);
      setToken(nextToken);
      setPassword('');
      setCheckingSession(false);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Falha ao entrar.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout(): Promise<void> {
    if (token) {
      try {
        await adminFetch<{ ok: boolean }>('/api/admin/auth/logout', token, { method: 'POST' });
      } catch {
        // Ignore logout transport failures and clear the local session anyway.
      }
    }

    persistToken('');
    setToken('');
    setPassword('');
    setAuthError('');
    setOverview(null);
    setUsers([]);
    setSelectedUid('');
    setSelectedUser(null);
  }

  async function handleRefresh(): Promise<void> {
    if (!token) return;

    setDashboardLoading(true);
    setDashboardError('');

    try {
      const [overviewPayload, usersPayload] = await Promise.all([
        adminFetch<AdminOverview>('/api/admin/overview', token),
        adminFetch<{ users: AdminUser[] }>('/api/admin/users', token)
      ]);
      setOverview(overviewPayload);
      setUsers(usersPayload.users);
      if (selectedUid) {
        const details = await adminFetch<{
          user: AdminUser;
          recentTransactions: AdminTransactionItem[];
          recentReminders: AdminReminderItem[];
        }>(`/api/admin/users/${selectedUid}`, token);
        setSelectedUser(details.user);
        setRecentTransactions(details.recentTransactions);
        setRecentReminders(details.recentReminders);
      }
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'Falha ao atualizar.');
    } finally {
      setDashboardLoading(false);
    }
  }

  async function handleToggleBlock(user: AdminUser): Promise<void> {
    if (!token) return;

    const nextAction = user.blocked ? 'unblock' : 'block';
    setUserActionUid(user.uid);
    setDashboardError('');

    try {
      await adminFetch<{ ok: boolean }>(`/api/admin/users/${user.uid}/${nextAction}`, token, {
        method: 'POST',
        body: JSON.stringify({
          reason: user.blocked ? null : 'Painel administrativo'
        })
      });
      await handleRefresh();
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'Falha ao atualizar o bloqueio.');
    } finally {
      setUserActionUid('');
    }
  }

  async function handleWhatsAppAction(action: 'reset' | 'refreshQr'): Promise<void> {
    if (!token) return;
    setWhatsAppActionLoading(action);
    setDashboardError('');

    try {
      const payload = await adminFetch<{
        ok: boolean;
        slots: AdminWhatsAppSlotStatus[];
        qr: Record<string, AdminQrSlot>;
      }>(
        action === 'reset' ? '/api/admin/whatsapp/reset-session' : '/api/admin/whatsapp/refresh-qr',
        token,
        { method: 'POST' }
      );

      setOverview((current) => current ? {
        ...current,
        whatsapp: {
          ...current.whatsapp,
          slots: payload.slots,
          qr: payload.qr
        }
      } : current);
      await handleRefresh();
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'Falha na ação do WhatsApp.');
    } finally {
      setWhatsAppActionLoading('');
    }
  }

  async function handleSendDirectMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token || !selectedUid || !directMessage.trim()) return;

    setDirectMessageLoading(true);
    setDirectMessageSuccess(false);
    setDashboardError('');

    try {
      await adminFetch<{ ok: boolean }>(`/api/admin/users/${selectedUid}/message`, token, {
        method: 'POST',
        body: JSON.stringify({ text: directMessage })
      });
      setDirectMessageSuccess(true);
      setDirectMessage('');
      setTimeout(() => setDirectMessageSuccess(false), 3000);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'Falha ao enviar mensagem.');
    } finally {
      setDirectMessageLoading(false);
    }
  }

  const primarySlot = overview?.whatsapp.slots[0] ?? null;
  const primaryQr = primarySlot ? overview?.whatsapp.qr[primarySlot.slotId] : null;
  const filteredUsers = users.filter((user) => {
    const term = searchTerm.trim().toLowerCase();
    const matchesSearch = !term || [
      user.displayName,
      user.email ?? '',
      user.uid,
      ...user.whatsappAllowedNumbers
    ]
      .join(' ')
      .toLowerCase()
      .includes(term);

    if (!matchesSearch) return false;

    if (quickFilter === 'blocked') return user.blocked;
    if (quickFilter === 'no_whatsapp') return user.whatsappAllowedNumbers.length === 0;
    if (quickFilter === 'no_firebase') return !user.firebaseExists;
    if (quickFilter === 'inactive') return isInactiveRecently(user.metrics.lastWhatsAppMessageAt);
    return true;
  });
  const totalTransactions = users.reduce((sum, user) => sum + user.metrics.transactions, 0);
  const totalReminders = users.reduce((sum, user) => sum + user.metrics.reminders, 0);
  const totalWhatsAppMessages = users.reduce((sum, user) => sum + user.metrics.whatsappMessages, 0);
  const usersWithoutWhatsApp = users.filter((user) => user.whatsappAllowedNumbers.length === 0).length;
  const missingFirebaseAccounts = users.filter((user) => !user.firebaseExists).length;
  const latestGlobalActivity = users.reduce<string | null>((latest, user) => {
    const current = user.metrics.lastWhatsAppMessageAt;
    if (!current) return latest;
    if (!latest || current > latest) return current;
    return latest;
  }, null);

  const growthData = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = subMonths(new Date(), 5 - i);
      return startOfMonth(d);
    });

    const data = months.map(m => ({
      name: format(m, 'MMM/yy', { locale: ptBR }),
      date: m,
      current: 0
    }));

    const minDate = months[0];

    users.forEach(user => {
      const createdAt = user.createdAt ? parseISO(user.createdAt) : null;
      if (createdAt && (isAfter(createdAt, minDate) || createdAt.getTime() === minDate.getTime())) {
        const monthStart = startOfMonth(createdAt).getTime();
        const bucket = data.find(d => d.date.getTime() === monthStart);
        if (bucket) {
          bucket.current += 1;
        }
      }
    });

    return data;
  }, [users]);

  if (checkingSession) {
    return (
      <div className="admin-shell flex min-h-screen items-center justify-center px-6 py-10">
        <div className="admin-panel w-full max-w-xl rounded-3xl p-8 text-center">
          <p className="text-sm uppercase tracking-[0.4em] text-emerald-200/70">SaldoPro Admin</p>
          <h1 className="mt-4 text-3xl font-semibold text-white">Validando sessão</h1>
          <p className="mt-4 text-sm text-zinc-300">Carregando o painel administrativo.</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="admin-shell flex min-h-screen items-center justify-center px-6 py-10">
        <div className="admin-panel w-full max-w-xl rounded-3xl p-8 sm:p-10">
          <p className="text-sm uppercase tracking-[0.4em] text-emerald-200/70">Acesso restrito</p>
          <h1 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">Painel administrativo</h1>
          <p className="mt-4 text-sm leading-6 text-zinc-300">
            Entre com a senha mestra para monitorar backend, WhatsApp e contas dos usuários.
          </p>

          <form className="mt-8 space-y-4" onSubmit={(event) => void handleLogin(event)}>
            <label className="block text-left text-sm font-medium text-zinc-200" htmlFor="admin-password">
              Senha do painel
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white outline-none transition focus:border-emerald-300/50 focus:bg-white/7"
              placeholder="Digite a senha administrativa"
            />
            {authError ? (
              <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {authError}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {authLoading ? 'Entrando...' : 'Entrar no painel'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 lg:flex-row">
        <main className="min-w-0 flex-1 space-y-4">
          <section className="admin-panel rounded-3xl px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-emerald-200/70">Operação</p>
                <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">Controle administrativo</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
                  Acompanhe a saúde do backend, a sessão do WhatsApp e gerencie o acesso dos usuários em tempo real.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  disabled={dashboardLoading}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-zinc-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {dashboardLoading ? 'Atualizando...' : 'Atualizar agora'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-100 transition hover:bg-amber-400/15"
                >
                  Sair
                </button>
              </div>
            </div>
            {dashboardError ? (
              <div className="mt-4 rounded-2xl border border-rose-400/15 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {dashboardError}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-zinc-400">
              <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1.5">
                Backend: {BACKEND_URL}
              </span>
              <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1.5">
                Última atividade geral: {formatDate(latestGlobalActivity)}
              </span>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <div className="admin-panel rounded-3xl p-5">
              <p className="text-xs uppercase tracking-[0.32em] text-zinc-400">Backend</p>
              <div className="mt-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Status do servidor</h2>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${overview?.backend.ok ? 'bg-emerald-300/15 text-emerald-200' : 'bg-rose-400/15 text-rose-200'}`}>
                  {overview?.backend.ok ? 'Online' : 'Offline'}
                </span>
              </div>
              <dl className="mt-5 space-y-3 text-sm text-zinc-300">
                <div className="flex justify-between gap-4">
                  <dt>Uptime</dt>
                  <dd>{overview ? formatUptime(overview.backend.uptime) : 'Carregando'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Última leitura</dt>
                  <dd>{overview ? formatDate(overview.backend.timestamp) : 'Carregando'}</dd>
                </div>
              </dl>
            </div>

            <div className="admin-panel rounded-3xl p-5">
              <p className="text-xs uppercase tracking-[0.32em] text-zinc-400">WhatsApp</p>
              <div className="mt-4 flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold text-white">Conexão ativa</h2>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${primarySlot?.connected ? 'bg-emerald-300/15 text-emerald-200' : 'bg-amber-300/15 text-amber-100'}`}>
                  {primarySlot?.connected ? 'Conectado' : 'Desconectado'}
                </span>
              </div>
              <dl className="mt-5 space-y-3 text-sm text-zinc-300">
                <div className="flex justify-between gap-4">
                  <dt>Slot</dt>
                  <dd>{primarySlot?.slotId ?? 'wa1'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Telefone</dt>
                  <dd>{primarySlot?.phone ?? 'Sem sessão'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Estado</dt>
                  <dd>{primarySlot?.state ?? 'Indisponível'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Motivo</dt>
                  <dd>{primarySlot?.lastDisconnectReason ?? 'Sem alerta'}</dd>
                </div>
              </dl>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleWhatsAppAction('reset')}
                  disabled={whatsAppActionLoading.length > 0}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold text-zinc-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {whatsAppActionLoading === 'reset' ? 'Resetando...' : 'Resetar sessão'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleWhatsAppAction('refreshQr')}
                  disabled={whatsAppActionLoading.length > 0}
                  className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-2.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {whatsAppActionLoading === 'refreshQr' ? 'Gerando...' : 'Forçar novo QR'}
                </button>
              </div>
            </div>

            <div className="admin-panel rounded-3xl p-5">
              <p className="text-xs uppercase tracking-[0.32em] text-zinc-400">Contas</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Total</p>
                  <p className="mt-3 text-2xl font-semibold text-white">{overview?.stats.totalUsers ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-rose-300/10 bg-rose-400/5 p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Bloqueados</p>
                  <p className="mt-3 text-2xl font-semibold text-rose-200">{overview?.stats.blockedUsers ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-emerald-300/10 bg-emerald-300/5 p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Ativos</p>
                  <p className="mt-3 text-2xl font-semibold text-emerald-200">{overview?.stats.activeUsers ?? 0}</p>
                </div>
              </div>
            </div>
            <div className="admin-panel rounded-3xl p-5 xl:col-span-2">
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Alertas recentes</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-amber-300/10 bg-amber-400/5 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Warn em 15 min</p>
                  <p className="mt-2 text-2xl font-semibold text-amber-100">{overview?.backend.alerts.warnings15m ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-rose-300/10 bg-rose-400/5 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Erro em 15 min</p>
                  <p className="mt-2 text-2xl font-semibold text-rose-200">{overview?.backend.alerts.errors15m ?? 0}</p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {(overview?.backend.alerts.recent ?? []).slice(0, 4).map((entry) => (
                  <div key={`${entry.timestamp}:${entry.message}`} className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                    <div className="flex items-center justify-between gap-4 text-xs">
                      <span className={`rounded-full px-2.5 py-1 font-semibold uppercase tracking-[0.18em] ${entry.level === 'error' ? 'bg-rose-400/15 text-rose-200' : 'bg-amber-300/15 text-amber-100'}`}>
                        {entry.level}
                      </span>
                      <span className="text-zinc-500">{formatDate(entry.timestamp)}</span>
                    </div>
                    <p className="mt-2 text-sm text-zinc-200">{entry.message}</p>
                  </div>
                ))}
                {(overview?.backend.alerts.recent ?? []).length === 0 ? (
                  <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-sm text-zinc-400">
                    Nenhum warn/erro recente capturado.
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="admin-panel rounded-3xl p-5">
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Transações</p>
              <p className="mt-3 text-3xl font-semibold text-white">{totalTransactions}</p>
              <p className="mt-2 text-sm text-zinc-400">Total registrado por todos os usuários.</p>
            </div>
            <div className="admin-panel rounded-3xl p-5">
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Lembretes</p>
              <p className="mt-3 text-3xl font-semibold text-white">{totalReminders}</p>
              <p className="mt-2 text-sm text-zinc-400">Pendentes e concluídos somados.</p>
            </div>
            <div className="admin-panel rounded-3xl p-5">
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Mensagens WA</p>
              <p className="mt-3 text-3xl font-semibold text-white">{totalWhatsAppMessages}</p>
              <p className="mt-2 text-sm text-zinc-400">Histórico capturado nas conversas.</p>
            </div>
            <div className="admin-panel rounded-3xl p-5">
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Sem WhatsApp</p>
              <p className="mt-3 text-3xl font-semibold text-amber-100">{usersWithoutWhatsApp}</p>
              <p className="mt-2 text-sm text-zinc-400">Usuários sem número liberado.</p>
            </div>
            <div className="admin-panel rounded-3xl p-5">
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Sem Firebase</p>
              <p className="mt-3 text-3xl font-semibold text-rose-200">{missingFirebaseAccounts}</p>
              <p className="mt-2 text-sm text-zinc-400">Registros órfãos no Supabase.</p>
            </div>
          </section>

          <section className="admin-panel rounded-3xl p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.32em] text-zinc-400">Crescimento</p>
                <h2 className="mt-3 text-xl font-semibold text-white">Cadastros de usuários nos últimos 6 meses</h2>
              </div>
            </div>
            <div className="mt-6 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={growthData}>
                  <XAxis
                    dataKey="name"
                    stroke="#52525b"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: '16px', color: '#e4e4e7', fontSize: '13px' }}
                    itemStyle={{ color: '#6ee7b7' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="current"
                    name="Novos Usuários"
                    stroke="#6ee7b7"
                    strokeWidth={3}
                    dot={{ r: 4, strokeWidth: 2, fill: '#18181b' }}
                    activeDot={{ r: 6, strokeWidth: 0, fill: '#6ee7b7' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {primarySlot && !primarySlot.connected ? (
            <section className="admin-panel rounded-3xl p-5">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-xl">
                  <p className="text-xs uppercase tracking-[0.32em] text-zinc-400">QRCode</p>
                  <h2 className="mt-3 text-xl font-semibold text-white">Reconexão do WhatsApp</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    Quando o WhatsApp estiver desconectado, o QR aparece aqui. Se ainda não houver um QR ativo, o painel mostra o motivo atual.
                  </p>
                  {primaryQr?.available ? (
                    <p className="mt-3 text-sm text-emerald-200">
                      QR disponível por mais {primaryQr.expiresInSec ?? 0}s.
                    </p>
                  ) : (
                    <p className="mt-3 text-sm text-amber-100">
                      QR indisponível: {primaryQr?.reason ?? 'aguardando geração'}.
                    </p>
                  )}
                </div>
                <div className="flex justify-center">
                  {primaryQr?.available && primaryQr.qrPngBase64 ? (
                    <img
                      src={primaryQr.qrPngBase64}
                      alt="QR Code do WhatsApp"
                      className="h-56 w-56 rounded-3xl border border-white/10 bg-white p-4"
                    />
                  ) : (
                    <div className="flex h-56 w-56 items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/5 px-6 text-center text-sm text-zinc-400">
                      Nenhum QR ativo no momento.
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          <section className="admin-panel rounded-3xl p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.32em] text-zinc-400">Eventos</p>
                <h2 className="mt-3 text-xl font-semibold text-white">Histórico curto do WhatsApp</h2>
              </div>
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              {(overview?.whatsapp.recentEvents ?? []).slice(0, 6).map((entry) => (
                <div key={`${entry.timestamp}:${entry.message}`} className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                  <div className="flex items-center justify-between gap-4 text-xs text-zinc-500">
                    <span className={`rounded-full px-2.5 py-1 font-semibold uppercase tracking-[0.18em] ${entry.level === 'error' ? 'bg-rose-400/15 text-rose-200' : entry.level === 'warn' ? 'bg-amber-300/15 text-amber-100' : 'bg-emerald-300/15 text-emerald-200'}`}>
                      {entry.level}
                    </span>
                    <span>{formatDate(entry.timestamp)}</span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-200">{entry.message}</p>
                </div>
              ))}
              {(overview?.whatsapp.recentEvents ?? []).length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-sm text-zinc-400">
                  Nenhum evento recente do WhatsApp disponível.
                </div>
              ) : null}
            </div>
          </section>

          <section className="admin-panel rounded-3xl p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.32em] text-zinc-400">Usuários</p>
                <h2 className="mt-3 text-xl font-semibold text-white">Base consolidada</h2>
              </div>
              <div className="flex w-full max-w-xl flex-col gap-3 sm:items-end">
                <p className="text-sm text-zinc-400">
                  Clique em uma linha para abrir os detalhes do usuário.
                </p>
                <div className="flex w-full flex-wrap gap-2">
                  {[
                    ['all', 'Todos'],
                    ['blocked', 'Bloqueados'],
                    ['no_whatsapp', 'Sem WhatsApp'],
                    ['no_firebase', 'Sem Firebase'],
                    ['inactive', 'Sem atividade 7d']
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setQuickFilter(value as QuickFilter)}
                      className={`rounded-full px-3 py-2 text-xs font-semibold transition ${quickFilter === value ? 'bg-emerald-300 text-zinc-950' : 'border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-300/50"
                  placeholder="Buscar por nome, e-mail, UID ou telefone"
                />
              </div>
            </div>

            <div className="mt-5 overflow-x-auto rounded-3xl border border-white/8 bg-black/10">
              <div className="grid-table border-b border-white/8 px-4 py-3 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                <div>Usuário</div>
                <div>Email</div>
                <div>Status</div>
                <div>Transações</div>
                <div>Lembretes</div>
                <div>Mensagens WA</div>
                <div>Última atividade</div>
                <div>Ações</div>
              </div>

              {filteredUsers.length === 0 ? (
                <div className="px-4 py-8 text-sm text-zinc-400">
                  {dashboardLoading ? 'Carregando usuários...' : 'Nenhum usuário encontrado para esse filtro.'}
                </div>
              ) : (
                filteredUsers.map((user) => (
                  <div
                    key={user.uid}
                    onClick={() => {
                      setSelectedUid(user.uid);
                      setSelectedUser(user);
                    }}
                    className={`grid-table items-center gap-3 px-4 py-4 text-left text-sm transition ${selectedUid === user.uid ? 'bg-emerald-300/8' : 'border-t border-white/6 hover:bg-white/5'} cursor-pointer`}
                  >
                    <div>
                      <p className="font-semibold text-white">{user.displayName || 'Sem nome'}</p>
                      <p className="mt-1 text-xs text-zinc-500">{user.uid}</p>
                    </div>
                    <div className="truncate text-zinc-300">{user.email ?? 'Sem e-mail'}</div>
                    <div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${user.blocked ? 'bg-rose-400/15 text-rose-200' : 'bg-emerald-300/15 text-emerald-200'}`}>
                        {user.blocked ? 'Bloqueado' : 'Ativo'}
                      </span>
                    </div>
                    <div className="text-zinc-200">{user.metrics.transactions}</div>
                    <div className="text-zinc-200">{user.metrics.reminders}</div>
                    <div className="text-zinc-200">{user.metrics.whatsappMessages}</div>
                    <div className="text-zinc-300">{formatDate(user.metrics.lastWhatsAppMessageAt)}</div>
                    <div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleToggleBlock(user);
                        }}
                        disabled={userActionUid === user.uid}
                        className={`inline-flex rounded-full px-3 py-2 text-xs font-semibold ${user.blocked ? 'bg-emerald-300 text-zinc-950' : 'bg-rose-400/85 text-white'} disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {userActionUid === user.uid ? 'Salvando...' : user.blocked ? 'Desbloquear' : 'Bloquear'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </main>

        <aside className="w-full lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-[380px] lg:flex-none">
          <div className="admin-panel flex h-full min-h-[320px] flex-col rounded-3xl p-5">
            <p className="text-xs uppercase tracking-[0.32em] text-zinc-400">Detalhes</p>
            {!selectedUser ? (
              <div className="flex flex-1 items-center justify-center text-center text-sm leading-6 text-zinc-400">
                Selecione um usuário para ver dados completos, telefones liberados e estado de acesso.
              </div>
            ) : (
              <div className="mt-5 space-y-5 overflow-y-auto pr-1">
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold text-white">{selectedUser.displayName || 'Sem nome'}</h2>
                      <p className="mt-1 break-all text-xs text-zinc-500">{selectedUser.uid}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${selectedUser.blocked ? 'bg-rose-400/15 text-rose-200' : 'bg-emerald-300/15 text-emerald-200'}`}>
                      {selectedUser.blocked ? 'Bloqueado' : 'Ativo'}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-zinc-300">{selectedUser.email ?? 'Sem e-mail cadastrado'}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Criado em</p>
                    <p className="mt-2 text-sm text-zinc-200">{formatDate(selectedUser.createdAt)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Último login Firebase</p>
                    <p className="mt-2 text-sm text-zinc-200">{formatDate(selectedUser.firebase.lastSignInAt)}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">WhatsApp liberado</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedUser.whatsappAllowedNumbers.length === 0 ? (
                      <span className="text-sm text-zinc-400">Sem números permitidos.</span>
                    ) : (
                      selectedUser.whatsappAllowedNumbers.map((phone) => (
                        <span key={phone} className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-200">
                          {phone}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Configuração</p>
                  <dl className="mt-3 space-y-2 text-sm text-zinc-300">
                    <div className="flex justify-between gap-4">
                      <dt>Moeda</dt>
                      <dd>{selectedUser.settings?.currency ?? 'BRL'}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt>Orçamento</dt>
                      <dd>{selectedUser.settings?.budget ?? 0}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt>Fechamento</dt>
                      <dd>Dia {selectedUser.settings?.startDay ?? 1}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt>Atualizado</dt>
                      <dd>{formatDate(selectedUser.settings?.updatedAt ?? null)}</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Volume de dados</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-black/15 p-3">
                      <p className="text-xs text-zinc-500">Transações</p>
                      <p className="mt-2 text-lg font-semibold text-white">{selectedUser.metrics.transactions}</p>
                    </div>
                    <div className="rounded-2xl bg-black/15 p-3">
                      <p className="text-xs text-zinc-500">Lembretes</p>
                      <p className="mt-2 text-lg font-semibold text-white">{selectedUser.metrics.reminders}</p>
                    </div>
                    <div className="rounded-2xl bg-black/15 p-3">
                      <p className="text-xs text-zinc-500">Categorias</p>
                      <p className="mt-2 text-lg font-semibold text-white">{selectedUser.metrics.categories}</p>
                    </div>
                    <div className="rounded-2xl bg-black/15 p-3">
                      <p className="text-xs text-zinc-500">Mensagens WA</p>
                      <p className="mt-2 text-lg font-semibold text-white">{selectedUser.metrics.whatsappMessages}</p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm text-zinc-400">
                    Última atividade registrada: {formatDate(selectedUser.metrics.lastWhatsAppMessageAt)}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Comunicação Proativa</p>
                  <form onSubmit={(e) => void handleSendDirectMessage(e)} className="mt-3 flex flex-col gap-3">
                    <textarea
                      value={directMessage}
                      onChange={(e) => setDirectMessage(e.target.value)}
                      placeholder="Mensagem para o WhatsApp do usuário..."
                      className="w-full resize-none rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none transition focus:border-emerald-300/50"
                      rows={3}
                      disabled={directMessageLoading}
                    />
                    <div className="flex items-center justify-between">
                      {directMessageSuccess ? (
                        <span className="text-xs text-emerald-300">Mensagem enviada!</span>
                      ) : (
                        <span className="text-xs text-zinc-500">Chegará pelo bot oficial.</span>
                      )}
                      <button
                        type="submit"
                        disabled={directMessageLoading || !directMessage.trim() || selectedUser.whatsappAllowedNumbers.length === 0}
                        className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {directMessageLoading ? 'Enviando...' : 'Enviar Mensagem'}
                      </button>
                    </div>
                  </form>
                </div>

                <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Últimas transações</p>
                  <div className="mt-3 space-y-3">
                    {recentTransactions.map((item) => (
                      <div key={item.id} className="rounded-2xl bg-black/15 px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{item.description}</p>
                            <p className="mt-1 text-xs text-zinc-500">{item.category} • {formatDate(item.date)}</p>
                          </div>
                          <span className={`text-sm font-semibold ${item.type === 'income' ? 'text-emerald-200' : 'text-rose-200'}`}>
                            {item.type === 'income' ? '+' : '-'} {formatCurrency(item.amount, selectedUser.settings?.currency ?? 'BRL')}
                          </span>
                        </div>
                      </div>
                    ))}
                    {recentTransactions.length === 0 ? (
                      <p className="text-sm text-zinc-400">Nenhuma transação recente.</p>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Últimos lembretes</p>
                  <div className="mt-3 space-y-3">
                    {recentReminders.map((item) => (
                      <div key={item.id} className="rounded-2xl bg-black/15 px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{item.title}</p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {formatDate(item.dueDate)}{item.dueTime ? ` às ${item.dueTime}` : ''}
                            </p>
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.status === 'paid' ? 'bg-emerald-300/15 text-emerald-200' : 'bg-amber-300/15 text-amber-100'}`}>
                            {item.status === 'paid' ? 'Concluído' : 'Pendente'}
                          </span>
                        </div>
                        {item.amount != null ? (
                          <p className="mt-2 text-sm text-zinc-300">
                            {formatCurrency(item.amount, selectedUser.settings?.currency ?? 'BRL')}
                          </p>
                        ) : null}
                      </div>
                    ))}
                    {recentReminders.length === 0 ? (
                      <p className="text-sm text-zinc-400">Nenhum lembrete recente.</p>
                    ) : null}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void handleToggleBlock(selectedUser)}
                  disabled={userActionUid === selectedUser.uid}
                  className={`w-full rounded-2xl px-4 py-3 text-sm font-semibold transition ${selectedUser.blocked ? 'bg-emerald-300 text-zinc-950 hover:bg-emerald-200' : 'bg-rose-500 text-white hover:bg-rose-400'} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {userActionUid === selectedUser.uid
                    ? 'Salvando...'
                    : selectedUser.blocked
                      ? 'Desbloquear usuário'
                      : 'Bloquear usuário'}
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
