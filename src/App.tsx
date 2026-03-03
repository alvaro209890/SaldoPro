import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import { PlanFeatureGate } from '@/components/layout/PlanFeatureGate';

// Pages
import { Login } from '@/pages/Login';
import { Register } from '@/pages/Register';
import { ResetPassword } from '@/pages/ResetPassword';
import { Dashboard } from '@/pages/Dashboard';
import { Transactions } from '@/pages/Transactions';
import { Categories } from '@/pages/Categories';
import { Reports } from '@/pages/Reports';
import { Settings } from '@/pages/Settings';
import { AIAssistant } from '@/pages/AIAssistant';
import { Reminders } from '@/pages/Reminders';
import { RecurringTransactions } from '@/pages/RecurringTransactions';
import { Documents } from '@/pages/Documents';
import { Goals } from '@/pages/Goals';
import { Plans } from '@/pages/Plans';

export function App() {
    return (
        <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Protected Routes */}
            <Route path="/app" element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                    <Route path="dashboard" element={<Dashboard />} />
                    <Route path="transactions" element={<Transactions />} />
                    <Route path="categories" element={<Categories />} />
                    <Route path="reports" element={<Reports />} />
                    <Route path="settings" element={<Settings />} />
                    <Route
                        path="ai"
                        element={
                            <PlanFeatureGate
                                feature="webAiChat"
                                title="A IA do painel exige um plano ativo"
                                description="Assine um plano premium para desbloquear o chat com IA no painel. A funcionalidade fica disponivel assim que o pagamento for confirmado."
                            >
                                <AIAssistant />
                            </PlanFeatureGate>
                        }
                    />
                    <Route path="reminders" element={<Reminders />} />
                    <Route path="recurring" element={<RecurringTransactions />} />
                    <Route
                        path="documents"
                        element={
                            <PlanFeatureGate
                                feature="documentStorage"
                                title="A area de arquivos faz parte do premium"
                                description="Imagens, PDFs e ZIPs so ficam disponiveis com assinatura ativa. Assine um plano para liberar."
                            >
                                <Documents />
                            </PlanFeatureGate>
                        }
                    />
                    <Route
                        path="goals"
                        element={
                            <PlanFeatureGate
                                feature="goals"
                                title="A aba de metas exige assinatura"
                                description="As metas inteligentes ficam disponiveis somente com plano premium ativo. Assine para desbloquear."
                            >
                                <Goals />
                            </PlanFeatureGate>
                        }
                    />
                    <Route path="plans" element={<Plans />} />
                </Route>
            </Route>

            {/* Catch all */}
            <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
        </Routes>
    );
}
