import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';

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
                    <Route path="ai" element={<AIAssistant />} />
                    <Route path="reminders" element={<Reminders />} />
                    <Route path="recurring" element={<RecurringTransactions />} />
                    <Route path="documents" element={<Documents />} />
                    <Route path="goals" element={<Goals />} />
                    <Route path="plans" element={<Navigate to="/app/dashboard" replace />} />
                </Route>
            </Route>

            {/* Catch all */}
            <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
        </Routes>
    );
}
