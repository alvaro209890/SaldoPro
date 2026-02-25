import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';

// Pages
import { Login } from '@/pages/Login';
import { Register } from '@/pages/Register';
import { ResetPassword } from '@/pages/ResetPassword';

// Placeholders for inner pages
const Dashboard = () => <div className="p-8 text-white"><h1 className="text-2xl font-bold">Dashboard</h1></div>;
const Transactions = () => <div className="p-8 text-white"><h1 className="text-2xl font-bold">Transações</h1></div>;
const Categories = () => <div className="p-8 text-white"><h1 className="text-2xl font-bold">Categorias</h1></div>;
const Reports = () => <div className="p-8 text-white"><h1 className="text-2xl font-bold">Relatórios</h1></div>;
const Settings = () => <div className="p-8 text-white"><h1 className="text-2xl font-bold">Configurações</h1></div>;

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
                </Route>
            </Route>

            {/* Catch all */}
            <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
        </Routes>
    );
}
