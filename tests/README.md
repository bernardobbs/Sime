# Testes — SIME

Suíte de testes de integração em [Playwright](https://playwright.dev) (headless
Chromium) cobrindo os 16 módulos, login (admin + campo + TV), RLS multi-zona,
Realtime, fila offline e as RPCs. São 26 arquivos `test_*.mjs`, ~330 asserções.

## Rodar tudo

```bash
bash tests/run_all.sh
```

O script sobe um servidor HTTP estático na raiz do repo (porta 8917 por padrão,
ou `SIME_TEST_PORT`), roda cada suíte, agrega o resultado e retorna exit ≠ 0 se
qualquer uma falhar.

## Pré-requisitos

- **Node ≥ 22** (os testes usam recursos de ESM + strip de tipos para importar o
  `jwt.ts` de produção sem transpilar).
- **Playwright + Chromium.** Em CI: `cd tests && npm install`. Localmente, se o
  Playwright já estiver instalado globalmente, o `run_all.sh` symlinka
  `tests/node_modules` para o global automaticamente — não precisa reinstalar.
- **python3** (para o servidor HTTP estático).

## Rodar uma suíte isolada

```bash
# sobe o servidor manualmente (cwd = raiz do repo)
python3 -m http.server 8917 &
cd tests && node test_mesario.mjs
```

## O que cada grupo cobre

| Arquivo | Cobre |
|---|---|
| `test_mesario`, `test_conferente`, `test_motorista`, `test_instalador`, `test_midias`, `test_acessibilidade` | Módulos de campo: login token+PIN, escrita via RPC, fila offline |
| `test_admin_login`, `test_admin_empresas`, `test_admin_super` | Admin: login Supabase Auth, escopo por empresa, super_admin/aba Zonas |
| `test_tv_dia`, `test_tv_vespera`, `test_tv_distribuicao`, `test_paineis`, `test_tv_preparacao` + `*_realtime` | TVs: token-TV, dado zona-scoped, Realtime |
| `test_tokens`, `test_tokens_massa` | Geração de tokens (manual + em massa) |
| `test_sime_dados`, `test_sime_login_jwt`, `test_campo_shared` | Camadas compartilhadas (dados, JWT, auth de campo) |
| `test_hermes` | Handler multi-zona do `api/hermes-update.js` |
| `test_coord_prep`, `test_integ`, `test_midias_rodape` | Coordenador de preparação, integração cross-módulo, rodapé WhatsApp por município |

## Smoke test contra produção

`smoke_prod.mjs` é separado: valida o Supabase **real** (login admin/campo, RLS,
RPC, Realtime). Não roda neste sandbox (rede bloqueada para `*.supabase.co`) —
ver cabeçalho do arquivo para as variáveis de ambiente e uso em CI.
