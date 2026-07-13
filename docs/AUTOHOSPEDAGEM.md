# SIME — Rodar sua própria cópia (Vercel + Supabase)

Guia para outra pessoa/zona subir o SIME na **sua própria** conta Vercel + Supabase,
independente da instância da 7ª Zona. Tudo no plano **gratuito** (custo R$ 0).

> Requer: conta **GitHub**, conta **Vercel** (Hobby), conta **Supabase** (Free).
> Tempo estimado: ~1 hora.

---

## Visão geral (o que você vai configurar)

1. Fork do repositório
2. Criar projeto Supabase e aplicar o schema (SQL)
3. Deploy das 2 Edge Functions + o segredo `SIME_JWT_SECRET`
4. Trocar a config do Supabase nos arquivos do front (15 arquivos)
5. Deploy no Vercel
6. Semear os dados da sua zona + criar o admin
7. Gerar tokens/QR

---

## 1. Fork do repositório
- No GitHub, **Fork** deste repositório para a sua conta (ou clone e crie um novo repo).

## 2. Criar o projeto Supabase e aplicar o schema
1. Em https://supabase.com → **New project** (região mais próxima, ex.: `sa-east-1`).
   Guarde a **senha do banco**.
2. No **SQL Editor**, rode os arquivos da pasta `sql/` **nesta ordem**:
   1. `sql/SIME_schema.sql`  (tabelas, RLS, funções, RPCs)
   2. `sql/SIME_whatsapp_schema.sql`  (notificações — opcional se não usar WhatsApp)
   3. `sql/SIME_hermes_trigger.sql`  (triggers do Hermes — opcional)
   4. `sql/SIME_hardening.sql`  (segurança — **rode por último**)
   - Cole o conteúdo de cada um e execute. São idempotentes.
3. Em **Authentication → Providers → Email**: deixe habilitado (login de admin por e-mail/senha).
   Em **Authentication → Settings**: ligue *"Leaked password protection"*.

## 3. Edge Functions + segredo JWT
As funções ficam em `supabase/functions/`. Faça o deploy pela **CLI do Supabase**
ou colando no dashboard (**Edge Functions → Create function**).

Faça deploy de **duas** funções, ambas com **verify_jwt DESLIGADO**:
- **`sime-login`** — arquivos `index.ts` + `jwt.ts` (login de campo/TV: token→JWT).
- **`sime-admin-user`** — arquivo `index.ts` (cria login de membro da equipe).

Depois, o segredo **crítico**:
- Copie o **JWT secret do projeto**: `Project Settings → API → JWT Settings → JWT Secret`
  (se só houver as chaves novas, exiba o *Legacy JWT Secret*).
- Cadastre em `Project Settings → Edge Functions → Secrets`:
  **Nome:** `SIME_JWT_SECRET` (não use prefixo `SUPABASE_`) · **Valor:** o segredo copiado.
- Sem isso, campo/TV autenticam mas a RLS rejeita o JWT.

## 4. Trocar a config do Supabase no front (15 arquivos)
Os módulos trazem a URL e a **anon key** embutidas (a anon key é pública por design).
Pegue os valores em `Project Settings → API`:
- **Project URL** (`https://SEU_REF.supabase.co`)
- **anon public key** (`eyJ...`)

Troque em **todos os 15 arquivos** de `modules/*.html` que têm `SIME_CONFIG`.
Um jeito rápido (na raiz do repo, ajuste os valores):
```bash
grep -rl "supabaseUrl:" modules/*.html | xargs sed -i \
  -e "s#https://unjhnlcmxbrlonppchux.supabase.co#https://SEU_REF.supabase.co#g" \
  -e "s#eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9._-]*#SUA_ANON_KEY#g"
```
(arquivos: SIME_admin, SIME_relatorios, SIME_tokens, SIME_mesario, SIME_motorista,
SIME_conferente, SIME_instalador, SIME_midias, SIME_acessibilidade,
SIME_coordenador_preparacao, e as 5 TVs.)
Commit e push.

> Nota: hoje a config é duplicada nos 15 arquivos. Se preferir centralizar num único
> `modules/sime_config.js` importado por todos, dá para refatorar — reduz esse passo a 1 arquivo.

## 5. Deploy no Vercel
1. Em https://vercel.com → **Add New → Project** → importe seu fork.
2. Framework: **Other** (é HTML estático, sem build). Root: a raiz do repo.
3. O `vercel.json` já cuida do redirect de `/` para o Admin.
4. (Só se for usar o Hermes/WhatsApp) em **Settings → Environment Variables** defina:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HERMES_URL`, `HERMES_WEBHOOK_SECRET`
   (usados por `api/hermes-update.js`). Sem Hermes, pode pular.
5. **Deploy**. Sua instância fica em `https://SEU-PROJETO.vercel.app`.

## 6. Semear os dados da sua zona + criar o admin
No **SQL Editor** do seu Supabase:
1. **Zona + eleição:** insira uma linha em `sime_zonas` (numero, nome, estado) e uma em
   `sime_eleicoes` (zona_id, turno, data_d, `ativa=true`).
2. **Seções e rotas:** insira em `sime_secoes` (numero, local_nome, municipio, eleitores,
   zona_id) e `sime_rotas` (codigo, nome, municipios, itinerario, urnas_estimadas, zona_id);
   ligue cada seção à rota via `sime_secoes.rota_id`.
   *(Dica: depois de logar como admin, dá para fazer isso pela tela **Gerenciar seções**.)*
3. **Admin:** crie o usuário de Auth e vincule em `sime_usuarios`:
   - `Authentication → Users → Add user` (email + senha, *Auto Confirm*).
   - Pegue o `id` desse usuário e insira em `sime_usuarios`:
     `nome`, `email`, `perfil='coordenador'` (ou `super_admin`), `zona_id`, `auth_user_id=<id>`, `ativo=true`.
4. Agora você loga no Admin com esse e-mail/senha. Os demais membros você cria pela
   aba **Equipe** (cada um sai com senha temporária).

## 7. Gerar tokens/QR de campo
- Abra `…/modules/SIME_tokens.html`, logado, e gere os tokens (mesário, motorista,
  conferente, instalador, acessibilidade, e 1 de **tv**). Imprima os QR + PIN.
- Aponte cada TV para `…/modules/SIME_tv_dia.html?tv_token=<TOKEN_TV>` (a sessão fica salva).

---

## Checklist final (smoke)
- [ ] Login de admin funciona (e-mail/senha).
- [ ] `SIME_tv_dia.html?tv_token=…` sai do fallback e mostra dados reais.
- [ ] Mesário loga por QR+PIN e a ação aparece na TV Dia (Realtime).
- [ ] Relatórios mostram a sua zona.
> Ver `docs/ROTEIRO_DE_TESTE.md` para o teste completo e `docs/CONFIGURACAO_GO_LIVE.md`
> para detalhes de cada passo de configuração.

## Observações
- **Isolamento multi-zona:** a RLS já separa por zona. Você pode ter várias zonas na mesma
  instância; cada admin só vê a sua (um `super_admin` vê todas).
- **Pausa do plano grátis:** o Supabase pausa após ~7 dias sem atividade. Para produção
  contínua, considere o plano **Pro** ou garanta tráfego regular.
- **Hermes (WhatsApp):** é opcional e roda fora (Oracle Cloud). Sem ele, o sistema funciona
  normalmente, só não envia notificações automáticas.
- **Sem segredos no front:** a anon key é pública; **nunca** coloque a `service_role` key
  nos arquivos de `modules/` — ela só vive em variáveis de ambiente do servidor (Vercel).
