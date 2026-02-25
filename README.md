# SaldoPro

Controle financeiro pessoal inteligente, construído com React 19, Vite 6, TailwindCSS v4 e Firebase. Apresenta um tema escuro premium e design responsivo mobile-first.

## Stack Tecnológico

- **Frontend**: React 19, TypeScript, React Router v7, React Hook Form, Zod
- **Build & Estilos**: Vite 6, TailwindCSS v4 (@tailwindcss/postcss), Lucide React
- **Gráficos e UI**: Recharts, Sonner (Toasts)
- **Backend/BaaS**: Firebase 11 (Auth: Email/Senha, Firestore: Banco de Dados em Tempo Real)

## Pré-requisitos

- Node.js (v18+)
- Conta no Firebase (Projeto criado)

## Configuração do Firebase

1. Acesse o [Console do Firebase](https://console.firebase.google.com/) e crie um novo projeto.
2. Ative a **Autenticação** (provedor Email/Senha).
3. Ative o **Firestore Database** (Localização: `southamerica-east1` ou sua preferência).
4. No Firestore, vá em **Índices** -> **Compostos** e crie o seguinte índice:
   - Coleção: `transactions`
   - Campos: `monthKey` (Ascendente), `date` (Decrescente)
5. Modifique ou aplique as regras de segurança presentes no arquivo `firestore.rules`.
6. Adicione um App Web nas configurações do projeto e copie as chaves de configuração.

## Instalação e Execução

1. Clone ou faça o download deste diretório.
2. Copie o arquivo `.env.example` para `.env` e preencha as variáveis com as chaves do seu projeto Firebase.
3. Instale as dependências:
   ```bash
   npm install
   ```
4. Execute o servidor de desenvolvimento:
   ```bash
   npm run dev
   ```
5. Acesse `http://localhost:5173`.

## Funcionalidades Implementadas

- **Autenticação Segura**: Registro (cria perfil inicial e planta categorias padrão), login e recuperação de senha.
- **Dashboard Dinâmico**: Resumo de receitas, despesas, saldo e barra de alerta de orçamento integrado com gráficos (linha temporal de saldos acumulados e gráfico de pizza de despesas).
- **Lista de Transações**: Grids filtráveis por texto, tipo, categoria, data e valor, ordenados por data ou valor.
- **Gestão de Categorias**: Cores dedicadas e grid de ícones (Lucide) para personalizar despesas e receitas visuais com exclusão inteligente.
- **Relatórios Resumo**: Totais organizados por tabela, contagem detalhada, percentuais categorizados e método de pagamento com opção nativa para baixar arquivos `.csv`.
- **Preferências Visuais**: Dark mode exclusivo nativo, configurador de orçamento global de proteção.
