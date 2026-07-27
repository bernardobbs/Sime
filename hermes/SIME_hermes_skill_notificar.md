# SKILL: sime_notificar
description: Envia notificações WhatsApp automáticas quando eventos críticos ocorrem no SIME, usando a conexão WhatsApp do próprio Hermes.
triggers:
  - chamada via webhook do Supabase (evento crítico detectado)
  - chamada direta por outra skill (sime_monitor, sime_updater)

---

## Objetivo

Enviar mensagens WhatsApp para os responsáveis certos quando o SIME detecta eventos que requerem atenção imediata. Substitui completamente o Z-API — usa a conexão WhatsApp já estabelecida pelo Hermes.

## Endpoint de ativação

O Supabase chama este skill via webhook HTTP:

```
POST https://SEU_ORACLE_IP:3000/hermes/skill/sime_notificar
Authorization: Bearer HERMES_API_KEY
Content-Type: application/json

{
  "evento": "panico_energia",
  "secao": "0063",
  "local": "G.E. Treze de Março",
  "cidade": "Campo Maior",
  "ts": "08:47",
  "destinatarios": [
    { "nome": "Rafael A.", "telefone": "86900000000" },
    { "nome": "Carlos M.", "telefone": "86900000001" }
  ]
}
```

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
- Após 30 minutos sem resposta → notificar juiz eleitoral

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
