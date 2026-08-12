# Hermes Agent — funções e comunicação com o SIME

Referência completa: toda função do Hermes (o que faz, onde mora no código) e
todo ponto de contato com o SIME (endpoint, ação, quem chama, o que grava).
Não substitui os documentos que já existiam — cruza com eles:

| Se você quer... | Vá para |
|---|---|
| Rodar/instalar uma instância nova (zona 94ª) | `README.md` |
| Entender o processo real no Raspberry Pi (PM2, arquivos, armadilhas) | `HERMES_RUNTIME.md` |
| O schema de mensagem/template de 1 skill específica em detalhe | `SIME_hermes_skill_*.md` |
| **O que o Hermes faz, e como cada função fala com o SIME** | **este arquivo** |

O código do Hermes **não está neste repositório** — é entregue por zip
(scp+unzip no Raspberry Pi), não é `git clone`. Só os endpoints que ele
consome (`api/hermes-*.js`) e a documentação vivem aqui.

---

## 1. O que é, onde roda

App Node.js + Baileys (WhatsApp Web API não-oficial) num Raspberry Pi 3B, na
rede doméstica do cartório, atrás de NAT (sem IP público, sem túnel). Dois
processos PM2:

| Processo | O quê |
|---|---|
| `hermes` | o app principal (tudo abaixo deste documento) |
| `hermes-telegram` | bot Telegram separado — só recebe comando de status/logs, não tem lógica de negócio |

Uma instância por zona eleitoral. Hoje só a **7ª Zona** tem Pi rodando; a
94ª não tem instância nenhuma.

### Dois sockets WhatsApp no mesmo processo (opcional)

Com `HERMES_BACKUP_ATIVO=true`, o mesmo processo sobe **dois** sockets
Baileys — `principal` (`auth_info/`) sempre, `backup` (`auth_info_backup/`)
condicional. Cada um com seu próprio número, pareado por QR Code próprio
(rotulado no Telegram). Cobre a **sessão do WhatsApp** cair sozinha
(deslogada/banida/corrompida) — não cobre o Pi inteiro cair (energia/Wi-Fi/SD),
já que os dois números são o mesmo hardware. Ver seção 5.5.

---

## 2. Como fala com o SIME — padrão geral

**O Hermes nunca é alcançado de fora. Ele é sempre quem liga.** Ele roda
atrás do NAT de um roteador doméstico — sem IP fixo, sem porta aberta, sem
túnel, sem domínio. Se o SIME precisasse chamá-lo, isso exigiria
infraestrutura que não existe. Em vez disso, o Hermes **pergunta** ao SIME
em loop (`core/scheduler.js` via `agendar(nome, intervaloMs, fn)`), nunca o
contrário:

```
Hermes ──POST──▶ /api/hermes-update         escreve eventos de seção (não chamado hoje — ver 3.6)
Hermes ──POST──▶ /api/hermes-mesarios       lê mesários, grava confirmação
Hermes ──POST──▶ /api/hermes-notificacoes   busca a fila de pânico/mídia
Hermes ──POST──▶ /api/hermes-campanhas      busca a fila de disparo em massa
Hermes ──POST──▶ /api/hermes-contatos       resolve telefone por papel (não chamado hoje — ver 3.5)
Hermes ──POST──▶ /api/hermes-heartbeat      reporta telemetria + checa update
```

Custo desse desenho: até um ciclo de atraso entre o evento e a ação (ex.:
pânico → WhatsApp). Para um escalonamento que começa em 10 minutos, 30s é
irrelevante. `HERMES_URL` (usada só em `api/hermes-update.js` pra empurrar
notificação direto) fica **sem valor** nesta instância — existir criaria a
tentação de empurrar direto, o que exigiria um Hermes alcançável, e ele não é.

**Auth por zona.** Toda chamada leva `Authorization: Bearer <HERMES_SECRET>`
— o Vercel resolve qual zona é (`HERMES_SECRET_ZONA_7`, `_94`, ...) comparando
o Bearer recebido, nunca por um campo `zona` no corpo. Uma instância nunca
lê nem grava dado de outra zona. Erro de auth → `401`; zona não cadastrada →
`400`/`500` conforme o endpoint.

**Cliente único.** `services/simeApi.js` centraliza toda chamada — nenhum
outro módulo monta URL/Authorization na mão. Duas funções:
- `chamarSime(endpoint, payload)` — genérico (mesários, notificações,
  heartbeat); devolve `null` em falha de rede, nunca lança.
- `chamarApiCampanhas(payload)` — só pra `hermes-campanhas`; lança em erro
  (contrato mais antigo, já testado em produção pelo dispatch queue).

`SIME_POLL_INTERVALO` (env, default **30s**) é o intervalo padrão de quase
todo loop; disparo em massa e monitor de temperatura têm o próprio intervalo
fixo (ver tabela da seção 3).

---

## 3. Endpoints do SIME consumidos pelo Hermes

| Endpoint | Quem chama (módulo) | Ciclo | Ações |
|---|---|---|---|
| `/api/hermes-heartbeat` | `services/telemetria.js` | 30s (`SIME_POLL_INTERVALO`), uma vez por socket ativo | `enviar`, `confirmar_atualizacao`, `erro_atualizacao`, `componentes` |
| `/api/hermes-mesarios` | `modules/whatsapp/confirmacao.js` (grupo) | evento (mensagem de grupo) | `confirmar`, `recusar` — resto do contrato (`listar`/`consultar`/`buscar_nome`/`atualizar`/`substituir`) existe no endpoint mas **não é chamado automaticamente** hoje |
| `/api/hermes-notificacoes` | `modules/whatsapp/notificacoes.js` | 30s | `pendentes`, `confirmar`, `erro` |
| `/api/hermes-campanhas` | `modules/campanhas/dispatch.js` + `identidade.js` | 60s (dispatch) + evento (resposta SIM/NÃO) + 1h (resumo) | `pendentes`, `confirmar`, `erro`, `responder`, `resumo` |
| `/api/hermes-contatos` | *(nenhum módulo — ver 3.5)* | — | `listar` |
| `/api/hermes-update` | *(nenhum módulo — ver 3.6)* | — | `enc`/`vot`/`zeresima`/`fila`/`panico_*`/`urna`/`midia_pronta`/`mesa_completa` |

### 3.1 `hermes-heartbeat` — telemetria + pedido de atualização

```json
{ "acao": "enviar", "componente": "hermes", "telemetria": { "versao": "...", "uptime_s": 7200, "cpu_pct": 18, "whatsapp_status": "conectado", ... } }
```
Resposta já traz `atualizar_agora`/`versao_desejada` no mesmo request (evita
2ª chamada por ciclo). `componente` é `hermes` (principal) ou `hermes-backup`
— os dois enviam métricas de sistema idênticas (mesmo Pi), só
`whatsapp_status` muda.

`atualizar_agora: true` → `services/telemetria.js` manda **um aviso no
Telegram**, nada mais. O Hermes nunca aplica atualização sozinho (decisão
deliberada perto da eleição — ver seção 6). `confirmar_atualizacao`/
`erro_atualizacao` existem no contrato mas hoje ninguém no Hermes os chama
(fechar esse ciclo é manual, feito por quem opera o Pi). Não existe
`git pull`/`npm install`/`pm2 reload` automático em lugar nenhum — a
instalação em si é scp+unzip, nem é um `git clone`.

`componentes` — leitura da idade do heartbeat de cada componente da zona
(`idade_s`, calculado com relógio do servidor). Não é chamado automaticamente
hoje — o failover de backup (seção 5.5) é decidido localmente, sem depender
disso; a ação serve pra visibilidade no Admin.

### 3.2 `hermes-mesarios` — confirmação de mesário/apoio logístico

Chamado por `modules/whatsapp/confirmacao.js` quando uma mensagem de **grupo
monitorado** (`config.js` → `MONITORED_GROUPS`) casa com uma palavra-chave de
confirmação/recusa (keyword matching; fallback Gemini se não achar):
```json
{ "acao": "confirmar", "telefone": "5586..." }
```
Toda identificação por telefone casa por dígitos exatos **ou** pelos
últimos 8 (folga pra variação de DDI/DDD entre o que o WhatsApp manda e o
cadastro). Cada ação do endpoint devolve `mensagem_wa` pronta — o Hermes
não monta frase nenhuma.

`listar`/`consultar`/`buscar_nome`/`atualizar`/`substituir` existem no
endpoint (usados pelo painel "Confirmação de mesários" do
`SIME_admin.html`) mas **não têm gatilho automático no Hermes hoje**:
- autoatendimento por telefone (`consultar`, alguém manda "oi") — endpoint
  pronto, nunca chamado pelo `index.js`.
- busca por nome (`buscar_nome`) — o gatilho automático (DM não reconhecida
  como comando, 2+ palavras) foi **suprimido em 06/08/2026**, disparava em
  cima de conversa comum ("Bom dia" virava "não encontrei ninguém chamado
  'Bom dia'"). `buscarConvocacaoPorNome` continua em
  `modules/whatsapp/confirmacao.js`, só não é mais acionado sozinho.

### 3.3 `hermes-notificacoes` — fila de pânico/mídia (SIME → Hermes)

`modules/whatsapp/notificacoes.js` drena a cada 30s:
```json
{ "acao": "pendentes" }
```
Devolve até 50 notificações por ciclo, mais antigas primeiro. Cada item
traz `idade_s` (relógio do servidor) — usado pra escalonamento
(`prefixoEscalonamento`): ≥10 min → aviso "escalonar para o Gestor de
Problemas"; ≥30 min → "Chefe de Cartório". **Todo alerta vai pra
`ADMIN_NUMBERS`** hoje, sem diferenciar por nível — `hermes-contatos`
(3.5) resolveria o "pra quem" certo, mas ainda não está ligado. Depois de
enviar (WhatsApp + Telegram), confirma item a item — nunca em lote, pra não
reenviar o que já saiu se o processo cair no meio.

### 3.4 `hermes-campanhas` — disparo em massa

Popula quem usa a aba "📢 Disparo em massa" de `SIME_atores.html`. Dois
fluxos:
- **Simples** (sem `mensagem_convocacao`): manda `mensagem_enviada` (+
  imagem opcional) — uma tacada só.
- **Com confirmação de identidade** (`mensagem_convocacao` preenchido):
  `pendente → aguardando_resposta → confirmado → finalizado`, com reenvio
  automático depois de 24h sem resposta (até 3 tentativas, depois vira
  `sem_resposta`, terminal).

**Desligado por padrão** (`DISPATCH_ATIVO=false`). Quando ligado,
`modules/campanhas/dispatch.js` drena a cada 60s, até 5 mensagens por ciclo
(pausa aleatória 4-9s entre envios — anti-ban). `proxima_acao` de cada item
(`enviar`/`enviar_verificacao`/`reenviar_verificacao`/`enviar_convocacao`)
decide o que fazer — o endpoint decide, o dispatch só executa.

`modules/campanhas/identidade.js` trata a resposta SIM/NÃO de quem recebeu a
1ª mensagem (verificação de identidade) — lista fixa de respostas aceitas
(nunca IA, decisão que afeta se a pessoa recebe dado de convocação):
```json
{ "acao": "responder", "telefone": "...", "decisao": "confirmado", "resposta_texto": "sim" }
```
`decisao` casa por telefone (a resposta chega como mensagem normal de
WhatsApp, não referencia nenhum id). Resumo horário (`acao: 'resumo'`) roda
a cada 1h, posta contagem por status no Telegram — só se houver campanha na
zona (não polui à toa).

### 3.5 `hermes-contatos` — telefone por papel (escalonamento, não usado)

```json
{ "acao": "listar" }
```
```json
{ "ok": true, "contatos": { "gestor_prob": [...], "coordenador": [...] } }
```
Devolve os telefones ativos de Gestor de Problemas e Chefe de Cartório da
zona (cadastrados por eles mesmos na aba Equipe do Admin). Só leitura —
lista vazia significa "ninguém desse perfil cadastrou telefone ainda", não
é erro. Decide só o **pra quem**; o **quando** (10min/30min) continua sendo
o `idade_s` de `hermes-notificacoes` (3.3).

> **Endpoint pronto desde 08/08/2026, nenhum módulo do Hermes o chama.** A
> fila de pânico continua mandando pra todo `ADMIN_NUMBERS` igual,
> independente do nível de escalonamento — essa é a peça que falta pra
> fechar o ciclo.

### 3.6 `hermes-update` — eventos de seção (não usado)

Contrato pronto (`enc`, `vot`, `zeresima`, `fila`, `panico_energia`,
`panico_urna`, `panico_resolvido`, `urna`, `midia_pronta`, `mesa_completa`),
mas nenhum módulo do Hermes o chama. `modules/whatsapp/eventosDiaD.js`
detecta evento de dia D (regex, com fallback Gemini quando o regex não
resolve) e só **propõe no Telegram** — decisão deliberada, modo proposta,
até medir taxa de acerto com tráfego real. "Seção 63 encerrada" dito num
grupo hoje ainda exige lançamento manual no Admin ou por telefone.

---

## 4. Funções por arquivo (lado Hermes, no Pi)

### `index.js` (raiz)
Entrypoint. Só `require('./core/bootstrap').start()`. Nenhuma lógica aqui.

### `core/bootstrap.js`
`iniciarSocket({papel, authDir, aoAbrirPelaPrimeiraVez})` — sobe um socket
Baileys (`principal` sempre, `backup` se `papel.backupAtivo()`). Trata
`connection.update` (QR → Telegram; `close` → reconecta, exceto
`loggedOut`; `open` → liga jobs de fundo **uma vez por papel**, nunca de
novo em reconexão — `jobsIniciados` é estado de módulo, não de closure).
Roteia toda mensagem recebida pra `router.processarMensagem`.

### `core/scheduler.js`
`agendar(nome, intervaloMs, fn)` — único ponto que cria `setInterval` no
projeto. Não dá `clearInterval` (por isso o cuidado com `jobsIniciados`
acima — reiniciar um job duplicaria o timer).

### `services/simeApi.js`
Cliente HTTP único pro SIME. Ver seção 2.

### `services/heartbeat.js`
Mapa de conexão `{ principal, backup }` (`setWhatsappConectado`/
`estaConectado`) — usado pelo gate de failover do `router.js` e pelo
comando `status`. `moduleStatusText()` monta o texto de saúde de todos os
módulos (agrega `health()` de cada um).

### `services/telemetria.js`
Ver seção 3.1. Estado indexado por componente (`estadoDe`), pra os dois
sockets (quando há backup) não pisarem um no estado do outro.

### `services/monitor.js`
Monitor de temperatura do Pi — a cada 3 min (`TEMP_CHECK_INTERVAL_MS`), se
≥75°C (`TEMP_ALERT_THRESHOLD_C`) alerta `ADMIN_NUMBERS` + Telegram; avisa
uma vez quando normaliza. Não fala com o SIME.

### `services/papel.js`
Só `backupAtivo()` — lê `HERMES_BACKUP_ATIVO` do `.env`.

### `services/logger.js`
`sendTelegramText`/`sendTelegramPhoto` — HTTP direto pra API do Telegram
(`sendMessage`/`sendPhoto`). **Só saída** — não existe bot escutando comando
do lado do Telegram hoje.

### `services/speedtest.js`
`runSpeedTest()` — usado pelo comando WhatsApp `velocidade`/`speedtest`.
Não fala com o SIME.

### `modules/whatsapp/router.js`
Ponto único de entrada de mensagem (`processarMensagem(sock, msg, papel)`).
Decide: Daniella (resposta automática) → grupo monitorado (gate de
failover + `eventosDiaD` e `confirmacao` em paralelo) → resposta SIM/NÃO de
campanha (`identidade.processarResposta`) → comandos administrativos
(`comandos.processarComando`). A ordem importa — o primeiro bloco que casar
decide e encerra (ver diagrama completo na seção 5.6).

### `modules/whatsapp/eventosDiaD.js`
Ver seção 3.6 — modo proposta, nunca grava.

### `modules/whatsapp/confirmacao.js`
`processarMensagemGrupo` — keyword matching + fallback IA pra
confirmação/recusa de mesário em grupo (`hermes-mesarios`). Também exporta
`buscarConvocacaoPorNome` (usada por `hermes-mesarios acao=buscar_nome`) —
disponível mas não acionada automaticamente (seção 3.2).

### `modules/whatsapp/notificacoes.js`
Ver seção 3.3.

### `modules/whatsapp/comandos.js`
Comandos individuais (DM) — **todo o canal exige `ADMIN_NUMBERS`** desde
06/08/2026 (quem não está na lista não recebe nenhuma resposta, nem "sem
permissão"). Comandos: `status`, `pausar envio`/`retomar envio` (controla
`dispatch.js`), `fila` (status da fila de campanha), `velocidade`/
`speedtest`, `reiniciar raspberry` (+ `confirmar reiniciar`), `trocar
papel`/`trocar principal` (+ `confirmar troca` — swap `auth_info`↔
`auth_info_backup` + `pm2 restart`). Os de risco (`reiniciar raspberry`,
`trocar papel`) são bloqueados durante `CRITICAL_PERIODS` (`config.js`) e
exigem confirmação explícita com expiração de 30s.

### `modules/campanhas/dispatch.js` / `identidade.js`
Ver seção 3.4.

---

## 5. Fluxos completos

### 5.1 Pânico (energia/urna)
```
Mesário registra pânico no SIME_mesario.html
  → SIME enfileira em sime_notificacoes
  → Hermes drena (hermes-notificacoes, ciclo 30s)
  → WhatsApp (ADMIN_NUMBERS) + Telegram, com prefixo de escalonamento se idade_s alto
  → Hermes confirma (acao=confirmar) — sai da fila
```
Resolução pelo cartório usa o mesmo RPC do mesário — chega ao aparelho dele
via Realtime, não passa pelo Hermes.

### 5.2 Confirmação de mesário (grupo monitorado)
```
Mesário responde "sim"/"confirmo" no grupo
  → confirmacao.js: keyword matching (fallback IA se não achar)
  → POST /api/hermes-mesarios {acao:'confirmar', telefone}
  → grava sime_atores.confirmacao — visível no painel "Confirmação de mesários"
```

### 5.3 Campanha de convocação com confirmação de identidade
```
Cartório popula fila em SIME_atores.html → sime_campanhas_confirmacao
  → dispatch.js drena (ciclo 60s, só se DISPATCH_ATIVO=true)
  → manda 1ª mensagem (verificação) → status 'aguardando_resposta'
  → pessoa responde SIM/NÃO (DM)
  → identidade.js interpreta (lista fixa) → POST hermes-campanhas acao=responder
  → SIM → dispatch.js manda a convocação (texto + imagem) no próximo ciclo → 'finalizado'
  → NÃO → 'telefone_incorreto', nunca mais recebe nada desta campanha
  → sem resposta em 24h, até 3 tentativas → reenvia; esgotado → 'sem_resposta'
```

### 5.4 Telemetria + pedido de atualização
```
A cada 30s: telemetria.js coleta métricas → POST hermes-heartbeat acao=enviar
  → resposta traz atualizar_agora?
      sim → aviso único no Telegram (nunca aplica sozinho)
      não → segue normal
```

### 5.5 Failover dual-socket (backup)
```
HERMES_BACKUP_ATIVO=true → dois sockets no mesmo processo
principal conectado   → só principal processa mensagem de grupo
principal desconectado → backup assume (decisão LOCAL, sem round-trip pelo SIME)
```
Só afeta monitoria de grupo — fila de pânico e disparo em massa **nunca**
rodam no backup (`dispatch.iniciar`/`notificacoes.iniciar` só são chamados
na inicialização do socket principal), pra não duplicar notificação.

### 5.6 Ordem de decisão de uma mensagem recebida
```
mensagem chega
├─ fromMe? ──────────────────────────► ignora
├─ contato pessoal específico (Daniella)? ─► resposta automática, encerra
├─ é grupo?
│   ├─ grupo não monitorado ────────► ignora
│   ├─ gate de failover (papel==='backup' && principal conectado) ─► ignora
│   ├─ detecta evento de dia D (regex + fallback IA)
│   │   └─ propõe no Telegram (NÃO grava — modo proposta)
│   └─ detecta confirmação/recusa (keyword → fallback IA)
│       → grava via POST /api/hermes-mesarios
└─ DM individual
    ├─ resposta SIM/NÃO de campanha (identidade.js) → POST hermes-campanhas
    └─ comandos (TODOS exigem estar em ADMIN_NUMBERS, desde 06/08/2026 —
       quem não está, silêncio total, sem "sem permissão")
        ├─ status · fila · velocidade
        ├─ pausar envio / retomar envio (disparo em massa)
        ├─ reiniciar raspberry (com confirmação)
        └─ trocar papel (com confirmação — principal ↔ backup)
```
A ordem importa: o primeiro bloco que casar decide e encerra.

---

## 6. O que está ligado, o que não está (estado em 12/08/2026)

| Capacidade | Estado |
|---|---|
| Telemetria/heartbeat | ✅ em produção, `200` a cada ciclo |
| Fila de pânico (`hermes-notificacoes`) | ✅ drenada e enviada automaticamente |
| Confirmação de mesário em grupo | ✅ funcionando (keyword + fallback IA) |
| Disparo em massa (`hermes-campanhas`) | ⏸️ desligado (`DISPATCH_ATIVO=false`) |
| Detecção de evento de dia D (`hermes-update`) | ⏸️ modo proposta — nunca grava sozinho |
| Autoatendimento por telefone ("oi") | ⏸️ endpoint pronto, não ligado |
| Busca por nome automática | ⛔ suprimida (disparava em cima de conversa comum) |
| Escalonamento por papel (`hermes-contatos`) | ⏸️ endpoint pronto desde 08/08, não ligado |
| Atualização automática do Pi | ⛔ nunca aplica sozinho — decisão deliberada até depois da eleição |
| Backup dual-socket | ⏸️ opcional (`HERMES_BACKUP_ATIVO`), cobre só sessão do WhatsApp |
| 94ª Zona | ⛔ sem instância de Hermes |

---

## 7. Limites conhecidos

- **Ponto único de falha** — 1 Raspberry Pi 3B doméstico, Wi-Fi, sem
  redundância de hardware (o 2º número de WhatsApp cobre a sessão cair,
  não o Pi cair).
- **Rate limit de envio** — 5 msgs/min, pausa aleatória de 4–9s. Não
  aumentar: WhatsApp bane número em rajada.
- **Gemini free tier** — 1.500 requisições/dia; toda mensagem não
  reconhecida por regex gasta uma.
- **JID `@lid`** — o WhatsApp às vezes identifica o remetente por um ID
  interno em vez do telefone, o que impede casar com `sime_atores` e
  bloqueia confirmação automática.
- **94ª Zona sem instância** — só a 7ª tem Raspberry Pi rodando hoje.

---

## Referências
- `hermes/HERMES_RUNTIME.md` — arquitetura, deploy, árvore de arquivos, ordem dos handlers.
- `hermes/SIME_hermes_skill_heartbeat.md`, `_mesarios.md`, `_campanha.md`,
  `_notificar.md`, `_monitor.md`, `_updater.md`, `_escalonamento.md` —
  contrato de dados completo de cada endpoint (payloads, respostas, casos de erro).
- `CLAUDE.md` — pendências e decisões de produto (por que cada coisa está
  ligada/desligada).
