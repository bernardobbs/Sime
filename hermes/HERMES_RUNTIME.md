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

Desde a reestruturação de 04-05/08/2026, `index.js` é só um bootstrap de 4
linhas — toda a lógica mora em `core/`, `services/` e `modules/`:

```
/home/admin/hermes-agent/
├── index.js                    # bootstrap: só chama core/bootstrap.js
├── config.js                   # constantes compartilhadas (grupos, limites)
├── core/
│   ├── bootstrap.js            # sobe a sessão Baileys, liga os módulos
│   └── scheduler.js            # agendar(nome, ms, fn) — wrapper de setInterval
├── services/
│   ├── logger.js                # Telegram (texto/foto)
│   ├── simeApi.js                # cliente único dos endpoints /api/hermes-*
│   ├── monitor.js                # temperatura do Pi
│   ├── telemetria.js             # heartbeat/telemetria + aviso de atualização (ver seção 5)
│   ├── papel.js                   # HERMES_BACKUP_ATIVO — liga o 2º socket de WhatsApp (ver seção 5)
│   ├── heartbeat.js              # conexão de cada socket + agrega health() pro comando "status"
│   └── speedtest.js              # teste de velocidade sob demanda
├── modules/
│   ├── whatsapp/
│   │   ├── router.js             # despacha mensagem recebida pros módulos certos
│   │   ├── confirmacao.js        # confirmação/recusa de mesário + busca por nome
│   │   ├── eventosDiaD.js        # wrapper de eventos.js (no-op se o arquivo não existir)
│   │   ├── comandos.js           # status/fila/velocidade/reiniciar (DM)
│   │   └── notificacoes.js       # drena fila de pânico/mídia
│   └── campanhas/
│       ├── dispatch.js           # drena fila de disparo em massa + resumo horário
│       └── identidade.js         # classifica resposta SIM/NÃO da verificação de identidade
├── telegram.js                 # processo hermes-telegram: bot Telegram (separado)
├── status.js                   # métricas do Pi (PM2 + /proc) — root, não fez parte do refactor
├── keywords.js                  # lógica de confirmação/recusa — idem
├── keywords.json                 # dados das keywords — cresce sozinho via IA
├── eventos.js                    # regex de eventos de véspera/dia D — idem
├── .env                         # segredos e flags
└── auth_info/                    # sessão WhatsApp persistida (Baileys)
```

`status.js`/`keywords.js`/`keywords.json`/`eventos.js` continuam na raiz — não
fizeram parte da reestruturação porque o conteúdo deles nunca foi repassado
pra fora do Pi; os módulos novos só os importam (`require('../../status')`
etc.), sem reescrevê-los.

**`auth_info/` é a sessão do WhatsApp.** Apagar essa pasta desloga o número e
exige escanear QR Code de novo. Não versionar, não limpar em manutenção.
Mesmo cuidado vale pra `auth_info_backup/` quando `HERMES_BACKUP_ATIVO=true`
(ver seção 5) — é a sessão do segundo número, pasta separada de propósito
(sessões Baileys sobre a mesma pasta desincronizam as chaves do Signal
protocol).

### `.env`

```
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=sb_secret_...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
GEMINI_API_KEY=...
DISPATCH_ATIVO=false
SIME_API_URL=https://sime-cyan.vercel.app
HERMES_SECRET=...
SIME_POLL_INTERVALO=30
HERMES_BACKUP_ATIVO=false
```

`HERMES_BACKUP_ATIVO=true` liga o segundo socket de WhatsApp (mesmo Pi,
mesmo processo) — ver seção 5, "Dois números de WhatsApp no mesmo Pi".
Default `false`: sem essa linha, o comportamento é idêntico ao de sempre
(um socket só).

`HERMES_SECRET` precisa ter o **mesmo valor** de `HERMES_SECRET_ZONA_7`
cadastrado na Vercel (ver `README.md`) — o nome muda porque o Pi só atende
uma zona, então não precisa do sufixo `_ZONA_7` pra desambiguar.

O Supabase migrou para o formato novo de chaves: a service key começa com
`sb_secret_`, não é mais um JWT `eyJ...`.

`SUPABASE_URL`/`SUPABASE_SERVICE_KEY` continuam no `.env` porque `telegram.js`
pode usá-las, mas **`index.js` não fala mais com o Supabase direto** (ver
seção 5) — desde 03/08/2026 ele grava confirmação de mesário, drena a fila
de pânico e o disparo em massa através dos endpoints Vercel, com
`HERMES_SECRET` (= `HERMES_SECRET_ZONA_7` da Vercel — ver `README.md`) como
Bearer.

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
│   ├─ detecta eventos de dia D (eventos.js, regex)
│   │   └─ não achou/sem seção ────► fallback IA (Gemini)
│   │       └─ propõe no Telegram (NÃO grava — modo proposta)
│   └─ detecta confirmação/recusa
│       ├─ keyword matching (rápido, sem custo)
│       └─ não achou ──────────────► fallback IA
│           └─ aprende keyword nova + notifica
│       → grava no SIME via POST /api/hermes-mesarios (confirmar/recusar)
└─ conversa individual → comandos (TODOS exigem ADMIN_NUMBERS, ver nota abaixo)
    ├─ status
    ├─ pausar envio / retomar envio   (disparo em massa)
    ├─ fila                           (status da fila de disparo em massa)
    ├─ velocidade / speedtest
    ├─ reiniciar raspberry            (com confirmação)
    └─ trocar papel                   (com confirmação — troca principal↔backup)
```

> **DM restrita a ADMIN_NUMBERS (06/08/2026)**: `status` e `fila` respondiam
> a qualquer remetente antes disso — só os comandos administrativos
> (pausar/reiniciar/trocar papel) exigiam estar na lista. Depois do
> incidente da busca por nome (nota abaixo) respondendo estranho, o canal de
> DM inteiro passou a exigir `ADMIN_NUMBERS`: quem não está na lista não
> recebe nenhuma resposta, nem "sem permissão" — silêncio total. Toda DM
> ainda é logada (`[comando] ... | isAdmin=...`) só no `pm2 logs`, nunca
> respondida, o que ajuda a pegar um admin legítimo bloqueado por JID `@lid`
> não cadastrado (ver nota sobre `@lid` no `CLAUDE.md`).

> **Busca por nome suprimida (06/08/2026)**: existia um fallback — nenhum
> comando bateu + 2+ palavras → `POST /api/hermes-mesarios acao=buscar_nome`
> — que disparava em cima de conversa comum ("Bom dia", "É Bernardo do
> cartório", qualquer frase) e respondia "não encontrei ninguém chamado
> <frase>" pra qualquer mensagem que não fosse um comando reconhecido.
> Flagrado em campo confundindo quem mandava mensagem normal pro número.
> Removido de `modules/whatsapp/comandos.js` — `buscarConvocacaoPorNome`
> continua em `modules/whatsapp/confirmacao.js`, só não é mais chamado
> automaticamente por texto solto.

> **Histórico:** em 03/08/2026 duas sessões do Claude Code trabalharam em
> paralelo, sem saber uma da outra, em cima do mesmo `index.js` — uma corrigiu
> a confirmação de mesário e ligou a fila de pânico, a outra implementou
> `eventos.js` e o disparo em massa. O arquivo em produção a partir de então é
> a mesclagem das duas. Se este diagrama não bater com o Pi, é sinal de que só
> uma das duas metades foi de fato deployada — conferir com `pm2 logs`.

Um efeito já observado dessa ordem: enquanto o filtro de contato pessoal estava
com um JID errado, ele interceptava o comando `status` e respondia a mensagem
automática no lugar do painel. Ao inserir um handler novo, verificar onde ele
entra na cadeia.

---

## 5. O que já está funcionando

Verificado em produção (checagens de 02/08) e reconciliado contra o `index.js`
mesclado em 03/08/2026.

| Função | Estado |
|---|---|
| Sessão WhatsApp (Baileys) | ✅ conectada, reconexão automática |
| Bot Telegram | ✅ online, envia texto e QR Code (foto) |
| Fallback IA (Gemini Flash) | ✅ configurado e ativo |
| Keywords + aprendizado (confirmação/recusa) | ✅ 13 confirmações / 17 recusas, cresce sozinho |
| Confirmação/recusa de mesário → grava no SIME | ✅ via `POST /api/hermes-mesarios` |
| Busca de convocação por nome (DM) | ✅ via `POST /api/hermes-mesarios acao=buscar_nome` |
| Fila de notificações (pânico, mídia pronta) | ✅ loop drena `POST /api/hermes-notificacoes` a cada `SIME_POLL_INTERVALO`s |
| Disparo em massa (convocação) | ✅ fila drenada via `POST /api/hermes-campanhas` — **desligado por padrão** (`DISPATCH_ATIVO=false`) |
| Comandos `fila` / `pausar envio` / `retomar envio` | ✅ controlam o disparo em massa (admin) |
| Detecção de eventos de seção (`eventos.js`) | ⚠️ detecta e propõe no Telegram — **modo proposta, não grava** |
| Autoatendimento por telefone ("oi" → `hermes-mesarios acao=consultar`) | ❌ não implementado — busca por nome cobre parte do caso de uso |
| Heartbeat/telemetria pro SIME (`POST /api/hermes-heartbeat`) | ✅ `services/telemetria.js`, a cada `SIME_POLL_INTERVALO`s — ver nota abaixo |
| 2º número de WhatsApp no mesmo Pi (monitoria de grupo) | ✅ `services/papel.js`/`core/bootstrap.js` — opcional, `HERMES_BACKUP_ATIVO=true` — ver nota abaixo |
| Comando `status` | ✅ PM2, temperatura, CPU, RAM, swap, disco, uptime |
| Comando `velocidade` | ✅ speedtest real (download/upload/ping) |
| Monitor de temperatura | ✅ alerta ≥75 °C a cada 3 min, WhatsApp + Telegram |
| Reboot remoto via WhatsApp | ⚠️ implementado, **não confirmado em teste** |
| Persistência pós-reboot | ✅ validado com reboot real |

### Heartbeat/telemetria — sem atualização automática, de propósito

`services/telemetria.js` manda telemetria (`versao`, `commit_hash`, `uptime_s`,
`mem_mb`, `cpu_pct`, `temperatura_c`, `disco_livre_mb`, `ip`, `node_version`,
status de WhatsApp/Telegram) a cada `SIME_POLL_INTERVALO`s via `acao:'enviar'`
— alimenta `sime_heartbeat`, visível na aba de gestão do Hermes em
`SIME_admin.html`. `versao`/`commit_hash` tendem a vir `null`: a instalação
hoje é `scp`+`unzip`, não um clone git, e não existe `package.json` versionado
neste diretório — os dois `try/catch` ficam prontos pra funcionar assim que
(se) isso mudar, sem exigir alteração no código.

Quando o cartório marca "Solicitar atualização" na aba de gestão
(`sime_componentes.atualizar_agora=true`), a resposta do `enviar` já
carrega isso — o Hermes manda **um aviso no Telegram** (não repete a cada
ciclo enquanto o pedido seguir pendente) e para por aí. **Não existe
`git pull`/`npm install`/`pm2 reload` automático em lugar nenhum do código** —
decisão deliberada, documentada em `SIME_hermes_skill_heartbeat.md`: perto da
eleição (04/10/2026), uma sessão Baileys que precisa de novo QR Code no meio
da operação é pior que rodar uma versão atrasada. Aplicar a atualização
continua manual, na mão de quem cuida do Raspberry Pi.

### 2º número de WhatsApp no mesmo Pi — mitigação parcial, só sessão

Resposta à pendência "Ponto único de falha do Hermes" do `CLAUDE.md` — com
a ressalva de que só temos **um** Raspberry Pi disponível (3 Model B,
1GB RAM), então o desenho não é duas instalações físicas: é **um processo
só**, com **dois sockets Baileys** dentro dele. `core/bootstrap.js` sempre
sobe o socket `principal` (`./auth_info`) e, se `HERMES_BACKUP_ATIVO=true`,
também sobe o socket `backup` (`./auth_info_backup`, número de WhatsApp
diferente, pareado por QR Code próprio — o Telegram rotula qual QR é qual).

Por estarem no mesmo processo, a decisão de qual socket processa mensagem
de grupo é **local e instantânea** — `services/heartbeat.js.estaConectado
('principal')`, sem round-trip pelo SIME: enquanto o principal está
conectado, só ele processa grupo; assim que o `connection.update` dele
reporta queda, o backup assume sozinho. Volta pro principal assim que ele
reconectar. Detalhe completo do contrato: `hermes/SIME_hermes_skill_heartbeat.md`.

**O que isso protege, e o que não**: cobre a sessão do WhatsApp caindo
sozinha (deslogado, banido, chave de sessão corrompida) — **não** cobre o
Pi inteiro cair (energia, Wi-Fi, cartão SD, processo travado), porque os
dois sockets são o mesmo processo/hardware. Pra essa segunda falha, a
pendência continua real e sem mitigação — exigiria um segundo dispositivo
físico, que não existe hoje.

**Nada disso está ligado por padrão** — sem `HERMES_BACKUP_ATIVO=true`,
`core/bootstrap.js` só sobe o socket principal, comportamento idêntico ao
de sempre. Setup manual necessário pra usar de verdade:
1. Um segundo número de WhatsApp disponível (chip/linha diferente do
   principal).
2. `.env`: acrescentar `HERMES_BACKUP_ATIVO=true` (resto do `.env`
   continua o mesmo — mesmo `HERMES_SECRET`/`SIME_API_URL`, é o mesmo
   processo).
3. Reiniciar o PM2 (`pm2 restart hermes --update-env`) — o Baileys vai
   gerar um QR Code novo, rotulado "BACKUP" no Telegram. Escanear com o
   segundo número.
4. **Adicionar o número backup em cada grupo monitorado no WhatsApp** —
   sem isso, mesmo com o principal caído, o backup não recebe nenhuma
   mensagem de grupo pra processar. Ação manual, fora do código.

**Qual número é qual, e como trocar**: o papel é definido só pela pasta de
sessão (`auth_info/` = principal, `auth_info_backup/` = backup) — não tem
nenhuma configuração por número de telefone. Toda vez que um socket
conecta, o Telegram mostra o número físico junto do papel ("✅ Hermes Agent
(PRINCIPAL) conectado... Número: +55869..."), então não precisa adivinhar
qual é qual. Pra trocar os papéis sem re-parear nenhum dos dois números,
manda **"trocar papel"** no privado do Hermes (admin) — mesmo fluxo de
confirmação do "reiniciar raspberry" (`CONFIRMAR TROCA`, expira em 30s,
bloqueado em período eleitoral crítico). Por baixo do capô, o comando só
troca as duas pastas de lugar e reinicia o PM2 (`modules/whatsapp/comandos.js`)
— equivalente a fazer `mv auth_info auth_info_backup` na mão, mas sem
precisar de SSH.

**Escopo deliberadamente restrito à monitoria de grupo** — fila de pânico
e disparo em massa nunca rodam no backup, nem em failover (ver
`core/bootstrap.js`: `dispatch.iniciar`/`notificacoes.iniciar` só chamados
quando `!papel.souBackup()`). Se o principal cair de vez, essas duas filas
ficam paradas até intervenção manual — trade-off aceito conscientemente
pra não arriscar duas notificações da mesma fila saindo de dois números.

### Modo proposta — só se aplica ao que ainda não existe

Confirmação/recusa de mesário **não está mais em modo proposta**: grava
direto em `sime_atores.confirmacao` via `/api/hermes-mesarios`, com aviso no
Telegram como trilha de auditoria (não como aprovação prévia). A decisão de
tirar do modo proposta foi consciente — é dado pré-eleição (convocação, não
evento de dia D), já passa por keyword matching + fallback de IA, e o Telegram
continua recebendo cada gravação para revisão.

**Detecção de eventos de seção (`eventos.js`) existe e roda, mas continua em
modo proposta de propósito** — regex + fallback de IA identificam o evento e
mandam pro Telegram pra validação humana; nada chama `/api/hermes-update`. Ao
trabalhar neste arquivo, não "corrigir" isso ligando a escrita sem antes medir
a taxa de acerto com tráfego real — errar um evento de dia D grava dado
oficial incorreto, e o custo disso é maior que confirmar na mão. Até ligar,
"seção 63 encerrada" dito no grupo continua exigindo lançamento manual no
Admin ou por telefone.

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
