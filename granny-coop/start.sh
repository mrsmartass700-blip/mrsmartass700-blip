#!/usr/bin/env sh
# Запуск сервера на Linux/macOS
cd "$(dirname "$0")" && exec node server/index.js "$@"
