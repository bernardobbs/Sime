# SKILL: sime_monitor
description: Monitora mensagens de grupos WhatsApp de mesários e extrai eventos eleitorais para atualizar o SIME.
triggers:
  - mensagem recebida no grupo WhatsApp monitorado
  - qualquer mensagem que contenha número de seção + evento eleitoral

---

## Objetivo

Ler mensagens em linguagem natural enviadas por mesários, técnicos e motoristas nos grupos de WhatsApp e extrair eventos estruturados para atualizar o Sistema de Monitoramento Eleitoral (SIME).

## Grupos monitorados

Configurar no Hermes gateway (hermes config set sime.grupos):
- "Mesários Campo Maior"
- "Mesários Jatobá do Piauí"  
- "Mesários Sigefredo Pacheco"
- "Motoristas 7ª Zona"
- "Técnicos Instalação"

## Padrões de extração

### 1. Número da seção
Reconhecer qualquer formato:
- "seção 63", "sec 63", "s63", "secao 63", "#63"
- Número de 1 a 261 (range das seções da 7ª Zona)

### 2. Eventos reconhecidos

| Mensagem (exemplos) | Campo SIME | Valor |
|---|---|---|
| "encerrad*", "fechamos", "votação encerrada" | enc | true |
| "zeresima", "zerésima", "zeresima ok" | zeresima | true |
| "votação aberta", "iniciamos", "começamos a votar" | vot | true |
| "fila de X", "X pessoas esperando", "X na fila" | fila | número X |
| "sem energia", "falta de luz", "caiu a energia" | panico_energia | true |
| "problema na urna", "urna travou", "urna não funciona" | panico_urna | true |
| "urna recolhida", "entregamos a urna", "motorista levou" | urna | true |
| "mídia pronta", "midia embalada", "material pronto" | midia_pronta | true |
| "presidente chegou", "mesa completa", "todos chegaram" | mesa_completa | true |
| "presidente faltou", "mesário não veio" | mesa_problema | true |
| "energia voltou", "resolvemos a urna" | panico_resolvido | true |

### 3. Ignorar estas mensagens
- Mensagens sem número de seção identificável
- Mensagens de voz (transcrever e processar normalmente)
- Figurinhas e imagens (ignorar, exceto se tiverem legenda com seção)
- Mensagens de confirmação do próprio Hermes (evitar loop)

## Fluxo de processamento

```
1. RECEBER mensagem do grupo WhatsApp
      ↓
2. IDENTIFICAR se contém seção + evento
   - NÃO identificado → ignorar silenciosamente
   - IDENTIFICADO → continuar
      ↓
3. EXTRAIR: { secao, evento, valor, remetente, horario }
      ↓
4. MONTAR resposta de confirmação:
   "📋 Seção [X] — [evento]. Confirmar? (S para sim, N para corrigir)"
      ↓
5. AGUARDAR resposta (timeout: 3 minutos)
   - "S", "sim", "confirma", "ok", "👍" → CONFIRMAR
   - "N", "não", "erro", "corrige" → PEDIR CORREÇÃO
   - Timeout → CANCELAR com aviso
      ↓
6. CONFIRMAR: chamar sime_updater com dados extraídos
      ↓
7. RESPONDER no grupo: "✅ SIME atualizado — Seção [X]: [evento] às [hora]"
```

## Casos especiais

### Múltiplos eventos numa mensagem
"seção 63 encerrada, fila de 8 pessoas"
→ Processar dois eventos em sequência, confirmar juntos:
"📋 Seção 63 — Encerrada + Fila: 8. Confirmar?"

### Seção não identificada
"encerramos aqui"
→ Responder: "Qual o número da seção?"
→ Aguardar resposta e retomar

### Seção inválida (fora do range 1-261)
→ Responder: "Seção [X] não encontrada. Verifique o número."

### Pânico — não aguardar confirmação
Se detectar panico_energia ou panico_urna:
→ Atualizar SIME imediatamente SEM confirmação
→ Notificar: "🚨 ALERTA registrado — Seção [X]: [tipo de pânico]"
→ Disparar notificação para coordenadores (via sime_notificar)

## Memória de contexto

Guardar nas últimas 2 horas:
- Seções que já confirmaram encerramento
- Seções com pânico ativo
- Última seção mencionada por cada remetente

Se o mesmo remetente mandar "já resolvemos" sem número → usar última seção mencionada.
