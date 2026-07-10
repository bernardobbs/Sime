#!/usr/bin/env bash
# Roda toda a suíte Playwright do SIME. Sobe um servidor HTTP estático na raiz
# do repo (os testes carregam os módulos via http://localhost:8917/modules/...),
# executa cada test_*.mjs, agrega o resultado e retorna exit != 0 se qualquer
# suíte falhar. Uso: bash tests/run_all.sh  (de qualquer diretório).
set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$TESTS_DIR/.." && pwd)"
PORT="${SIME_TEST_PORT:-8917}"

# ── Dependências: playwright + @supabase/supabase-js ──
# Em CI: `npm ci`/`npm install` popula tests/node_modules — se já existir, é o
# que vale. Localmente, se os pacotes estiverem espalhados em globals/caches,
# monta um node_modules real symlinkando cada pacote encontrado (evita
# reinstalar quando já há Playwright global, etc.).
need_pkg() { [ ! -e "$TESTS_DIR/node_modules/$1" ]; }
localizar() {
  # imprime o diretório do pacote $1 procurando em roots conhecidos + find raso
  for cand in /opt/node22/lib/node_modules /usr/lib/node_modules /usr/local/lib/node_modules; do
    [ -e "$cand/$1" ] && { echo "$cand/$1"; return; }
  done
  find /tmp /home -maxdepth 7 -type d -path "*/node_modules/$1" 2>/dev/null | head -1
}
link_pkg() {
  local pkg="$1" src; src="$(localizar "$pkg")"
  [ -z "$src" ] && return 1
  mkdir -p "$TESTS_DIR/node_modules/$(dirname "$pkg")"
  ln -sfn "$src" "$TESTS_DIR/node_modules/$pkg"
}
if need_pkg playwright || need_pkg @supabase/supabase-js; then
  faltou=""
  for pkg in playwright @supabase/supabase-js; do
    need_pkg "$pkg" && { link_pkg "$pkg" || faltou="$faltou $pkg"; }
  done
  if [ -n "$faltou" ]; then
    echo "⚠ pacotes não encontrados:$faltou — rode: (cd tests && npm install)"; exit 2
  fi
fi

# ── Servidor HTTP estático (cwd = raiz do repo) ──
( cd "$ROOT" && exec python3 -m http.server "$PORT" ) >/tmp/sime_test_http.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT
# espera o servidor subir
for _ in $(seq 1 20); do
  curl -s -o /dev/null "http://localhost:$PORT/modules/SIME_admin.html" && break
  sleep 0.3
done

# ── Roda cada suíte ──
pass=0; fail=0; falhas=""
for f in "$TESTS_DIR"/test_*.mjs; do
  nome="$(basename "$f")"
  if ( cd "$TESTS_DIR" && node "$nome" >/tmp/sime_test_out.log 2>&1 ); then
    echo "PASS  $nome"; pass=$((pass+1))
  else
    echo "FAIL  $nome"; tail -5 /tmp/sime_test_out.log | sed 's/^/      /'
    fail=$((fail+1)); falhas="$falhas $nome"
  fi
done

echo ""
echo "════════════════════════════════════════"
echo "  $pass suítes OK, $fail com falha"
[ -n "$falhas" ] && echo "  Falharam:$falhas"
echo "════════════════════════════════════════"
[ "$fail" -eq 0 ]
