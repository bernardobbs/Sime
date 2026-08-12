# Hermes Agent — funções e comunicação com o SIME

Referência única: tudo que o Hermes faz e o contrato exato de cada chamada
com o SIME, num só lugar. Os documentos que já existiam continuam valendo
para o que cada um faz de melhor — este arquivo não os substitui, cruza com
eles:

| Se você quer... | Vá para |
|---|---|
| Rodar/instalar uma instância nova (zona 94ª) | `README.md` |
| Entender o processo real no Raspberry Pi (PM2, arquivos, armadilhas) | `HERMES_RUNTIME.md` |
| O schema de mensagem/template de 1 skill específica em detalhe | `SIME_hermes_skill_*.md` |
| **O que o Hermes faz, e como cada função fala com o SIME** | **este arquivo** |

Fonte: código lido diretamente de `api/hermes-*.js` (lado SIME, neste repo) e
do estado verificado em produção descrito em `HERMES_RUNTIME.md` (lado
Hermes, no Pi — não versionado neste repo).

---

## 1. O princípio que organiza tudo

**O Hermes nunca é alcançado de fora. Ele é sempre quem liga.**

Ele roda atrás do NAT de um roteador doméstico — sem IP fixo, sem porta
aberta, sem túnel, sem domínio. Se o SIME precisasse chamá-lo, isso exigiria
infraestrutura que não existe. Em vez disso, o Hermes **pergunta** ao SIME a
cada ciclo (`SIME_POLL_INTERVALO`, hoje 30s):

```
Hermes ──POST──▶ /api/hermes-update         escreve eventos de seção
Hermes ──POST──▶ /api/hermes-mesarios       lê mesários, grava confirmação
Hermes ──POST──▶ /api/hermes-notificacoes   busca a fila de pânico/mídia
Hermes ──POST──▶ /api/hermes-campanhas      busca a fila de disparo em massa
Hermes ──POST──▶ /api/hermes-contatos       resolve telefone por papel
Hermes ──POST──▶ /api/hermes-heartbeat      reporta telemetria + checa update
```

Custo desse desenho: até um ciclo de atraso entre o evento e a ação (ex.:
pânico → WhatsApp). Para um escalonamento que começa em 10 minutos, 30s é
irrelevante.

**Autenticação — 1 segredo por zona**, igual nos 6 endpoints: header
`Authorization: Bearer HERMES_SECRET_ZONA_<numero>`. Cada instância do
Hermes atende **uma zona só** e enxerga apenas a fila dela — o secret é
quem decide isso, não um campo no corpo da requisição. `HERMES_URL` **não**
é definida na Vercel: existir criaria a tentação de empurrar notificação
direto, o que exigiria um Hermes alcançável — e ele não é.

---

## 2. Os 6 endpoints (SIME ← Hermes)

Todos: `POST`, corpo JSON, resposta JSON com `ok:true/false`. Erro de auth
→ `401`. Zona não cadastrada → `400`/`500` conforme o endpoint.

### `/api/hermes-update` — grava eventos de seção (dia D)

| Ação | — não tem `acao`, o corpo já diz o quê |
|---|---|
| Corpo | `{ secao, evento, valor?, remetente?, remetente_nome?, origem? }` |
| Eventos aceitos | `enc` · `vot` · `zeresima` · `fila` · `panico_energia` · `panico_urna` · `panico_resolvido` · `urna` · `midia_pronta` · `mesa_completa` |
| Resposta OK | `{ ok:true, secao, campo, valor, ts_servidor, local, cidade, mensagem_wa }` |

Cada evento mapeia pra um campo de `sime_mesa_estado` (bool ou int), exceto:
`panico_resolvido` (baixa o pânico ativo, sem sobrescrever o que não foi
tocado), `mesa_completa` (marca os 4 membros de uma vez) e `midia_pronta`
(grava em `sime_midias`, tabela separada). `panico_energia`/`panico_urna`
disparam, na mesma chamada, uma notificação de volta pro Hermes
(`chamarHermes('sime_notificar', ...)`) — só funciona se `HERMES_URL`
estiver definida, o que **não é o caso em produção**; na prática esse
aviso imediato não sai, e quem drena o pânico de verdade é a fila (seção
abaixo). Timestamp sempre vem de `sime_now()` no servidor, nunca do
dispositivo.

> **Ainda em modo proposta**: `eventos.js` no Hermes detecta esses eventos
> em linguagem natural (regex + fallback IA) e propõe no Telegram pra
> validação humana — **nada no Hermes chama este endpoint automaticamente**
> hoje. Até isso mudar, "seção 63 encerrada" dito num grupo continua
> exigindo lançamento manual no Admin ou por telefone.

### `/api/hermes-mesarios` — lê/confirma mesários e apoio logístico

| Ação | O que faz |
|---|---|
| `listar` | Devolve mesários + apoio logístico da zona (nome, telefone, seção, status). |
| `consultar` | Autoatendimento: `{telefone}` → convocação(ões) da pessoa, já com `mensagem_wa` pronta. Cobre quem tem mais de 1 convocação (mesário **e** apoio logístico). |
| `buscar_nome` | Mesmo autoatendimento, mas por `{nome}` (substring, case-insensitive) — pra quem não manda do telefone cadastrado. |
| `atualizar` | `{telefone, mensagem}` — anexa um recado livre em `observacao`. **Nunca** sobrescreve nome/telefone/seção (dado oficial do TRE). |
| `confirmar` / `recusar` / `substituir` | `{telefone}` — grava `sime_atores.confirmacao` (`confirmado`/`recusou`/`substituido`) e `ativo` (recusar/substituir desativam a pessoa). |

Toda identificação por telefone casa por dígitos exatos **ou** pelos
últimos 8 (folga pra variação de DDI/DDD entre o que o WhatsApp manda e o
cadastro). Cada ação devolve `mensagem_wa` — o texto pronto pra mandar de
volta, sem o Hermes precisar montar frase nenhuma.

> **Estado real**: `confirmar`/`recusar`/`substituir` e `buscar_nome` estão
> em produção. `consultar` (autoatendimento por telefone, "oi" → função +
> seção) **não está ligado** no `index.js` — o gatilho automático de
> `buscar_nome` por texto solto foi **desligado de propósito** em
> 06/08/2026 (respondia "não encontrei ninguém" em cima de conversa comum).

### `/api/hermes-notificacoes` — fila de pânico/mídia (SIME → Hermes)

| Ação | O que faz |
|---|---|
| `pendentes` | Devolve até 50 notificações `pendente` da zona, mais antigas primeiro. Cada item traz `idade_s` (calculada no servidor) — é com ela que o Hermes decide o nível de escalonamento (10min/30min), sem depender do relógio do Pi. |
| `confirmar` | `{ids}` — marca como `enviado`. |
| `erro` | `{ids, erro_msg}` — marca `erro` + soma tentativa, pra não travar a fila. |

Notificação sem `secao_id` (ex.: sem alvo definido) fica de fora de
`pendentes` de propósito — não há como atribuí-la a uma zona, e mandar pra
todas vazaria dado entre cartórios. `confirmar`/`erro` conferem que os
`ids` pertencem à zona autenticada antes de tocar qualquer linha.

### `/api/hermes-campanhas` — fila de disparo em massa (SIME → Hermes)

Popula quem usa a aba "📢 Disparo em massa" de `SIME_atores.html`. Dois
fluxos:

- **Simples** (sem `mensagem_convocacao`): manda `mensagem_enviada` (+
  imagem opcional) — uma tacada só.
- **Com confirmação de identidade** (`mensagem_convocacao` preenchido):
  `pendente → aguardando_resposta → confirmado → finalizado`, com reenvio
  automático depois de 24h sem resposta (até 3 tentativas, depois vira
  `sem_resposta`, terminal).

| Ação | O que faz |
|---|---|
| `pendentes` | Até 100 itens prontos pra alguma ação agora, cada um já com `proxima_acao` (`enviar` / `enviar_verificacao` / `reenviar_verificacao` / `enviar_convocacao`). |
| `confirmar` | `{ids, novo_status?}` — avança o status (default `enviado`). |
| `erro` | `{ids, erro_msg}` — marca `erro` + soma tentativa. |
| `responder` | `{telefone, decisao, resposta_texto?}` — grava a resposta SIM/NÃO de quem recebeu a verificação (`decisao` = `confirmado` ou `telefone_incorreto`), casando por telefone (não por id — a resposta chega como mensagem normal de WhatsApp). |
| `resumo` | Contagem por status da zona inteira — pro Hermes postar um resumo periódico no Telegram. |

Envio de fato depende de `DISPATCH_ATIVO=true` no `.env` do Hermes —
**desligado por padrão**; popular a fila não garante que a mensagem saia.

> O endpoint já resolve `responder` associando a resposta ao item exato da
> campanha (`resposta_recebida`/`decisao_detectada`), lado SIME pronto. Se
> isso está de fato ligado ponta a ponta no Hermes (`modules/campanhas/
> identidade.js`, listado em `HERMES_RUNTIME.md`), verificar com quem opera
> o Pi antes de assumir — não está na tabela de "verificado em produção" de
> `HERMES_RUNTIME.md`.

### `/api/hermes-contatos` — telefone por papel (escalonamento)

| Ação | O que faz |
|---|---|
| `listar` | `{ contatos: { gestor_prob: [...], coordenador: [...] } }` — telefones ativos de Gestor de Problemas e Chefe de Cartório da zona, cadastrados por eles mesmos na aba Equipe do Admin. |

Só leitura. Lista vazia = ninguém daquele perfil cadastrou telefone ainda,
não é erro. **Decide só o "pra quem"** — o "quando" (10min/30min) continua
calculado pelo Hermes a partir do `idade_s` de `hermes-notificacoes`.

> **Endpoint pronto desde 08/08/2026, `index.js` ainda não o chama.** A
> fila de notificações hoje manda pra todos os `ADMIN_NUMBERS` do Hermes
> igual, independente do nível de escalonamento.

### `/api/hermes-heartbeat` — telemetria + pedido de atualização

| Ação | O que faz |
|---|---|
| `enviar` | `{componente?, telemetria}` — grava heartbeat (versão, uptime, CPU/RAM/temperatura, disco, status WhatsApp/Telegram) e devolve, na mesma resposta, se há atualização pedida (`atualizar_agora`, `versao_desejada`) — evita 2ª chamada no ciclo. |
| `confirmar_atualizacao` | `{versao, commit_hash}` — Hermes terminou de atualizar; grava o que ficou instalado, zera o pedido. |
| `erro_atualizacao` | `{erro_msg}` — Hermes tentou e falhou; grava o erro, zera o pedido (não fica retentando sozinho). |
| `componentes` | Idade do heartbeat (`idade_s`, relógio do servidor) de cada componente da zona — usado pelo 2º socket de WhatsApp (backup) pra decidir se o principal parou de reportar. |

Por que via endpoint e não UPSERT direto com service key: desde
03/08/2026 `index.js` não fala mais com o Supabase direto (corrigido depois
de um bug real de escrita com coluna errada). **Não existe `git pull`/`npm
install`/`pm2 reload` automático em lugar nenhum** — "Solicitar
atualização" no Admin só marca o pedido; aplicar continua manual, decisão
deliberada pra não arriscar uma sessão WhatsApp pedindo QR Code de novo no
meio da operação.

---

## 3. Funções do lado Hermes (o que roda no Pi)

Not a wishlist — isto é o estado **verificado em produção**, reconciliado
em 03/08/2026 (ver detalhe completo em `HERMES_RUNTIME.md`, seção 5):

| Função | Estado |
|---|---|
| Sessão WhatsApp (Baileys), reconexão automática | ✅ |
| Bot Telegram (texto + foto/QR) | ✅ |
| Fallback de IA (Gemini Flash) quando regex não resolve | ✅ |
| Keywords de confirmação/recusa + aprendizado | ✅ 13 confirmações / 17 recusas, cresce sozinho |
| Confirmação/recusa de mesário → grava no SIME | ✅ via `hermes-mesarios` |
| Busca de convocação por nome (DM) | ✅ via `hermes-mesarios acao=buscar_nome` |
| Fila de pânico/mídia drenada e enviada | ✅ a cada `SIME_POLL_INTERVALO`s |
| Disparo em massa drenado e enviado | ✅ — **desligado por padrão** (`DISPATCH_ATIVO=false`) |
| Comandos `fila`/`pausar envio`/`retomar envio` | ✅ |
| Detecção de eventos de seção (`eventos.js`) | ⚠️ detecta e propõe no Telegram — **não grava** |
| Autoatendimento por telefone ("oi" → função+seção) | ❌ endpoint pronto, não chamado |
| Escalonamento por papel (`hermes-contatos`) | ❌ endpoint pronto, não chamado |
| Heartbeat/telemetria pro SIME | ✅ a cada ciclo |
| 2º número de WhatsApp no mesmo Pi (monitoria de grupo) | ✅ opcional, `HERMES_BACKUP_ATIVO=true` |
| Comando `status` (PM2, temperatura, CPU, RAM, disco, uptime) | ✅ |
| Comando `velocidade` (speedtest real) | ✅ |
| Monitor de temperatura (alerta ≥75°C) | ✅ |
| Reboot remoto via WhatsApp | ⚠️ implementado, não confirmado em teste |

---

## 4. Ordem de decisão de uma mensagem recebida

```
mensagem chega
├─ fromMe? ──────────────────────────► ignora
├─ contato pessoal específico? ──────► resposta automática, encerra
├─ é grupo?
│   ├─ grupo não monitorado ────────► ignora
│   ├─ detecta evento de dia D (regex + fallback IA)
│   │   └─ propõe no Telegram (NÃO grava — modo proposta)
│   └─ detecta confirmação/recusa (keyword → fallback IA)
│       → grava via POST /api/hermes-mesarios
└─ DM individual → comandos (TODOS exigem estar em ADMIN_NUMBERS,
   desde 06/08/2026 — quem não está, silêncio total, sem "sem permissão")
    ├─ status · fila · velocidade
    ├─ pausar envio / retomar envio (disparo em massa)
    ├─ reiniciar raspberry (com confirmação)
    └─ trocar papel (com confirmação — principal ↔ backup)
```

A ordem importa: o primeiro bloco que casar decide e encerra. Detalhe
completo, com o histórico de por que cada regra existe, em
`HERMES_RUNTIME.md` §4.

---

## 5. Limites conhecidos

- **Ponto único de falha** — 1 Raspberry Pi 3B doméstico, Wi-Fi, sem
  redundância de hardware (o 2º número de WhatsApp cobre a sessão cair,
  não o Pi cair).
- **Rate limit de envio** — 5 msgs/min, pausa aleatória de 4–9s. Não
  aumentar: WhatsApp bane número em rajada.
- **Gemini free tier** — 1.500 requisições/dia; toda mensagem não
  reconhecida por regex gasta uma, inclusive "bom dia".
- **JID `@lid`** — o WhatsApp às vezes identifica o remetente por um ID
  interno em vez do telefone, o que impede casar com `sime_atores` e
  bloqueia confirmação automática.
- **94ª Zona sem instância** — só a 7ª tem Raspberry Pi rodando hoje.
