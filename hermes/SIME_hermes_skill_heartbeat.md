# SKILL: sime_heartbeat
description: Reporta telemetria do Hermes ao SIME a cada ciclo e verifica se o cartório pediu uma atualização remota.
triggers:
  - a cada ciclo do loop principal (mesmo timer de `sime_notificar`/`sime_campanha`, ex.: `SIME_POLL_INTERVALO`)
  - depois de aplicar (ou falhar em aplicar) uma atualização pedida pelo SIME

---

## Objetivo

Dar ao SIME visibilidade de "o Hermes está vivo?" (heartbeat + telemetria) e
um jeito de pedir atualização remota sem nunca precisar alcançar o Pi
diretamente — o SIME só marca um pedido; o Hermes é quem pergunta e decide
atender, mesmo modelo de pull de `sime_notificar`/`sime_campanha`.

**Por que via endpoint, e não Supabase direto**: `index.js` não fala mais
com o Supabase desde 03/08/2026 (ver `hermes/HERMES_RUNTIME.md`, seção 3) —
foi corrigido depois de um bug real de escrita com coluna errada. Toda
gravação do Hermes passa por endpoint com `HERMES_SECRET` como Bearer, sem
exceção. Este skill segue a mesma regra.

## Endpoint alvo

```
POST https://sime-cyan.vercel.app/api/hermes-heartbeat
Authorization: Bearer <HERMES_SECRET_ZONA_x>
Content-Type: application/json
```

## Ações

### 1. `enviar` — telemetria do ciclo
```json
{
  "acao": "enviar",
  "telemetria": {
    "versao": "1.2.0",
    "commit_hash": "abcdef1234",
    "uptime_s": 7200,
    "mem_mb": 436,
    "cpu_pct": 18,
    "temperatura_c": 61,
    "disco_livre_mb": 2100,
    "ip": "192.168.0.42",
    "node_version": "v20.19.2",
    "whatsapp_status": "conectado",
    "telegram_status": "conectado",
    "ultima_sincronizacao": "2026-08-04T17:10:00.000Z"
  }
}
```
Todos os campos de `telemetria` são opcionais — manda o que o `status.js`
já calcula, sem inventar campo novo só pra preencher. `componente` é
opcional, default `"hermes"` (existe pra quando `hermes-telegram` também
quiser reportar heartbeat próprio, no futuro).

Resposta — já vem com a resposta de "tem atualização pedida?" no mesmo
request, pra não gastar uma chamada a mais no ciclo:
```json
{ "ok": true, "atualizar_agora": false, "versao_desejada": null }
```
Se `atualizar_agora: true`, `versao_desejada` traz a versão/tag que o admin
pediu (ou `null` = "a mais recente publicada").

### 2. `confirmar_atualizacao` — terminou de atualizar com sucesso
```json
{ "acao": "confirmar_atualizacao", "versao": "1.3.0", "commit_hash": "9f8e7d6" }
```
Grava a versão/commit instalados, zera o pedido pendente (`atualizar_agora`
volta a `false`).

### 3. `erro_atualizacao` — tentou e falhou
```json
{ "acao": "erro_atualizacao", "erro_msg": "npm install falhou: ENOSPC" }
```
Zera o pedido pendente (não fica tentando pra sempre sozinho) e grava o erro
pro cartório ver no painel — precisa de intervenção humana antes de pedir de
novo.

## Fluxo de um ciclo normal

```
1. Loop principal (a cada SIME_POLL_INTERVALO): monta telemetria via status.js
2. sime_heartbeat {acao:'enviar', telemetria:{...}}
3. Se atualizar_agora === true na resposta:
     a. git pull / npm install / pm2 reload (ou o mecanismo que o Hermes usar)
     b. sucesso → sime_heartbeat {acao:'confirmar_atualizacao', versao, commit_hash}
     c. falha   → sime_heartbeat {acao:'erro_atualizacao', erro_msg}
```

## CRÍTICO

- Timestamp do heartbeat é sempre o do servidor (o endpoint chama
  `sime_now()`) — nunca confiar no relógio do Pi pra decidir "online/offline"
  do lado do SIME.
- **Nunca aplicar atualização automaticamente sem revisão perto da eleição**
  (04/10/2026) — uma sessão Baileys que precisa de novo QR Code no meio da
  operação é pior que rodar uma versão atrasada. Até segunda ordem, tratar
  `atualizar_agora: true` como um aviso pro Telegram, não como gatilho de
  `git pull` automático — a decisão de automatizar isso é operacional, de
  quem cuida do Pi, não deste contrato de dados.
- `sime_componentes`/`sime_heartbeat` são por zona — cada instância só vê e
  grava a própria linha, resolvida pelo mesmo Bearer dos demais endpoints.
