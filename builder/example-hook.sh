#!/bin/bash
# Exemplo de git post-commit hook para rebuild automático do vault.
#
# Copiar para: <pasta-do-vault>/.git/hooks/post-commit
# Tornar executável: chmod +x .git/hooks/post-commit
#
# Ajustar VAULT_VIEWER_DIR e VAULT_SLUG conforme seu ambiente.

VAULT_VIEWER_DIR="E:/Code/JS/vault-viewer"
VAULT_SLUG="drachegotter"

echo "[post-commit] Rebuilding vault '${VAULT_SLUG}'..."
cd "$VAULT_VIEWER_DIR" && npx tsx builder/index.ts --vault "$VAULT_SLUG"
echo "[post-commit] Done."
