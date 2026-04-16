#!/usr/bin/env bash
set -euo pipefail

: "${SALDOPRO_REPO_DIR:?SALDOPRO_REPO_DIR ausente}"
NODE_BIN="${NODE_BIN:-/home/server/.nvm/versions/node/v20.20.0/bin/node}"
NPM_BIN="${NPM_BIN:-/home/server/.nvm/versions/node/v20.20.0/bin/npm}"
BACKEND_DIR="${SALDOPRO_REPO_DIR}/backend"
export PATH="$(dirname "${NODE_BIN}"):${PATH}"

if [[ ! -x "${NODE_BIN}" ]]; then
  echo "node nao encontrado em ${NODE_BIN}" >&2
  exit 127
fi

if [[ ! -x "${NPM_BIN}" ]]; then
  echo "npm nao encontrado em ${NPM_BIN}" >&2
  exit 127
fi

mkdir -p "${WHATSAPP_AUTH_DIR}" "${WHATSAPP_AUTH_DIR_WA1}"
cd "${BACKEND_DIR}"
"${NPM_BIN}" run build
exec "${NODE_BIN}" dist/server.js
