# SIME — Configuração para os primeiros testes / go-live

Estado do código: **completo** (16 módulos, login real, RLS multi-zona, Realtime,
relatórios, CRUD de seções, fila offline, QR codes). Banco: **2 eleições ativas
(7ª e 94ª), 276 tokens, 3 admins, segurança do linter zerada**. O que falta é
**configuração de painel** (fora do código). Este documento cobre exatamente isso.

Projeto Supabase: `unjhnlcmxbrlonppchux` → `https://unjhnlcmxbrlonppchux.supabase.co`
App (produção): `https://sime-cyan.vercel.app` (raiz redireciona para o Admin).

---

## 1. 🔴 BLOQUEADOR — `SIME_JWT_SECRET` na Edge Function (destrava campo + TV)

Sem isso, o login de campo/TV até autentica, mas o JWT emitido **não é aceito pela
RLS** — mesário/motorista/TV não leem nem gravam de verdade. É o único item que
trava o teste ponta a ponta.

**Por quê:** a Edge Function `sime-login` assina o JWT em HS256. Para o Supabase
aceitar esse JWT, o segredo usado precisa ser **o mesmo JWT secret do projeto**.

**Passos (Dashboard Supabase):**
1. **Copiar o JWT secret do projeto:**
   `Project Settings → API → JWT Settings → JWT Secret` → botão *Reveal* → copiar.
   - Se o projeto só mostrar "JWT Signing Keys" (chaves assimétricas novas),
     habilite/exiba o **Legacy JWT Secret** (shared secret HS256) — é esse valor.
2. **Cadastrar como secret das Edge Functions:**
   `Project Settings → Edge Functions → Secrets` (ou `Edge Functions → Manage secrets`)
   → *Add new secret*:
   - **Name:** `SIME_JWT_SECRET`  ← (NÃO pode ter prefixo `SUPABASE_`; é reservado)
   - **Value:** o JWT secret copiado no passo 1.
3. Salvar. Não precisa redeploy — o secret é lido a cada invocação.

**Verificar:** abrir `https://sime-cyan.vercel.app/modules/SIME_tv_dia.html?tv_token=<TOKEN_TV>`
(o token de TV já existe no banco — pegue em `SIME_tokens.html`, tipo *tv*).
Se a TV sair do fallback e mostrar dados reais da zona, o segredo está certo.

---

## 2. 🟢 Apontar cada TV para seu token (operacional, rápido)

Cada monitor de TV é uma URL aberta **uma vez** com `?tv_token=` — a sessão fica
salva no `localStorage` do aparelho e se renova sozinha (token de TV dura ~90 dias).

| Painel | URL (trocar `<TOKEN_TV>`) |
|---|---|
| TV Dia | `…/modules/SIME_tv_dia.html?tv_token=<TOKEN_TV>` |
| TV Véspera | `…/modules/SIME_tv_vespera.html?tv_token=<TOKEN_TV>` |
| TV Distribuição | `…/modules/SIME_tv_distribuicao.html?tv_token=<TOKEN_TV>` |
| TV Preparação | `…/modules/SIME_tv_preparacao.html?tv_token=<TOKEN_TV>` |
| Painéis | `…/modules/SIME_paineis.html?tv_token=<TOKEN_TV>` |

- Existe **1 token de TV** (zona 7). Para mais zonas/monitores, gere em
  `SIME_tokens.html` (tipo *tv* — 1 por zona basta; o mesmo pode abrir todas as TVs
  daquela zona).
- Depois da primeira abertura, pode remover o `?tv_token=` da URL (a sessão já está
  guardada) — mas manter não faz mal.

---

## 3. 🟡 Qualidade de segurança (Dashboard — 1 clique)

- **Proteção contra senha vazada:** `Authentication → Policies/Settings → Password`
  → habilitar *"Leaked password protection"* (checa HaveIBeenPwned). Único WARN de
  segurança que sobra e que vale ligar antes de produção.

---

## 4. 🟡 (Opcional) SMTP — "Esqueci minha senha" por e-mail

O reset **pelo admin** (botão 🔑 na aba Equipe) já funciona sem isso. O
autoatendimento por e-mail só entrega quando houver SMTP:
- `Authentication → SMTP Settings` → configurar um provedor (ex.: Resend, Brevo,
  SendGrid — todos têm plano free). Depois, o link "Esqueci minha senha" na tela de
  login passa a enviar o e-mail de redefinição.

---

## 5. ⚪ Lembretes operacionais (não são código)

- Trocar as senhas temporárias iniciais das 3 contas (`bernardobs`, `chronos`,
  `maria.gomes`) — hoje `Sime@2026`. (Você optou por deixar por ora.)
- 94ª Zona: as 98 seções ainda estão **sem rota** — o admin da 94ª faz o mapeamento
  seção→rota (pela aba *Gerenciar seções* ou via importação).
- Imprimir os QR codes (`SIME_tokens.html → Imprimir todos`).
- Hermes (WhatsApp): decidir validar ou cortar — hoje não é necessário para os
  testes; a operação segue sem ele.

---

## Ordem recomendada para o primeiro teste ponta a ponta

1. Configurar `SIME_JWT_SECRET` (item 1) ← destrava tudo.
2. Abrir a TV Dia com o `tv_token` (item 2) e confirmar que sai do fallback.
3. Abrir `SIME_mesario.html`, logar com um QR+PIN (tipo *mesario*) e lançar um
   evento (ex.: "votação iniciada").
4. Confirmar que o evento aparece **na TV Dia em tempo real** (Realtime) e nos
   **Relatórios** do Admin.
5. Testar o modo offline: desligar a rede no meio de uma ação e ver a fila
   sincronizar quando voltar (badge 🟡→🟢).

---

# Anexo — Painéis de TV num TV Box Android (MXQ Pro 4K)

Os painéis (`SIME_tv_*`) são **páginas web**. Num TV Box Android há três caminhos
para colocá-las na telona; recomendação e ressalvas abaixo.

## Ressalva técnica primeiro (importante no MXQ Pro 4K)

O MXQ Pro 4K é um box barato (Amlogic S905, Android ~7.1, WebView antigo, 1–2 GB
RAM). Os painéis usam **ES modules + `import()` dinâmico + optional chaining +
WebSocket (Realtime)**. O **System WebView de fábrica pode ser velho demais** e
quebrar esses recursos. Portanto, o ponto crítico não é "qual app", e sim
**garantir um motor de navegação moderno**:

- Se o box tiver Play Store/GMS: atualizar o *Android System WebView* e o *Chrome*
  pela Play Store resolve.
- Se não tiver GMS (comum nesses boxes): **sideload** de um Chromium recente
  (APK) — e usar um navegador que renderize com seu próprio engine, não o WebView
  do sistema.

> Recomendação forte: **testar 1 box antes de comprar/depender de vários**. Abrir
> `…/SIME_tv_dia.html?tv_token=…` e confirmar que sai do fallback e atualiza em
> tempo real. Se travar, é o WebView — atualize-o ou troque o navegador.

## Opção A — Navegador em modo quiosque (recomendado, zero desenvolvimento)

Instalar um app de **kiosk browser** e configurá-lo:
- Sugestão: **Fully Kiosk Browser** (o mais completo para Android TV/box) ou similar.
- Configurar: **Start URL** = a URL do painel com `?tv_token=`; *Launch on boot*;
  *Keep screen on*; *Auto-reload on connection loss*; esconder barras/gestos;
  *Screensaver off*.
- Resultado: o box liga → abre o painel em tela cheia → reconecta sozinho se cair a
  rede → não precisa de teclado.
- Prós: funciona **hoje** com o que já existe; suporta o `tv_token`; recuperação
  automática. Contras: alguns recursos do Fully são pagos (licença ~€10 única, uma
  vez por dispositivo); ainda depende do WebView (ver ressalva).

## Opção B — APK nativo fino (WebView wrapper) — se quiser algo "produto"

Um app Android mínimo (~1 tela) que:
- Abre a URL do painel num WebView **em tela cheia**, `keepScreenOn`, orientação
  travada.
- **Auto-inicia no boot** (receiver `BOOT_COMPLETED`).
- Tela de config na 1ª execução: escolher **qual painel** + colar/escanear o
  **token de TV** (dá para ler o QR do próprio `SIME_tokens.html`).
- Reconecta/recarrega ao voltar a rede.
- **Empacota um WebView/Chromium moderno** (ex.: GeckoView) — remove a dependência
  do WebView velho do box, que é o maior risco.
- Prós: instalável por APK, branding próprio, robusto, sem licença de terceiros.
  Contras: exige um pequeno projeto Android (estimo 1–2 dias) e assinar o APK.

## Opção C — PWA (Add to Home Screen)

Transformar os painéis em PWA (manifest + service worker) e "instalar" pela home.
No MXQ o suporte a PWA costuma ser fraco (browser/WebView antigo), então **menos
confiável** que A ou B aqui. Vale só se o box tiver Chrome atualizado.

## Enhancements no código que ajudam qualquer opção (sugestões)

1. **Vendorizar o `supabase-js`** (servir uma cópia local em vez de importar de
   `esm.sh` em runtime): a TV passa a subir mesmo com CDN bloqueado/instável na
   rede do cartório — ganho grande de robustez para telão 24×7.
2. **manifest.json + service worker** nos painéis: instalável + tolerante a queda
   de rede (mostra o último estado em vez de tela branca).
3. **Watchdog de reload**: recarregar a página a cada X horas de madrugada, para
   evitar vazamento de memória em sessão longa no box fraco.

**Recomendação final:** para os **primeiros testes**, **Opção A** (Fully Kiosk) com
um box de WebView atualizado — zero desenvolvimento, no ar hoje. Se for
padronizar vários monitores para o Dia D, avaliar a **Opção B** + os enhancements
1 e 2 (posso implementá-los no repo quando você decidir).
