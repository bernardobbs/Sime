# SIME — Roteiro de Teste (7ª Zona)

Roteiro de validação ponta a ponta para os primeiros testes / simulação.
Cada passo tem **ação**, **resultado esperado** e caixa de marcação. Marque
`[x]` OK ou anote a falha na coluna de observação.

- **App:** https://sime-cyan.vercel.app
- **Zona de teste:** 7ª (Campo Maior / Jatobá do Piauí / Sigefredo Pacheco)
- **Data-alvo simulada:** 04/10/2026

> Legenda de sync: 🟢 sincronizado · 🟡 salvo offline (fila) — nunca deve travar a ação.

---

## ⚡ Smoke manual (5 minutos) — checagem rápida do dia a dia

Use este bloco curto para confirmar, em ~5 min, que o sistema está no ar e o
caminho crítico funciona. Se algum falhar, rode o roteiro completo abaixo.

| # | Ação | Resultado esperado | OK |
|---|---|---|---|
| S1 | Abrir o app e **logar como admin** | Entra no dashboard; topo mostra seu nome | [ ] |
| S2 | Abrir `SIME_tv_dia.html?tv_token=…` numa aba | Painel carrega dados reais (não fica no fallback) | [ ] |
| S3 | Num celular, **logar no mesário** (QR+PIN) de uma seção | Entra direto na seção | [ ] |
| S4 | Lançar 1 ação (ex.: **fila**) no mesário | Confirma com toque; badge 🟢 | [ ] |
| S5 | Olhar a **TV Dia** e o **Admin** | A ação aparece em segundos (Realtime) | [ ] |
| S6 | Abrir **Relatórios → Situação das seções** | A seção reflete o que foi lançado | [ ] |

Se S1–S6 passam, o núcleo está saudável (auth admin + auth campo + Realtime +
relatórios). Falhou S2/S3? Quase sempre é o `SIME_JWT_SECRET` (ver
`docs/CONFIGURACAO_GO_LIVE.md`).

---

## 0. Pré-requisitos (antes de começar)

| # | Item | OK |
|---|---|---|
| 0.1 | `SIME_JWT_SECRET` configurado na Edge Function (ver `docs/CONFIGURACAO_GO_LIVE.md`) — sem isso o campo/TV não gravam | [ ] |
| 0.2 | Pelo menos 1 conta de admin funciona (ex.: `admin@exemplo.gov.br`) | [ ] |
| 0.3 | Tokens de campo impressos/à mão: 1 mesário (ex.: seção **0063**), 1 motorista (**rota 007**), 1 conferente | [ ] |
| 0.4 | 1 token de TV para abrir os painéis | [ ] |
| 0.5 | Dispositivos: 1 celular (mesário), 1 celular (motorista), 1 tela/box para TV, 1 PC para o Admin | [ ] |

**Credenciais de teste usadas neste roteiro:** _(preencha)_
- Admin: __________________  Senha: __________
- Token mesário 0063: ______  PIN: ____
- Token motorista 007: ______ PIN: ____
- Token TV: ______

---

## 1. Admin — acesso, equipe e cadastro

| # | Ação | Resultado esperado | OK | Obs |
|---|---|---|---|---|
| 1.1 | Abrir a raiz do app | Redireciona para a tela de login do Admin | [ ] | |
| 1.2 | Logar com a conta de admin | Entra no painel; topo mostra **seu nome** e botão **⎋ Sair** | [ ] | |
| 1.3 | Aba **Equipe → Novo membro** com e-mail | Mostra **senha temporária** (copiável) | [ ] | |
| 1.4 | Sair e logar com o novo membro | Força **trocar a senha** no 1º acesso | [ ] | |
| 1.5 | No membro, botão **🔑 Redefinir senha** | Gera nova senha temporária | [ ] | |
| 1.6 | Aba **Seções → ⚙️ Gerenciar seções** | Lista as seções da zona | [ ] | |
| 1.7 | Incluir seção nova → salvar | Aparece na lista; persiste ao recarregar | [ ] | |
| 1.8 | Editar e depois excluir essa seção de teste | Alteração e remoção refletem na lista | [ ] | |
| 1.9 | Logout (**⎋ Sair**) | Volta para a tela de login | [ ] | |

---

## 2. Preparação (D-X) — Coordenador + TV Preparação

| # | Ação | Resultado esperado | OK | Obs |
|---|---|---|---|---|
| 2.1 | Abrir `SIME_coordenador_preparacao.html`, logar | Lista de seções para lacre/preparação | [ ] | |
| 2.2 | Registrar lacre/preparação de algumas seções | Confirma com toque único; badge 🟢 | [ ] | |
| 2.3 | Abrir `SIME_tv_preparacao.html?tv_token=…` | Painel mostra o total e o avanço da preparação | [ ] | |
| 2.4 | Fazer nova ação no coordenador | TV reflete o avanço (no próximo ciclo) | [ ] | |

---

## 3. Distribuição / Véspera (D-1) — Conferente, Instalador, TVs

| # | Ação | Resultado esperado | OK | Obs |
|---|---|---|---|---|
| 3.1 | Abrir `SIME_conferente.html`, logar com token de conferente | Mostra as rotas atribuídas | [ ] | |
| 3.2 | Marcar urnas embarcadas numa rota | Progresso da rota sobe; badge 🟢 | [ ] | |
| 3.3 | Fechar a rota como **Pronta / Saiu** | Status muda para "Saiu" | [ ] | |
| 3.4 | Abrir `SIME_tv_distribuicao.html?tv_token=…` | Card da rota mostra município e progresso; "Saiu" aparece | [ ] | |
| 3.5 | Abrir `SIME_instalador.html`, registrar instalação de seções | Confirma; aparece na TV Véspera | [ ] | |
| 3.6 | Abrir `SIME_tv_vespera.html?tv_token=…` | Painel mostra o avanço da instalação | [ ] | |

---

## 4. Dia D — Mesário (o fluxo mais crítico)

Usar o celular com o token da seção **0063**.

| # | Ação | Resultado esperado | OK | Obs |
|---|---|---|---|---|
| 4.1 | Abrir `SIME_mesario.html`, logar com QR+PIN da 0063 | Entra direto na tela da seção 0063 | [ ] | |
| 4.2 | Confirmar **Zerésima** | Botão grande, toque único; 🟢 | [ ] | |
| 4.3 | Confirmar **Votação iniciada** | Status muda para "Votando" | [ ] | |
| 4.4 | Lançar **Fila** (ex.: 12 eleitores) | Contador registrado | [ ] | |
| 4.5 | Acionar **Pânico de energia** | Alerta imediato (sem confirmação) | [ ] | |
| 4.6 | Resolver o pânico | Alerta some / marca resolvido | [ ] | |
| 4.7 | Confirmar **Encerramento** | Modal de confirmação (ação irreversível) → "Encerrada" | [ ] | |
| 4.8 | Marcar **mídia pronta** | Registra para coleta | [ ] | |

---

## 5. Dia D — Motorista, Acessibilidade, Mídias

| # | Ação | Resultado esperado | OK | Obs |
|---|---|---|---|---|
| 5.1 | Abrir `SIME_motorista.html` com token da **rota 007** | Cabeçalho mostra a rota, **nº de urnas** e o **itinerário oficial** | [ ] | |
| 5.2 | Confirmar **entrega** das seções da rota | Progresso de entrega sobe | [ ] | |
| 5.3 | Confirmar **recolhimento** e **chegada ao cartório** | Botão de cartório libera após tudo recolhido | [ ] | |
| 5.4 | Abrir `SIME_acessibilidade.html` (token de local) | Contador de fila + botões de pânico do local | [ ] | |
| 5.5 | Abrir `SIME_midias.html`, registrar coleta de mídia | Fluxo de mídia avança (pronta → coletada) | [ ] | |

---

## 6. Realtime — propagação em tempo real

| # | Ação | Resultado esperado | OK | Obs |
|---|---|---|---|---|
| 6.1 | Deixar `SIME_tv_dia.html?tv_token=…` aberto na tela | Painel do Dia D no ar | [ ] | |
| 6.2 | No celular do mesário, encerrar a seção 0063 | Em poucos segundos a **TV Dia** marca 0063 como encerrada | [ ] | |
| 6.3 | Abrir o **Admin** noutro dispositivo | A seção 0063 aparece encerrada no dashboard | [ ] | |
| 6.4 | Acionar pânico no mesário | TV Dia e Admin destacam o alerta | [ ] | |

---

## 7. Offline — a fila não perde ação

| # | Ação | Resultado esperado | OK | Obs |
|---|---|---|---|---|
| 7.1 | No celular do mesário, **ativar modo avião** | App continua utilizável | [ ] | |
| 7.2 | Confirmar uma ação (ex.: fila, votação) | Badge fica **🟡** ("salva — sincroniza em breve") | [ ] | |
| 7.3 | **Desativar** o modo avião | Em até ~30s sincroniza sozinho; badge volta a **🟢** | [ ] | |
| 7.4 | Conferir na TV Dia / Admin | A ação feita offline **aparece** após a sincronização | [ ] | |

---

## 8. Relatórios

| # | Ação | Resultado esperado | OK | Obs |
|---|---|---|---|---|
| 8.1 | Abrir `SIME_relatorios.html`, logar | Cabeçalho mostra **7ª Zona** | [ ] | |
| 8.2 | **Situação das seções** | Cards (encerradas/votando/pânico) + tabela refletem os testes acima | [ ] | |
| 8.3 | **Distribuição de urnas** | Rotas com urnas + itinerário + status (rota 007 "Saiu") | [ ] | |
| 8.4 | **Pânicos e ocorrências** | Lista o pânico da 0063 (abertura + resolução) | [ ] | |
| 8.5 | Botão **⬇️ CSV** | Baixa o CSV do relatório atual | [ ] | |
| 8.6 | Botão **🖨️ Imprimir** | Layout de impressão limpo (sem menus) | [ ] | |

---

## 9. Isolamento entre zonas (segurança RLS)

| # | Ação | Resultado esperado | OK | Obs |
|---|---|---|---|---|
| 9.1 | Logar como admin da **94ª** (`maria.gomes@…`) | Vê **só** as seções/relatórios da 94ª | [ ] | |
| 9.2 | Confirmar que **não** aparece nenhuma seção da 7ª | Zero vazamento entre zonas | [ ] | |

---

## Critérios de aceite (mínimo para dar o teste por bom)

- [ ] Login de admin **e** de campo (QR+PIN) funcionam de verdade (não caem no fallback).
- [ ] Uma ação do mesário chega à **TV Dia** e ao **Admin** em segundos (Realtime).
- [ ] A **fila offline** recupera a ação feita sem rede (🟡 → 🟢).
- [ ] **Pânico** dispara alerta imediato e a resolução o encerra.
- [ ] Os **3 relatórios** refletem os dados lançados e exportam CSV.
- [ ] Admin de uma zona **não** enxerga dados de outra (RLS).

## Registro do teste
- Data/hora: __________  Responsável: __________
- Dispositivos usados: ______________________________
- Falhas encontradas (nº do passo + descrição):
  1. ______________________________________________
  2. ______________________________________________
