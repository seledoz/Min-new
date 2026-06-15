# Instrucoes para agentes de codigo (opencode / Claude Code)

## Versionamento

- A versao atual deve estar SEMPRE visivel no README.md (linha 3).
- A versao e definida em `src/version.js` no campo `number`.
- Ao alterar a versao, atualize `src/version.js` E o README.md no mesmo commit.
- O formato e `X.Y.Z` (ex: `0.3.2`).

## Build

- Para rebuildar o bundle apos alterar `src/`, execute `./build.sh`.
- O build.sh injeta branch, commit e data automaticamente no bundle.
- SEMPRE execute o build.sh antes de commitar mudancas no codigo fonte.
- O arquivo `pz-bot.js` e o bundle final que vai para o GitHub.

## Commits

- Commitar APENAS quando o usuario solicitar explicitamente.
- Mensagens de commit em portugues, descritivas.

## Branch

- A branch atual de trabalho e `features/fecras-path`.
