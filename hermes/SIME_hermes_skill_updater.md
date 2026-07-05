# SKILL: sime_updater
description: Atualiza o banco de dados do SIME (Supabase) com eventos extraídos do WhatsApp pelo sime_monitor.
triggers:
  - chamada por sime_monitor após confirmação do usuário
  - chamada direta com dados estruturados

---

## Objetivo

Receber dados estruturados extraídos de mensagens WhatsApp e persistir no Supabase, garantindo uso de server timestamp e registro de auditoria.

## Endpoint alvo

```
POST https://sime-7zona.vercel.app/api/hermes-update
Authorization: Bearer HERMES_WEBHOOK_SECRET
Content-Type: application/json
```

## Schema do payload

```json
{
  "secao": "0063",
  "evento": "enc",
  "valor": true,
  "remetente": "86999991234",
  "remetente_nome": "João Silva",
  "origem": "whatsapp_grupo",
  "grupo": "Mesários Campo Maior"
}
```

## Mapeamento evento → campo Supabase

```
enc           → sime_mesa_estado.encerrada = true
vot           → sime_mesa_estado.votacao = true
zeresima      → sime_mesa_estado.zeresima = true
fila          → sime_mesa_estado.fila = valor (número)
panico_energia→ sime_mesa_estado.panico_energia = true
panico_urna   → sime_mesa_estado.panico_urna = true
panico_resolvido → resolver tipo correto
urna          → sime_mesa_estado.urna_recolhida = true
midia_pronta  → sime_midias.status = 'pronta_para_coleta'
mesa_completa → sime_mesa_estado.mesa_pres=1, m1=1, m2=1, sec=1
```

## CRÍTICO: Timestamp sempre do servidor

Nunca usar Date.now() local. O endpoint Vercel chama:
```sql
SELECT sime_now() -- RPC do Supabase
```

## Resposta esperada do endpoint

```json
{
  "ok": true,
  "secao": "0063",
  "campo": "encerrada",
  "valor": true,
  "ts_servidor": "2026-10-04T17:23:11Z",
  "log_id": "abc123"
}
```

## Em caso de erro

- Erro de rede → enfileirar em IndexedDB local do Hermes e retentar em 30s
- Seção não encontrada → notificar remetente: "Seção {X} não cadastrada no SIME"
- Token inválido → alertar admin via WhatsApp
- Timeout (>5s) → retentar 3x com backoff exponencial
