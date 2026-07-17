# SIME — Cronograma de Implantação (7ª Zona)

Ponto de partida: **12/jul/2026**. Alvo: **04/out/2026** (Dia D). ~12 semanas.
Estado atual: sistema **construído, testado (28 suítes) e no ar** (Vercel + Supabase
ACTIVE_HEALTHY). O que falta é **configuração, dados finais, hardware e ensaio** —
não desenvolvimento. Cada etapa tem um **portão** (gate): não avança sem cumprir.

> Regra de ouro: nada passa da Semana 1 sem o `SIME_JWT_SECRET`; o treinamento não
> começa sem o simulado aprovado; e o Supabase não pode pausar perto do Dia D.

---

## Semana 1 — 14–18/jul · Destravar produção
**Objetivo:** sistema tecnicamente operacional ponta a ponta.
- [ ] Configurar `SIME_JWT_SECRET` na Edge Function (ver `docs/CONFIGURACAO_GO_LIVE.md`).
- [ ] Rodar o **smoke manual (S1–S6)** do `docs/ROTEIRO_DE_TESTE.md` — login admin,
      login de campo, Realtime, relatórios.
- [ ] Habilitar proteção de senha vazada (Auth) e, se for enviar e-mail, SMTP.
- [ ] **Decidir Supabase Pro** (ou rotina para não pausar) — não arriscar pausa no Dia D.
- **Portão:** mesário loga por QR+PIN e a ação aparece na TV Dia. ✅

## Semana 2 — 21–25/jul · Dados & equipe
**Objetivo:** dados 100% e equipe com acesso.
- [ ] Cadastrar a **equipe do cartório** na aba Equipe (cada um com senha temporária).
- [ ] Completar as **13 seções sem rota** + eleitores da **0177** (Gerenciar seções).
- [ ] Conferir as **12 rotas** (itinerário + urnas) contra a planilha oficial.
- [ ] Trocar as senhas temporárias iniciais.
- **Portão:** relatório "Situação das seções" sem pendência de rota/eleitores. ✅

## Semana 3 — 28/jul–01/ago · Piloto controlado
**Objetivo:** validar o fluxo real em pequena escala.
- [ ] Rodar o **roteiro completo** com 1–2 seções reais + 1 rota + 1 TV.
- [ ] Testar **offline** (modo avião → fila 🟡→🟢), **pânico** e **Realtime**.
- [ ] Ajustar o que aparecer.
- **Portão:** roteiro completo passa em campo, sem cair no fallback. ✅

## Semanas 4–5 — 04–15/ago · Hardware e telões
**Objetivo:** painéis prontos na parede.
- [ ] Comprar/configurar **TV Box Android TV certificado** (com Play Store) — evita o
      WebView antigo do MXQ (ver anexo de `docs/CONFIGURACAO_GO_LIVE.md`).
- [ ] Kiosk browser + autostart no boot, cada TV com seu `tv_token`.
- [ ] **Decidir Hermes** (WhatsApp): validar e conectar OU cortar do escopo do Dia D.
- **Portão:** as 5 TVs sobem sozinhas ao ligar e reconectam se cair a rede. ✅

## Semanas 6–7 — 18–29/ago · Simulação ampla
**Objetivo:** ensaio geral.
- [ ] Simulado com **10–20 seções + várias rotas**, equipe real, cronometrando.
- [ ] Testar **escalonamento de pânico** (10 min → Gestor, 30 min → Chefe de Cartório).
- [ ] Medir carga: TVs, Realtime, fila offline sob volume.
- **Portão:** simulado aprovado pelo Chefe de Cartório. ✅ (libera treinamento)

## Semanas 8–9 — 01–12/set · Treinamento & materiais
**Objetivo:** pessoas prontas.
- [ ] Treinar **mesários, motoristas, conferentes e coordenadores**.
- [ ] **Imprimir** cartões QR+PIN (verso com o PIN) e guia rápido de 1 página por papel.
- [ ] Distribuir tokens e testar o acesso de cada pessoa.
- **Portão:** cada operador consegue entrar no seu módulo sozinho. ✅

## Semanas 10–11 — 15–26/set · Congelamento & contingência
**Objetivo:** estabilidade.
- [ ] **Freeze de código** — só correção crítica a partir daqui.
- [ ] Revisar o **plano de contingência** (offline; WhatsApp/telefone se o painel cair).
- [ ] Checklist do Dia D + escala de plantão técnico.
- [ ] Confirmar Supabase **não vai pausar** (Pro ou tráfego garantido).
- **Portão:** sistema congelado, contingência ensaiada. ✅

## Semana 12 — 29/set–03/out · Véspera
- [ ] **D-X** preparação real (coordenador + TV Preparação).
- [ ] **D-1** distribuição real (conferente + motorista + TV Distribuição/Véspera).
- [ ] **Smoke manual (S1–S6) todo dia** de manhã.
- [ ] Plantão de sobreaviso montado.

## 04/out — DIA D (go-live)
- [ ] Abertura: zerésima → votação nas seções.
- [ ] Painéis (TV Dia) e Admin no ar; plantão técnico ativo.
- [ ] Encerramento → recolhimento → chegada ao cartório.
- [ ] Relatórios consolidados ao fim do dia.

## Pós — 05/out em diante
- [ ] **2º turno** (se houver, ~25/out): mesma instância, só reabrir eleição.
- [ ] Retrospectiva: o que falhou, o que melhorar para a próxima.

---

## Riscos e mitigações (resumo)
| Risco | Mitigação |
|---|---|
| Supabase pausar (plano grátis, 7 dias) | Keep-alive automático (`.github/workflows/keep-alive.yml`, a cada 3 dias) já cobre; para o Dia D, avaliar Pro na janela crítica. Checar na Semana 11 |
| WebView antigo do TV Box (tela branca) | Box Android TV certificado + supabase-js já vendorizado |
| `SIME_JWT_SECRET` não configurado | Portão da Semana 1 — bloqueia tudo até resolver |
| Rede do cartório instável | Fila offline (🟡→🟢) + supabase-js local + kiosk auto-reload |
| Pessoas não treinadas | Simulado (gate) antes do treinamento; guia de 1 página |

## Caminho crítico
`JWT secret (S1)` → `dados+equipe (S2)` → `piloto (S3)` → `hardware (S4-5)` →
`simulado (S6-7)` → `treinamento (S8-9)` → `freeze (S10-11)` → `véspera (S12)` → `Dia D`.
