import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './hooks/useAuth';
import { App } from './App';
import './index.css';

// Atualiza a página automaticamente quando um chunk dinâmico falha ao carregar
// devido a um novo deploy que substitui os hashes dos arquivos originais
window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <BrowserRouter>
            <AuthProvider>
                <App />
                <Toaster theme="dark" position="bottom-right" richColors />
            </AuthProvider>
        </BrowserRouter>
    </React.StrictMode>
);
