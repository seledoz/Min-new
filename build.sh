#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Script de build — concatena os modulos em pz-bot.js
#
# Antes da concatenacao, processa src/version.js para
# injetar as informacoes do git (branch, commit, data).
# ============================================================

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "unknown")

sed "s|%%BRANCH%%|$BRANCH|g; s|%%COMMIT%%|$COMMIT|g; s|%%DATE%%|$DATE|g" src/version.js > /tmp/version_processed.js

cat \
  /tmp/version_processed.js \
  src/core.js \
  src/modules/pz.js \
  src/modules/xray.js \
  src/modules/panic.js \
  src/modules/rune.js \
  src/modules/heal.js \
  src/modules/auto-invisible.js \
  src/modules/auto-magic-shield.js \
  src/modules/auto-attack.js \
  src/modules/auto-attack-exclude.js \
  src/modules/auto-attack-aoe.js \
  src/modules/red-text-alert.js \
  src/modules/cave.js \
  src/modules/cave-forward-loop.js \
  src/modules/cave-arrow-keys.js \
  src/modules/equip-ring.js \
  src/modules/auto-eat.js \
  src/modules/talk.js \
  src/ui/panel.js \
  src/main.js \
  > pz-bot.js

rm /tmp/version_processed.js
