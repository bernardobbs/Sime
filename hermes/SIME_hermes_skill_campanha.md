# SKILL: sime_campanha
description: Drena a fila de disparo em massa (confirmação de mesários/apoio logístico, avisos, alerta anti-golpe, convocação com confirmação de identidade) populada pelo SIME e envia pelo WhatsApp do próprio Hermes.
triggers:
  - loop periódico consultando a fila em /api/hermes-campanhas (modo padrão)
  - mensagem individual (DM) que parece resposta SIM/NÃO a uma verificação de identidade
  - job horário postando o resumo da campanha no Telegram

---

## Objetivo

Enviar as mensagens que o cartório monta na aba "📢 Disparo em massa" de
`SIME_atores.html` para quem está na fila — sem duplicar `sime_notificar`
(eventos automáticos como pânico) nem o autoatendimento de `sime_mesarios`
("oi"/busca por nome).

Dois modelos usam este fluxo: **texto simples** (alerta anti-golpe, mensagem
livre — sempre existiu) e **convocação com confirmação de identidade** (novo
— confirma que o número ainda é da pessoa antes de mandar a convocação).

## Por que puxar em vez de empurrar

Mesmo motivo de `sime_notificar`: o Hermes roda atrás do **NAT do roteador**
— sem endereço público. Quem inicia a conexão é sempre ele.

---

## Dois fluxos de campanha

### Simples (sempre existiu)

Uma mensagem só (texto, ou texto+imagem), sem esperar resposta:

```
pendente ──envia──▶ enviado
```

### Convocação com confirmação de identidade

Antes de mandar informação de convocação, confirma que o número ainda é da
pessoa. Só existe quando o item tem `mensagem_convocacao` preenchida.

```
pendente
  └─ envia mensagem_enviada (verificação: "este telefone ainda é de Fulano?")
     ▼
aguardando_resposta
  ├─ SIM ──▶ confirmado
  │            └─ envia mensagem_convocacao + imagem_url
  │               ▼
  │            finalizado
  ├─ NÃO ──▶ telefone_incorreto  (terminal — nunca mais recebe nada desta campanha)
  └─ sem resposta em 24h, até 3 tentativas ──▶ reenvia a verificação
       (esgotadas as tentativas) ──▶ sem_resposta  (terminal)
```

Quem classifica a resposta em linguagem natural (SIM/NÃO) é o **Hermes**
(lista fixa de respostas aceitas, não é IA — errar aqui decide se a pessoa
recebe dado de convocação ou não). O endpoint só recebe a decisão já
resolvida via `acao=responder`.

---

## Loop principal (a cada 60 s)

**Só roda se `DISPATCH_ATIVO=true`** no `.env` do Hermes. Popular a fila não
autoriza o envio — isso é decisão de quem opera o Raspberry Pi.

```
POST https://sime-cyan.vercel.app/api/hermes-campanhas
Authorization: Bearer HERMES_SECRET_ZONA_7
Content-Type: application/json

{ "acao": "pendentes" }
```

Resposta — cada item já vem com `proxima_acao` dizendo o que fazer, o
endpoint decide isso, não o Hermes:

```json
{
  "ok": true,
  "zona": "7",
  "campanhas": [
    {
      "id": "3f2a...",
      "ator_id": "9c1b...",
      "telefone": "5586999990001",
      "proxima_acao": "enviar_verificacao",
      "mensagem": "Olá! 👋\n\nMeu nome é Bernardo...",
      "imagem_url": null,
      "tentativas": 0,
      "criado_em": "2026-09-20T09:00:00.000Z"
    }
  ]
}
```

`proxima_acao` é uma de:

| Valor | O que fazer | Depois, confirmar com |
|---|---|---|
| `enviar` | Manda `mensagem` (com `imagem_url` se vier) | `{acao:'confirmar', ids:[id]}` (default → `enviado`) |
| `enviar_verificacao` | Manda só `mensagem` (texto de verificação, sem imagem) | `{acao:'confirmar', ids:[id], novo_status:'aguardando_resposta'}` |
| `reenviar_verificacao` | Igual acima — é um retry automático (ver seção abaixo) | mesmo de `enviar_verificacao` |
| `enviar_convocacao` | Manda `mensagem` (texto da convocação), depois `imagem_url` (se vier), **nessa ordem** | `{acao:'confirmar', ids:[id], novo_status:'finalizado'}` |

Item sem mensagem pra etapa atual já **não aparece** aqui — o endpoint filtra
antes de devolver.

### Rate limit: 5 msgs/min

Igual ao `sime_notificar`: intervalo de alguns segundos entre envios desta
fila (o Hermes real usa uma pausa aleatória de 4–9s por mensagem). Uma zona
inteira (~500–700 pessoas) leva mais de uma hora — não é instantâneo, e não
deve ser acelerado (risco de ban do número).

Depois de cada envio, **confirme** — senão o item volta e é reenviado no
próximo ciclo:

```
{ "acao": "confirmar", "ids": ["3f2a..."] }
{ "acao": "confirmar", "ids": ["3f2a..."], "novo_status": "aguardando_resposta" }
{ "acao": "confirmar", "ids": ["3f2a..."], "novo_status": "finalizado" }
```

`novo_status` aceita `enviado` (default), `aguardando_resposta` ou
`finalizado` — qualquer outro valor é ignorado e cai no default.
`aguardando_resposta` também incrementa `tentativas` e marca `ts_enviado`
(usado pra calcular quando reenviar).

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

### Retry da verificação (sem resposta)

Um item `aguardando_resposta` só reaparece em `pendentes` (como
`reenviar_verificacao`) depois de **24h sem resposta**. Depois de **3
tentativas** (a inicial + 2 reenvios), o próprio endpoint marca o item como
`sem_resposta` (terminal) automaticamente — não precisa de nenhuma ação do
Hermes pra isso, acontece no início do próximo `pendentes`.

---

## Registrar a resposta SIM/NÃO — `acao=responder`

Chamado pelo Hermes quando uma mensagem individual (DM) casa com uma das
respostas reconhecidas. Casa por **telefone** (últimos 8 dígitos, mesma regra
de `sime_mesarios`), contra itens `aguardando_resposta` da zona autenticada —
se houver mais de um casando, usa o mais recente.

```
POST /api/hermes-campanhas
{ "acao": "responder", "telefone": "5586999990001", "decisao": "confirmado", "resposta_texto": "sim" }
```

`decisao` só aceita `confirmado` ou `telefone_incorreto`. Resposta:

```json
{ "ok": true, "id": "3f2a...", "status": "confirmado" }
```

`404` se não houver nenhuma campanha `aguardando_resposta` desse telefone
nesta zona — não é erro, só não tinha nada pendente (a pessoa já respondeu
antes, ou mandou "sim" sem contexto).

### Respostas reconhecidas (lista fixa, sem IA)

| Decisão | Textos aceitos (normalizado: minúsculo, sem pontuação no fim) |
|---|---|
| `confirmado` | `1`, `sim`, `s`, `sou eu`, `isso`, `confirmo`, `correto` |
| `telefone_incorreto` | `2`, `não`, `nao`, `n`, `não é`, `nao é`, `telefone errado`, `número errado`, `numero errado`, `outra pessoa` |

Texto que não casa com nenhuma das duas listas **não é resposta desta
campanha** — o Hermes deixa cair pro resto do roteamento normal (comandos,
busca por nome, etc.), não intercepta.

---

## Resumo horário — `acao=resumo`

```
POST /api/hermes-campanhas
{ "acao": "resumo" }
```

```json
{ "ok": true, "zona": "7", "total": 214, "contagem": {
  "finalizado": 180, "aguardando_resposta": 12, "telefone_incorreto": 8,
  "confirmado": 3, "erro": 5, "sem_resposta": 6
}}
```

Fotografia do status atual da zona inteira (não só "desde o último resumo").
O Hermes chama isso de hora em hora e posta um resumo formatado no Telegram
— é assim que o cartório sabe se as mensagens estão sendo entregues sem
precisar abrir o Supabase.

---

### Isolamento por zona

O Bearer identifica a zona. Um `id`/`telefone` que não pertence à zona
autenticada volta `404` em `confirmar`/`erro`/`responder` — nunca altera item
de outra zona.

## O que NÃO fazer

- Não reenviar pra quem já está `enviado`/`finalizado`/`telefone_incorreto`/
  `sem_resposta` — a fila já filtra isso.
- Não inventar retry além do que o próprio endpoint já calcula (24h, 3
  tentativas) — mudar esses números é editar `api/hermes-campanhas.js`, não
  decisão do Hermes.
- Não usar esta fila para eventos de seção (pânico, encerramento, etc.) — isso
  é `sime_notificar`. Nem para a confirmação de permanência na função de quem
  já está sabidamente cadastrado como mesário — isso é `sime_mesarios`
  (`consultar`/`confirmar`/`recusar`/`substituir`).
- Não classificar a resposta SIM/NÃO com IA — lista fixa, ver tabela acima.

## Log de envios

Registrar cada envio/resposta em `sime_logs` já é feito pelo próprio endpoint
(`hermes_campanhas` / `campanha_confirmar`, `campanha_erro`,
`campanha_respondida`) — não precisa duplicar do lado do Hermes.
