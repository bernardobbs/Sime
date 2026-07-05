# SIME — Sistema de Monitoramento Eleitoral

Sistema auxiliar de **observabilidade operacional** para a **7ª Zona Eleitoral do Piauí**
(Campo Maior, Jatobá do Piauí e Sigefredo Pacheco). **Não substitui** nenhum processo
oficial da Justiça Eleitoral.

- **174 seções** · 63 locais de votação · 34.967 eleitores · 12 rotas de distribuição
- **Eleição:** 4 de outubro de 2026
- **Custo de infraestrutura:** R$ 0,00/mês (Supabase Free + Vercel Hobby + Oracle Always Free)

## Estrutura

```
modules/   16 módulos HTML (HTML+JS puro, sem build) — um por papel/fase
sql/       schema Supabase, notificações WhatsApp e triggers do Hermes
api/       função serverless (Vercel) que recebe eventos do Hermes
hermes/    skills do agente de WhatsApp (Oracle Cloud) + setup
docs/      documentação de apoio
CLAUDE.md  documentação completa da arquitetura
```

## Início rápido (homologação local)

```bash
python3 -m http.server 8080
# Painel de entrada:
open http://localhost:8080/modules/SIME_principal.html
```

Na fase atual (homologação) os dados ficam em **localStorage** — sem backend. Cada módulo
grava/lê chaves compartilhadas (ver "CHAVES localStorage" no `CLAUDE.md`).

## Papéis e acesso

- **Cartório (admin):** `SIME_admin.html` — perfis com escopo (Coordenador, Monitor, Gestor
  de Problemas/Distribuição, Observador, Coord. de Motoristas, Coord. de Acessibilidade,
  Coletor de Mídias).
- **Campo (QR Code + PIN):** mesário, motorista, conferente, instalador, coordenador de
  preparação e **acessibilidade**. Os tokens são gerados em `SIME_tokens.html`
  (por rota, ou por local no caso da acessibilidade).
- **Telões (TV):** `SIME_tv_dia`, `SIME_tv_vespera`, `SIME_tv_distribuicao`, `SIME_tv_preparacao`.

## Banco de dados (produção — Supabase)

Executar os scripts **nesta ordem** no SQL Editor do Supabase:

```
1. sql/SIME_schema.sql            -- tabelas, RPCs, RLS por zona, seed inicial
2. sql/SIME_whatsapp_schema.sql   -- fila de notificações + triggers
3. sql/SIME_hermes_trigger.sql    -- triggers para o Hermes
```

Requer as extensões `uuid-ossp` e `pg_trgm` (criadas pelo próprio schema). **RLS está ativo
em todas as tabelas** (isolamento por zona via `sime_user_zona()`); o acesso de campo por
QR/PIN é feito por Edge Function/`service_role`. Sempre use `sime_now()` para timestamps —
nunca o relógio do dispositivo.

## Deploy (produção)

```bash
npm install -g vercel
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add HERMES_URL
vercel env add HERMES_WEBHOOK_SECRET
vercel --prod
```

## Status

**Pronto (homologação, localStorage):** todos os 16 módulos, incluindo o de
**acessibilidade**; perfis com escopo e integração da acessibilidade no Admin e no TV Dia;
enum de atores; tokens por local; schema SQL com **RLS por zona** (validado em PostgreSQL 16).

**Em andamento / pendente:** ver a seção "Pendências" abaixo e os "MÓDULOS PENDENTES" no
`CLAUDE.md` (migração localStorage→Supabase, Supabase Auth, Realtime nos TVs, Edge Function
de WhatsApp, geração dos QR Codes).

## Documentação completa
Arquitetura, papéis, chaves de dados, RPCs e cronograma: veja **`CLAUDE.md`** na raiz.
