#!/usr/bin/env bash
# Abre a tela do jogo em tela cheia (modo quiosque) com som liberado. Uso: scripts/kiosk.sh [porta]
PORT="${1:-3000}"
BROWSER="$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser)"
[ -z "$BROWSER" ] && { echo "Chrome/Chromium não encontrado"; exit 1; }
# --disable-gpu-process-crash-limit: por padrão, após 3 quedas do driver o Chrome desliga a GPU até ser fechado (WebGL some)
exec "$BROWSER" --kiosk --autoplay-policy=no-user-gesture-required --disable-gpu-process-crash-limit --ignore-gpu-blocklist --disable-features=TranslateUI --noerrdialogs --user-data-dir=/tmp/ovni-kiosk "http://localhost:$PORT/"
