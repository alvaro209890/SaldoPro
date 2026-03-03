import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './admin.css';

// Atualiza a página automaticamente quando um chunk dinâmico falha ao carregar
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
