# Hermes Agent — runtime no Raspberry Pi

Documento operacional. Descreve **como o Hermes roda** e **o que já funciona**,
verificado em produção em 02/08/2026.

Complementa o `README.md` desta pasta, que trata do contrato com o banco do
SIME (endpoints, segredos por zona). Aqui o foco é o processo em si: ambiente,
arquivos, fluxo de mensagem e estado real de cada função.

> **Isto substitui, na prática, a instalação descrita em `setup.sh`.** O script
> assume um CLI genérico (`hermes-agent.nousresearch.com/install.sh`, comandos
> `hermes config set ...`) que não é o que está rodando. A instância em
> produção é um app Node.js sob medida, descrito abaixo. `setup.sh` e os 5
> arquivos `SIME_hermes_skill_*.md` documentam o **contrato de dados** (schema
> dos endpoints, templates de mensagem) — continuam válidos como referência —
> mas não o processo de instalação nem a arquitetura do agente em si.

---

## 1. Ambiente

| Item | Valor |
|---|---|
| Host | Raspberry Pi 3B, hostname `casaosBernardo` |
| Usuário | `admin` |
| Diretório | `/home/admin/hermes-agent` |
| Node.js | v20.19.2 |
| npm | 9.2.0 |
| PM2 | `/usr/local/bin/pm2` (symlink de `/usr/local/lib/node_modules/pm2/bin/pm2`) |
| Rede | Wi-Fi (`wlan0`) |
| RAM | 905 MB total + 1830 MB swap |
| Acesso | SSH na rede local |

Recursos observados em operação normal: temperatura 59–72 °C, RAM ~38%,
disco 54% usado, `hermes` ~120 MB, `hermes-telegram` ~88 MB.

---

## 2. Processos PM2

Dois processos independentes, ambos gerenciados pelo PM2:

```
┌────┬─────────────────┬─────────┬─────────┐
│ id │ name            │ mode    │ status  │
├────┼─────────────────┼─────────┼─────────┤
│ 0  │ hermes          │ fork    │ online  │
│ 1  │ hermes-telegram │ fork    │ online  │
└────┴─────────────────┴─────────┴─────────┘
```

- **`hermes`** (`index.js`) — sessão WhatsApp via Baileys. É o processo
  principal: recebe mensagens dos grupos, responde comandos, roda o monitor de
  temperatura e o dispatch queue.
- **`hermes-telegram`** (`telegram.js`) — bot Telegram por long polling.
  Independente do WhatsApp; se o WhatsApp cair, o Telegram continua respondendo
  `/status`.

Os dois compartilham `status.js` e o mesmo `.env`.

### Persistência após reboot — validada

```bash
sudo env PATH=$PATH:/usr/bin /usr/local/lib/node_modules/pm2/bin/pm2 \
  startup systemd -u admin --hp /home/admin
pm2 save
```

Criou `/etc/systemd/system/pm2-admin.service`, habilitado no `multi-user.target`.
Testado com reboot real: ambos os processos voltaram sozinhos, `↺ 0`.

### Comandos operacionais

```bash
pm2 list                                  # estado dos processos
pm2 logs hermes --lines 30 --nostream     # logs (sem seguir)
pm2 restart hermes --update-env           # reiniciar relendo o .env
pm2 restart hermes hermes-telegram --update-env
```

> `--update-env` é obrigatório após editar o `.env`. Sem ele o PM2 reinicia com
> as variáveis antigas em cache, e o sintoma é confuso: o arquivo está certo,
> mas o processo não enxerga.

---

## 3. Arquivos

```
/home/admin/hermes-agent/
├── index.js         # processo hermes: WhatsApp, dispatch, temperatura
├── telegram.js      # processo hermes-telegram: bot Telegram
├── status.js        # métricas do Pi (PM2 + /proc)
├── keywords.js       # lógica de confirmação/recusa
├── keywords.json     # dados das keywords — cresce sozinho via IA
├── eventos.js        # regex de eventos de véspera/dia D
├── .env               # segredos e flags
└── auth_info/         # sessão WhatsApp persistida (Baileys)
```

**`auth_info/` é a sessão do WhatsApp.** Apagar essa pasta desloga o número e
exige escanear QR Code de novo. Não versionar, não limpar em manutenção.

### `.env`

```
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=sb_secret_...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
GEMINI_API_KEY=...
DISPATCH_ATIVO=false
SIME_VERCEL_URL=https://sime-cyan.vercel.app
HERMES_SECRET_ZONA_7=...
SIME_POLL_INTERVALO=30
```

O Supabase migrou para o formato novo de chaves: a service key começa com
`sb_secret_`, não é mais um JWT `eyJ...`.

`SUPABASE_URL`/`SUPABASE_SERVICE_KEY` continuam no `.env` porque `telegram.js`
pode usá-las, mas **`index.js` não fala mais com o Supabase direto** (ver
seção 5) — desde 03/08/2026 ele grava confirmação de mesário e drena a fila
de pânico através dos endpoints Vercel, com `HERMES_SECRET_ZONA_7` (o mesmo
segredo cadastrado na Vercel — ver `README.md`) como Bearer.

---

## 4. Fluxo de uma mensagem recebida

Ordem dos handlers em `index.js` (`messages.upsert`). **A ordem importa** — o
primeiro bloco que casar dá `return` e encerra:

```
mensagem chega
├─ fromMe? ──────────────────────────► ignora
├─ contato específico (Daniella)? ───► resposta automática, return
├─ é grupo?
│   ├─ grupo não monitorado ────────► ignora
│   └─ detecta confirmação/recusa
│       ├─ keyword matching (rápido, sem custo)
│       └─ não achou ──────────────► fallback IA
│           └─ aprende keyword nova + notifica
│       → grava no SIME via POST /api/hermes-mesarios (confirmar/recusar)
└─ conversa individual → comandos
    ├─ status
    ├─ velocidade / speedtest
    └─ reiniciar raspberry            (admin, com confirmação)
```

> **Não existe detecção de eventos de seção (`enc`, `zeresima`, `panico_*`,
> etc.) no `index.js` auditado em 03/08/2026.** O `eventos.js` listado na
> seção 3 não é `require`ado por `index.js` — a versão em produção só
> processa confirmação/recusa de convocação de mesário, não eventos de dia D.
> Se `eventos.js` existir no Pi, ele ainda não está ligado ao fluxo de
> mensagens. Fica como pendência para antes de 04/10 (ver `CLAUDE.md`).

Um efeito já observado dessa ordem: enquanto o filtro de contato pessoal estava
com um JID errado, ele interceptava o comando `status` e respondia a mensagem
automática no lugar do painel. Ao inserir um handler novo, verificar onde ele
entra na cadeia.

---

## 5. O que já está funcionando

Verificado em produção (checagens de 02/08) e reconciliado contra o código
real de `index.js` em 03/08/2026 — algumas linhas da tabela antiga não bateram
com o arquivo revisado; ficam marcadas abaixo.

| Função | Estado |
|---|---|
| Sessão WhatsApp (Baileys) | ✅ conectada, reconexão automática |
| Bot Telegram | ✅ online, envia texto e QR Code (foto) |
| Fallback IA (Gemini Flash) | ✅ configurado e ativo |
| Keywords + aprendizado | ✅ 13 confirmações / 17 recusas, cresce sozinho |
| Confirmação/recusa de mesário → grava no SIME | ✅ desde 03/08/2026, via `POST /api/hermes-mesarios` |
| Fila de notificações (pânico, mídia pronta) | ✅ desde 03/08/2026, loop drena `POST /api/hermes-notificacoes` a cada `SIME_POLL_INTERVALO`s |
| Detecção de eventos de seção (`enc`, `zeresima`, `panico_*`, dia D) | ❌ não implementada em `index.js` — ver nota na seção 4 |
| Comando `status` | ✅ PM2, temperatura, CPU, RAM, swap, disco, uptime |
| Comando `velocidade` | ✅ speedtest real (download/upload/ping) |
| Comando `fila` / `pausar envio` / `retomar envio` | ⚠️ não encontrados em `index.js` — pode ter existido numa versão anterior, ou nunca foi implementado |
| Autoatendimento ("oi" → `hermes-mesarios acao=consultar`) | ❌ não implementado — só grupo monitorado dispara confirmação/recusa, DM não tem esse fluxo |
| Disparo em massa (`DISPATCH_ATIVO=true` → `/api/hermes-campanhas`) | ❌ não implementado — a trava no `.env` existe, mas não há nada no código pra ela liberar |
| Monitor de temperatura | ✅ alerta ≥75 °C a cada 3 min, WhatsApp + Telegram |
| Reboot remoto via WhatsApp | ⚠️ implementado, **não confirmado em teste** |
| Persistência pós-reboot | ✅ validado com reboot real |

### Modo proposta — só se aplica ao que ainda não existe

Confirmação/recusa de mesário **não está mais em modo proposta**: grava
direto em `sime_atores.confirmacao` via `/api/hermes-mesarios`, com aviso no
Telegram como trilha de auditoria (não como aprovação prévia). A decisão de
tirar do modo proposta foi consciente — é dado pré-eleição (convocação, não
evento de dia D), já passa por keyword matching + fallback de IA, e o Telegram
continua recebendo cada gravação para revisão.

**Detecção de eventos de seção continua sem existir no código**, então "modo
proposta" não se aplica a ela — não há o que ligar, precisa ser escrito. Até
lá, notificações de urna/pânico continuam dependendo de alguém do cartório
lançar manualmente no Admin ou por telefone.

A fila de notificações (`/api/hermes-notificacoes`) agora é drenada
automaticamente — todo item pendente vira WhatsApp para `ADMIN_NUMBERS` **e**
Telegram. O escalonamento por papel (Monitor de Campo → Gestor de Problemas →
Chefe de Cartório, conforme `CLAUDE.md`) ainda não é feito por destinatário
diferente — falta um endpoint que resolva telefone por papel; hoje todo mundo
em `ADMIN_NUMBERS` recebe tudo, só o texto muda pra indicar o nível de
escalonamento esperado.

---

## 6. Armadilhas do ambiente

Problemas reais enfrentados, com a causa e a solução. Documentados porque todos
voltam se alguém "limpar" o código sem saber por que estão ali.

**WebSocket / Node 20.** O `@supabase/realtime-js` recente exige Node 22+ e
falha com `Node.js detected but native WebSocket not found`. Contornado com
`global.WebSocket = require('ws')` na **primeira linha** do `index.js`, antes de
qualquer outro require. Tentar resolver por downgrade do `supabase-js` não
funciona: o npm mantém as sub-dependências na versão nova.

**`node-telegram-bot-api` v1.x.** Mudou de export default para nomeado. O
`require` correto é:

```js
const { TelegramBot } = require('node-telegram-bot-api');  // ✅
const TelegramBot = require('node-telegram-bot-api');      // ❌ v1.x
```

O sintoma é `TypeError: TelegramBot is not a constructor` em crash loop.

**Logs do PM2 são cumulativos.** `pm2 logs --nostream` mostra o arquivo
acumulado, não só o último restart. Erros antigos continuam aparecendo depois de
corrigidos — conferir se há linhas de sucesso *após* eles antes de concluir que
o problema persiste.

**`dotenv` resolve pelo diretório atual.** Rodar `node -e` a partir de `~` em vez
de `~/hermes-agent` carrega zero variáveis (`injected env (0)`) e o erro que
aparece é outro, enganoso.

**`speedtest-net` compila binário nativo.** Levou ~5 min no Pi e trouxe 10
vulnerabilidades de dependências transitivas antigas. Não rodar `npm audit fix`
sem testar depois.

---

## 7. Limites conhecidos

- **Ponto único de falha.** Um Pi 3B doméstico, no Wi-Fi, 1 GB de RAM, sem
  redundância. Se cair em 04/10, não há monitoramento por WhatsApp.
- **Rate limit de envio.** 5 mensagens/minuto com pausa aleatória de 4–9 s. Não
  aumentar: WhatsApp bane número que dispara em rajada.
- **Gemini free tier.** 1.500 requisições/dia. Hoje toda mensagem de grupo não
  reconhecida por regex gasta uma chamada, inclusive "bom dia". Pode estourar em
  dia de eleição; mitigação é pré-filtrar por palavras do domínio.
- **JID `@lid`.** O Baileys às vezes identifica o remetente por um ID interno em
  vez do telefone, o que impede o join com `sime_atores`. Log de diagnóstico
  (`isLid=true/false`) ativo para medir a frequência. Bloqueia a gravação
  automática de confirmações.
- **Temperatura.** Já observados 72 °C sem carga pesada, com alerta configurado
  em 75 °C. Margem pequena para um dia de operação intensa.
