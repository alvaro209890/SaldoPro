import { useEffect, useState, type FormEvent } from 'react';
import { BACKEND_URL } from './config';

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
  };
  whatsapp: {
    slots: AdminWhatsAppSlotStatus[];
    qr: Record<string, AdminQrSlot>;
  };
  stats: {
    totalUsers: number;
    blockedUsers: number;
    activeUsers: number;
  };
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
      return;
    }

    let cancelled = false;

    async function loadUser(): Promise<void> {
      try {
        const payload = await adminFetch<{ user: AdminUser }>(`/api/admin/users/${selectedUid}`, token);
        if (!cancelled) {
          setSelectedUser(payload.user);
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
        const details = await adminFetch<{ user: AdminUser }>(`/api/admin/users/${selectedUid}`, token);
        setSelectedUser(details.user);
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

  const primarySlot = overview?.whatsapp.slots[0] ?? null;
  const primaryQr = primarySlot ? overview?.whatsapp.qr[primarySlot.slotId] : null;

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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.32em] text-zinc-400">Usuários</p>
                <h2 className="mt-3 text-xl font-semibold text-white">Base consolidada</h2>
              </div>
              <p className="text-sm text-zinc-400">
                Clique em uma linha para abrir os detalhes do usuário.
              </p>
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

              {users.length === 0 ? (
                <div className="px-4 py-8 text-sm text-zinc-400">
                  {dashboardLoading ? 'Carregando usuários...' : 'Nenhum usuário encontrado.'}
                </div>
              ) : (
                users.map((user) => (
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
