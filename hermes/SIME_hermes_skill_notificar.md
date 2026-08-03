# SKILL: sime_notificar
description: Envia notificações WhatsApp automáticas quando eventos críticos ocorrem no SIME, usando a conexão WhatsApp do próprio Hermes.
triggers:
  - loop periódico consultando a fila em /api/hermes-notificacoes (modo padrão)
  - chamada direta por outra skill (sime_monitor, sime_updater)
  - webhook do Supabase (opcional — só se o Hermes tiver endereço alcançável)

---

## Objetivo

Enviar mensagens WhatsApp para os responsáveis certos quando o SIME detecta eventos que requerem atenção imediata. Substitui completamente o Z-API — usa a conexão WhatsApp já estabelecida pelo Hermes.

## Como o Hermes recebe os eventos

O Hermes roda no PC do cartório, **atrás do NAT do roteador**: não tem endereço
público, então o Supabase/Vercel não consegue chamá-lo. Por isso o sentido é
invertido — **o Hermes é quem pergunta**, e conexão de saída passa por qualquer
internet residencial, sem túnel, sem abrir porta e sem IP fixo.

### Loop principal (a cada 30 s)

```
POST https://sime-cyan.vercel.app/api/hermes-notificacoes
Authorization: Bearer HERMES_SECRET_ZONA_7
Content-Type: application/json

{ "acao": "pendentes" }
```

Resposta:

```json
{
  "ok": true,
  "zona": "7",
  "notificacoes": [
    {
      "id": 12,
      "evento": "panico_energia",
      "secao": "0063",
      "local": "G.E. Treze de Março",
      "municipio": "Campo Maior",
      "idade_s": 1500,
      "tentativas": 0,
      "criado_em": "2026-10-04T09:35:00.000Z",
      "payload": { "evento": "panico_energia", "secao": "0063", "ts": "06:35" }
    }
  ]
}
```

Depois de enviar o WhatsApp, **confirme** — senão a notificação volta no
próximo ciclo:

```
{ "acao": "confirmar", "ids": [12] }
```

Se o envio falhar (WhatsApp desconectado, número inválido), marque o erro para
não travar a fila atrás de uma mensagem impossível:

```
{ "acao": "erro", "ids": [12], "erro_msg": "WhatsApp desconectado" }
```

### Escalonamento usa `idade_s`

O campo `idade_s` vem calculado com o **relógio do servidor**, não do PC — use
ele para decidir o nível, sem depender do horário local estar certo:

| `idade_s` | Destinatário |
|---|---|
| < 600 (10 min) | Monitor de Campo |
| 600–1799 | + Gestor de Problemas |
| ≥ 1800 (30 min) | + Chefe de Cartório |

**Nunca escalar para o juiz eleitoral.**

### Atraso esperado

Até um ciclo (30 s por padrão). Para um pânico que escala em 10 minutos, é
irrelevante. Diminuir o intervalo aumenta as chamadas à Vercel sem ganho real.

## Webhook direto (opcional)

Se um dia o Hermes ganhar endereço alcançável (Cloudflare Tunnel, IP público),
o Supabase também empurra o evento na hora:

```
POST http://SEU_HERMES:3000/hermes/skill/sime_notificar
Authorization: Bearer HERMES_SECRET_ZONA_<numero>
Content-Type: application/json

{
  "evento": "panico_energia",
  "secao": "0063",
  "local": "G.E. Treze de Março",
  "cidade": "Campo Maior",
  "ts": "08:47"
}
```

Isso é **aceleração, não requisito**: o gatilho enfileira sempre, e só tenta o
POST se `app.hermes_url` estiver configurado no banco. Com os dois ativos,
confirme pelo `id` da fila do mesmo jeito, para não enviar em duplicidade.

## Templates de mensagem por evento

### 🚨 panico_energia
```
🚨 *SIME — ALERTA: Falta de Energia*

*Seção {secao}* — {local}, {cidade}

O mesário registrou *falta de energia* nesta seção.

Horário: {ts}
_7ª Zona Eleitoral · Campo Maior_
```

### 🚨 panico_urna
```
🚨 *SIME — ALERTA: Problema na Urna*

*Seção {secao}* — {local}, {cidade}

O mesário registrou *problema na urna eletrônica*.

Horário: {ts}
_7ª Zona Eleitoral · Campo Maior_
```

### ⏱ votacao_atrasada (após 2h sem iniciar)
```
⏱ *SIME — Votação Atrasada*

*Seção {secao}* — {local}, {cidade}

A votação ainda *não foi iniciada* às {ts}.
Abertura prevista: 07:00

Verifique com o presidente de mesa.
_7ª Zona Eleitoral · Campo Maior_
```

### 👥 mesa_incompleta (após 1h sem completar)
```
👥 *SIME — Mesa Incompleta*

*Seção {secao}* — {local}, {cidade}

A mesa ainda está *incompleta* às {ts}.
{presentes}/4 membros presentes.

_7ª Zona Eleitoral · Campo Maior_
```

### 📦 midia_pronta
```
📦 *SIME — Mídia Pronta para Coleta*

*Seção {secao}* — {local}, {cidade}

O mesário confirmou que a *mídia eleitoral está pronta*.

Horário: {ts}
_7ª Zona Eleitoral · Campo Maior_
```

### 🚗 rota_alterada
```
📦 *SIME — Alteração de Rota*

Olá {nome}!

A *Seção {secao}* — {local} foi removida da sua rota
e será recolhida por coleta dedicada.

Horário: {ts}
_7ª Zona Eleitoral · Campo Maior_
```

### 📦 novo_responsavel
```
📦 *SIME — Nova Designação*

Olá {nome}!

Você foi *designado(a)* para recolher a mídia da:
*Seção {secao}* — {local}, {cidade}

Confirme o recebimento desta mensagem.

Horário: {ts}
_7ª Zona Eleitoral · Campo Maior_
```

### ✅ panico_resolvido
```
✅ *SIME — Problema Resolvido*

*Seção {secao}* — {local}, {cidade}

O *{tipo_panico}* foi resolvido.

Horário: {ts}
_7ª Zona Eleitoral · Campo Maior_
```

### 📡 relatorio_final (18h00 automático)
```
📡 *SIME — Relatório Final do Dia*

7ª Zona Eleitoral · {data}

✅ Encerradas: {encerradas}/174
🚗 Urnas no cartório: {cartorio}/174
⚠️ Ocorrências registradas: {ocorrencias}
📦 Mídias entregues: {midias}/174

Operação concluída.
_SIME · 7ª Zona Eleitoral_
```

## Regras de envio

### Anti-spam
- Mesmo evento + mesma seção: mínimo 15 minutos entre notificações
- Pânico: sem limite (sempre notificar)
- Relatório final: apenas uma vez por dia

### Fila de envio
Se múltiplos destinatários:
- Enviar com intervalo de 3 segundos entre mensagens
- Evitar flood que pode causar ban do número

### Confirmação de recebimento
Para eventos críticos (panico_*):
- Aguardar resposta do coordenador em até 10 minutos
- Sem resposta → reenviar com escalada:
  "⚠️ Sem confirmação — Seção {secao} ainda com problema ativo"
- Após 30 minutos sem resposta → escalar para o Chefe de Cartório (nunca para
  o juiz eleitoral — regra do SIME, ver CLAUDE.md)

## Log de envios

Registrar cada envio em sime_logs:
```json
{
  "acao": "whatsapp_enviado",
  "modulo": "hermes_notificar",
  "secao": "0063",
  "evento": "panico_energia",
  "destinatario": "86900000000",
  "status": "entregue",
  "ts": "2026-10-04T08:47:23Z"
}
```
