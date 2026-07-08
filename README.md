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
           + sime_dados.js (camada de dados zona-scoped) e sime_tv_auth.js
           (bootstrap de sessão das TVs)
sql/       schema Supabase, notificações WhatsApp e triggers do Hermes
api/       função serverless (Vercel) que recebe eventos do Hermes
supabase/  Edge Function sime-login (troca token → sessão JWT)
hermes/    skills do agente de WhatsApp (Oracle Cloud) + setup
docs/      documentação de apoio
CLAUDE.md  documentação completa da arquitetura
```

**Arquitetura multi-zona (em migração):** o SIME está evoluindo de single-tenant
(7ª Zona fixa) para um modelo SaaS onde uma única instância (1 Vercel + 1 Supabase)
atende várias zonas eleitorais, isoladas por RLS. Progresso: RLS com `super_admin`
cross-zona (feito), camada de dados `sime_dados.js` + login real no Admin/TVs
(feito), JWT de campo pro QR+PIN dos demais módulos (pendente).

## Início rápido (homologação local)

```bash
python3 -m http.server 8080
# Painel de entrada:
open http://localhost:8080/modules/SIME_principal.html
```

Na fase atual (homologação) os dados ficam em **localStorage** — sem backend. Cada módulo
grava/lê chaves compartilhadas (ver "CHAVES localStorage" no `CLAUDE.md`).

## Papéis e acesso

- **Cartório (admin):** `SIME_admin.html`/`SIME_coordenador_preparacao.html` — login real
  (e-mail/senha via Supabase Auth), com saída "continuar offline" sempre disponível
  (plano de contingência). Perfis com escopo (Coordenador, Monitor, Gestor de
  Problemas/Distribuição, Observador, Coord. de Motoristas, Coord. de Acessibilidade,
  Coletor de Mídias).
- **Campo (QR Code + PIN):** mesário, motorista, conferente, instalador, coordenador de
  preparação e **acessibilidade**. Os tokens são gerados em `SIME_tokens.html`
  (por rota, ou por local no caso da acessibilidade). Ainda em `localStorage` — a
  troca de token por sessão real (Edge Function `sime-login`) é a próxima fase.
- **Telões (TV):** `SIME_tv_dia`, `SIME_tv_vespera`, `SIME_tv_distribuicao`,
  `SIME_tv_preparacao`, `SIME_paineis` — autenticam via um token de longa duração
  (`?tv_token=`, tipo `'tv'` em `sime_tokens`), trocado uma vez por sessão persistida
  em localStorage.

## Banco de dados (produção — Supabase)

Executar os scripts **nesta ordem** no SQL Editor do Supabase:

```
1. sql/SIME_schema.sql            -- tabelas, RPCs, RLS por zona, seed inicial
2. sql/SIME_whatsapp_schema.sql   -- fila de notificações + triggers
3. sql/SIME_hermes_trigger.sql    -- triggers para o Hermes
```

Requer as extensões `uuid-ossp` e `pg_trgm` (criadas pelo próprio schema). **RLS está ativo
em todas as tabelas** (isolamento por zona via `sime_user_zona()`/`sime_zona_visivel()`,
com bypass para o perfil `super_admin`); o acesso de campo por QR/PIN e das TVs por token
é feito pela Edge Function `supabase/functions/sime-login` (troca token → JWT), que
`service_role` também usa para provisionar o usuário na primeira troca. Sempre use
`sime_now()` para timestamps — nunca o relógio do dispositivo.

Depois de rodar o schema, faça o deploy da Edge Function e configure o segredo de
assinatura (o nome NÃO pode começar com `SUPABASE_` — o Supabase reserva esse prefixo
para os secrets automáticos da plataforma):

```bash
supabase functions deploy sime-login
supabase secrets set SIME_JWT_SECRET=<valor de Settings → API → JWT Settings → JWT Secret>
```

## Deploy (produção)

```bash
npm install -g vercel
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add HERMES_URL
vercel env add HERMES_SECRET_ZONA_<numero>   # uma por zona provisionada
vercel --prod
```

Além das env vars do Vercel (usadas só pela API serverless), os 7 módulos que ganharam
integração real com o Supabase (as 5 TVs + `SIME_admin.html` +
`SIME_coordenador_preparacao.html`) têm um `SIME_CONFIG` embutido no próprio HTML —
`supabaseUrl`/`supabaseAnonKey` públicos, não são env vars server-side. Substitua o
placeholder `SEU_PROJETO.supabase.co`/`SUA_ANON_KEY` pelos valores reais do projeto antes
de considerar o deploy completo.

## Status

**Pronto (produção, Supabase):** RLS multi-zona com `super_admin` cross-zona; camada de
dados zona-scoped `modules/sime_dados.js`; Edge Function `sime-login` (token → JWT,
compartilhada entre TVs e, na próxima fase, campo); login real (e-mail/senha) no Admin e
Coordenador de Preparação, com saída offline explícita; as 5 TVs consumindo dado real via
token de longa duração.

**Pronto (homologação, localStorage):** os módulos de campo (mesário, motorista,
conferente, instalador, acessibilidade) e mídias — ainda sem sessão Supabase real.

**Em andamento / pendente:**
- Preencher `SIME_CONFIG` real (URL/anon key) nos 7 arquivos migrados — hoje com placeholder.
- Seed de produção da 7ª Zona real (bloqueado numa revisão de CSV pendente).
- JWT de campo: plugar os módulos de campo na Edge Function `sime-login` (mesmo mecanismo
  já usado pelas TVs).
- Ver "MÓDULOS PENDENTES" no `CLAUDE.md` para o restante (Realtime nos TVs, Edge Function
  de WhatsApp, geração dos QR Codes).

## Documentação completa
Arquitetura, papéis, chaves de dados, RPCs e cronograma: veja **`CLAUDE.md`** na raiz.
