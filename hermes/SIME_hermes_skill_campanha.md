# SKILL: sime_campanha
description: Drena a fila de disparo em massa (confirmação de mesários/apoio logístico, avisos, alerta anti-golpe) populada pelo SIME e envia pelo WhatsApp do próprio Hermes.
triggers:
  - loop periódico consultando a fila em /api/hermes-campanhas (modo padrão)

---

## Objetivo

Enviar as mensagens que o cartório monta na aba "📢 Disparo em massa" de
`SIME_atores.html` (modelo de confirmação, alerta anti-golpe, ou mensagem
livre) para quem está na fila — sem duplicar `sime_notificar` (que cobre
eventos automáticos como pânico) nem `sime_mesarios` (que já cuida da
resposta SIM/NÃO/substituto de quem recebeu).

## Por que puxar em vez de empurrar

Mesmo motivo de `sime_notificar`: o Hermes roda no PC do cartório, **atrás do
NAT do roteador** — sem endereço público. Quem inicia a conexão é sempre ele.

## Loop principal (a cada 30 s, mesmo intervalo do `sime_notificar`)

**Só roda se `DISPATCH_ATIVO=true`** no `.env` do Hermes. Popular a fila não
autoriza o envio — isso é decisão de quem opera o Raspberry Pi.

```
POST https://sime-cyan.vercel.app/api/hermes-campanhas
Authorization: Bearer HERMES_SECRET_ZONA_7
Content-Type: application/json

{ "acao": "pendentes" }
```

Resposta:

```json
{
  "ok": true,
  "zona": "7",
  "campanhas": [
    {
      "id": "3f2a...",
      "ator_id": "9c1b...",
      "telefone": "5586999990001",
      "mensagem": "🚨 AVISO IMPORTANTE — SIME 🚨\n\n...",
      "tentativas": 0,
      "criado_em": "2026-09-20T09:00:00.000Z"
    }
  ]
}
```

Item sem mensagem cadastrada já **não aparece** aqui — o endpoint filtra antes
de devolver.

### Rate limit: 5 msgs/min

Igual ao `sime_notificar`: **intervalo mínimo de 12 segundos entre envios**
desta fila. Uma zona inteira (~500–700 pessoas) leva 1h30–2h20 — não é
instantâneo, e não deve ser acelerado (risco de ban do número).

Depois de cada envio, **confirme** — senão a mensagem volta e é reenviada no
próximo ciclo:

```
{ "acao": "confirmar", "ids": ["3f2a..."] }
```

Se puder verificar se o número tem WhatsApp antes de mandar, informe junto
(campo opcional, em `confirmar` ou `erro`):

```
{ "acao": "confirmar", "ids": ["3f2a..."], "whatsapp_existe": true }
```

Se o envio falhar (WhatsApp desconectado, número inválido, número sem
WhatsApp), marque o erro — isso incrementa `tentativas` e tira o item da fila
(não fica reenviando pra sempre):

```
{ "acao": "erro", "ids": ["3f2a..."], "erro_msg": "número não existe no WhatsApp", "whatsapp_existe": false }
```

### Isolamento por zona

O Bearer identifica a zona. Um `id` que não pertence à zona autenticada volta
`404` em `confirmar`/`erro` — nunca altera item de outra zona.

## O que NÃO fazer

- Não reenviar pra quem já está `enviado` — a fila já filtra isso.
- Não inventar retry automático além do que o próprio ciclo de 30s já faz —
  um item com `erro` fica assim (o cartório decide se repopula a fila).
- Não usar esta fila para eventos de seção (pânico, encerramento, etc.) — isso
  é `sime_notificar`. Nem para a resposta SIM/NÃO de convocação — isso é
  `sime_mesarios`.

## Log de envios

Registrar cada envio em `sime_logs` já é feito pelo próprio endpoint
(`hermes_campanhas` / `campanha_confirmar` ou `campanha_erro`) — não precisa
duplicar do lado do Hermes.

## Ainda não implementado — capturar resposta

`sime_campanhas_confirmacao` tem colunas para guardar a resposta de quem
recebeu (`resposta_recebida`, `ts_respondido`, `decisao_detectada`), mas este
endpoint ainda não expõe uma ação para gravar isso. Hoje, se alguém responde a
uma campanha de confirmação, o caminho é o de sempre: `sime_mesarios`
(`confirmar`/`recusar`/`substituir`) ou, pra qualquer outro tipo de resposta,
`atualizar` (vira anotação em `observacao` pro cartório revisar).
