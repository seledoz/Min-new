#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# git-flow.sh — bump + build + commit + push padronizado
#
# Uso:
#   ./git-flow.sh "mensagem"                 bump patch + build + commit + push
#   ./git-flow.sh --minor "mensagem"         bump minor
#   ./git-flow.sh --major "mensagem"         bump major
#   ./git-flow.sh --release "mensagem"       bump minor + tag (apenas em main)
# ============================================================

VERSION_FILE="src/version.js"

die() { echo "ERRO: $*" >&2; exit 1; }
info() { echo "==> $*"; }

read_version() {
  grep -E '^\s+number:' "$VERSION_FILE" \
    | sed 's/.*"\([0-9.]*\)".*/\1/'
}

write_version() {
  sed -i "s/^\(  number: \)\"[0-9.]*\"/\1\"$1\"/" "$VERSION_FILE"
}

bump_version() {
  local v="$1" t="$2" ma mi pa
  IFS='.' read -r ma mi pa <<< "$v"
  case "$t" in
    patch) echo "$ma.$mi.$((pa + 1))" ;;
    minor) echo "$ma.$((mi + 1)).0" ;;
    major) echo "$((ma + 1)).0.0" ;;
  esac
}

# ---- argumentos ----

TYPE="patch"
MESSAGE=""
RELEASE=false

case "${1:-}" in
  --minor)   TYPE="minor";    shift ;;
  --major)   TYPE="major";    shift ;;
  --release) TYPE="minor";    RELEASE=true; shift ;;
esac

MESSAGE="${*:?Uso: git-flow.sh [--minor|--major|--release] \"mensagem\"}"

# ---- validacao de branch ----

BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [ "$BRANCH" = "main" ] && [ "$RELEASE" = false ]; then
  die "em 'main' use --release, ou crie uma branch feature/test primeiro"
fi

if [ "$BRANCH" = "main" ] && [ "$RELEASE" = true ]; then
  info "modo release em main"
fi

# ---- bump ----

CURRENT=$(read_version)
[ -z "$CURRENT" ] && die "nao foi possivel ler a versao em $VERSION_FILE"
NEW=$(bump_version "$CURRENT" "$TYPE")
info "versao: $CURRENT -> $NEW"
write_version "$NEW"

# ---- build ----

./build.sh

# ---- commit ----

git add -A
git commit -m "bump version $NEW ($MESSAGE)"

# ---- push ----

if [ "$RELEASE" = true ]; then
  git tag -a "v$NEW" -m "release $NEW: $MESSAGE"
  git push origin "$BRANCH"
  git push origin "v$NEW"
  info "release v$NEW publicada em $BRANCH"
else
  git push origin "$BRANCH"
  info "commit enviado para $BRANCH"
fi
