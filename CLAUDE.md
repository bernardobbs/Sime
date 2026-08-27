# SIME — Sistema de Monitoramento Eleitoral
## Contexto completo para o Claude Code

---

## IDENTIDADE DO PROJETO

Sistema auxiliar de observabilidade operacional para eleições.
**Não substitui** nenhum processo oficial da Justiça Eleitoral.
Nasceu para a **7ª Zona Eleitoral do Piauí** e hoje atende **duas zonas** —
o sistema é multi-zona, com isolamento por RLS.

### Números da operação (conferidos no Supabase em 27/07/2026)

| Zona | Sede | Seções | Locais | Eleitores | Rotas | Municípios |
|---|---|---|---|---|---|---|
| **7ª** | Campo Maior | 175 | 64 | 35.347 | 12 | Campo Maior, Jatobá do Piauí, Sigefredo Pacheco |
| **94ª** | Oeiras | 98 | 54 | 19.147 | 7 | Cajazeiras do PI, Colônia do PI, São Francisco do PI, São Miguel do Fidalgo |

Eleição: **4 de outubro de 2026** (1º turno — primeiro domingo de outubro).

> Os números acima vêm do banco, não de estimativa. Ao divergirem, o banco é a
> fonte: o painel e os tokens já leem de lá.

---

## FILOSOFIA — NUNCA VIOLAR

1. **Toque único** para ações simples
2. **Confirmação modal** apenas para ações irreversíveis
3. **Nunca bloquear** por campos opcionais
4. **Botões grandes** — uso às 5h30, em campo, com sono
5. **Offline-first** — IndexedDB, retry a cada 30s, badge 🟡/🟢
6. **NUNCA usar `Date.now()` ou `new Date()`** para timestamps de ação
   — sempre chamar `await supabase.rpc('sime_now')`
7. **Logs são append-only** — nunca UPDATE ou DELETE em sime_logs
8. **RLS sempre ativo** — usuário só lê/escreve dados da sua zona

---

## STACK TECNOLÓGICA

### Fase atual (homologação)
- Frontend: HTML + JS puro, sem framework, sem build
- Armazenamento: localStorage por chave compartilhada
- Offline: IndexedDB para fila de ações pendentes

### Fase de produção (migração em andamento)
- Banco: Supabase (PostgreSQL + Realtime + Auth + Edge Functions)
- Hospedagem: Vercel (Hobby — gratuito)
- Fila: Upstash QStash (Free — 500 msg/dia)
- WhatsApp: Hermes Agent — Node.js + Baileys num Raspberry Pi 3B (rede
  doméstica, atrás de NAT, sem túnel), com fallback de IA (Gemini) só para os
  casos que o regex não cobre. Código e documentação do agente vivem no
  repositório separado `bernardobbs/hermes` — ver `README.md` e
  `HERMES_RUNTIME.md` de lá.
- Custo total: **R$ 0,00/mês**

### Variáveis de ambiente necessárias (Vercel)
```
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
HERMES_SECRET_ZONA_7=senha-forte-da-7a
HERMES_SECRET_ZONA_94=senha-forte-da-94a
```

> `HERMES_URL` NÃO deve ser definida quando o Hermes roda atrás de NAT: ela só
> serve para o SIME empurrar a notificação direto. Sem ela, o SIME enfileira e
> o Hermes consulta — que é o modo correto. Ver `README.md` no repositório
> `bernardobbs/hermes`.

---

## ESTRUTURA DE ARQUIVOS

```
/
├── CLAUDE.md                          ← Este arquivo
├── modules/                           ← 20 módulos HTML
│   ├── SIME_coordenador_preparacao.html  D-X
│   ├── SIME_tv_preparacao.html           D-X (TV)
│   ├── SIME_conferente.html              D-1
│   ├── SIME_instalador.html              D-1
│   ├── SIME_tv_distribuicao.html         D-1 (TV)
│   ├── SIME_tv_vespera.html              D-1 (TV)
│   ├── SIME_mesario.html                 Dia D
│   ├── SIME_motorista.html               D-1 + Dia D
│   ├── SIME_tv_dia.html                  Dia D (TV)
│   ├── SIME_admin.html                   Dia D (admin)
│   ├── SIME_midias.html                  Dia D
│   ├── SIME_acessibilidade.html          Dia D
│   ├── SIME_atores.html                  Todos
│   ├── SIME_convocacao.html              Pré-eleição (dashboard, contato e sincronização de mesários)
│   ├── SIME_principal.html               Todos — landing padrão do site (/ redireciona pra cá)
│   ├── SIME_tokens.html                  Pré-eleição
│   ├── SIME_paineis.html                 Todos
│   ├── SIME_problemas.html               Dia D
│   ├── SIME_relatorios.html              Todos
│   └── SIME_hermes_painel.html           Todos (métricas de campanha do Hermes)
├── api/
│   ├── hermes-update.js               ← escrita de eventos de seção
│   ├── hermes-mesarios.js             ← leitura + autoatendimento + confirmação de mesários
│   ├── hermes-notificacoes.js         ← fila de notificações que o Hermes consulta (SIME → Hermes)
│   ├── hermes-campanhas.js            ← fila de disparo em massa que o Hermes consulta (SIME → Hermes)
│   └── hermes-contatos.js             ← telefone por papel (Gestor de Problemas/Chefe de Cartório), pro escalonamento
├── sql/
│   ├── SIME_schema.sql                ← Schema principal
│   ├── SIME_whatsapp_schema.sql       ← Notificações WhatsApp
│   └── SIME_hermes_trigger.sql        ← Triggers para o Hermes
└── docs/
    ├── descricao_completa.md
    ├── plano_implementacao.md
    └── prompt_chatgpt.md
```

> Código e documentação do agente Hermes (runtime, skills, patches) não
> vivem mais neste repositório — foram unificados em `bernardobbs/hermes`,
> pra não duplicar entre os produtos que o consomem (SIME, e futuramente o
> Casinha Hub).

---

## 18 PAPÉIS DO SISTEMA

### Camada Admin (cartório)

| Papel | Filtro | Permissões |
|---|---|---|
| **Coordenador Geral** (Chefe de Cartório) | Tudo | Ver + editar + resolver pânico + config equipe |
| **Monitor de Campo** | Tudo | Ver + editar + lançar por telefone |
| **Gestor de Problemas** | Alertas ativos | Ver + resolver pânico + lançar por telefone |
| **Gestor de Distribuição** | Rotas | Ver + controlar embarque |
| **Observador** | Tudo | Somente leitura |
| **Coord. de Motoristas (Preposto)** | `empresa_id` do usuário | Só rotas da empresa dele |

### Camada Campo (acesso via QR Code + PIN)

| Papel | Módulo | Fase | Escopo |
|---|---|---|---|
| **Auxiliar de Eleição** | Instalador + apoio | D-1 | Equipe do cartório |
| **Conferente de Embarque** | SIME_conferente | D-1 | Rotas atribuídas |
| **Instalador** | SIME_instalador | D-1 | Seções da rota (convocado externo) |
| **Motorista** | SIME_motorista | D-1 + Dia D | Rota própria (`?rota=007`) |
| **Presidente de Mesa** | SIME_mesario | Dia D | Seção própria (`?secao=0063`) |
| **1º Mesário** | Registrado pelo Presidente | Dia D | — |
| **2º Mesário** | Registrado pelo Presidente | Dia D | — |
| **Secretário** | Registrado pelo Presidente | Dia D | — |
| **Coord. de Acessibilidade** | SIME_acessibilidade | Dia D | Seções do `local_id` (convocado externo) |
| **Coletor de Mídias** | SIME_midias | Dia D | Seções designadas (papel fixo, substituto possível) |

> **Coordenador de Preparação** (`SIME_coordenador_preparacao`, fase D-X, todas
> as seções) é o único papel de campo que **não** entra por QR+PIN — decisão
> deliberada: entra com e-mail/senha, mesmo padrão do Admin. Não é uma
> inconsistência a corrigir.

### Autônomo
| Papel | Tecnologia | Função |
|---|---|---|
| **Hermes Agent** | Node.js + Baileys (Raspberry Pi) | Monitora grupos WhatsApp + drena filas de envio |

### Regras críticas de escalonamento de pânico
```
Detecção (SIME/Hermes)
  → 10 min sem resolução → Gestor de Problemas (WhatsApp)
  → 30 min sem resolução → Chefe de Cartório (WhatsApp)
  NUNCA escala para o juiz eleitoral
```

---

## CHAVES localStorage (fase atual)

| Chave | Gravado por | Lido por |
|---|---|---|
| `sime_lacre_v3` | Coordenador Preparação | TV Preparação, TV Véspera |
| `sime_inst_v1` | Instalador | TV Véspera |
| `sime_dist_v1` | Conferente | TV Distribuição |
| `sime_mesa_v1` | Mesário, Motorista, Admin | TV Dia, Admin, Mídias |
| `sime_motorista_v1` | Motorista | TV Dia, Admin |
| `sime_midias_v1` | Mesário (pronta), Mídias (coleta) | TV Dia, Admin |
| `sime_atores_v1` | Admin, Atores | Modo Guerra |
| `sime_eleicao_v1` | Painel Principal | Todos os módulos |
| `sime_tokens_v1` | Tokens | Conferente, Mesário |
| `sime_equipe_v1` | Administração | Administração |
| `sime_sons_v1` | TV Dia (config) | TV Dia |
| `sime_logs_v1` | Todos | Admin, Debug |
| `sime_zapi_cfg` | Admin | Hermes (legacy) |

---

## TABELAS SUPABASE (produção)

```sql
sime_zonas          -- zonas eleitorais
sime_secoes         -- seções com local, município, eleitores (por zona)
sime_rotas          -- rotas com paradas (por zona)
sime_eleicoes       -- por zona e turno
sime_empresas       -- empresas contratadas (motoristas) ← NOVO
sime_usuarios       -- admins com perfil, zona_id, empresa_id, local_id
sime_tokens         -- QR Code + PIN por operador de campo
sime_mesa_estado    -- estado de cada seção no Dia D
sime_midias         -- fluxo das mídias eleitorais
sime_atores         -- cadastro de contatos operacionais
sime_notificacoes   -- histórico de WhatsApps enviados
sime_logs           -- auditoria append-only
sime_ocorrencias    -- problemas como registro (dono, relógio, escalonamento)
sime_ocorrencia_eventos -- histórico append-only de cada ocorrência
sime_contatos_externos  -- Equatorial e afins, por zona/município
sime_campanhas_confirmacao -- fila de disparo em massa do Hermes (SIME popula, Hermes envia)
```

### Painel de Problemas (`SIME_problemas.html`)

O contato oferecido é **função do tipo do problema** — é a regra que organiza
a tela: faltou luz → Equatorial; urna com defeito → **auxiliar de eleição**
(contratado do TRE que faz manutenção de urna); faltou mesário → a própria
mesa; acessibilidade → coordenador do local.

Quem assume cuida até o fim: `sime_ocorrencia_assumir` **recusa** ocorrência
que já tem dono — para trocar de mãos existe `sime_ocorrencia_delegar`, que
exige motivo. Resolver pelo cartório fecha a ocorrência **e** baixa o pânico
na seção pelo mesmo RPC do mesário, então a resolução chega ao aparelho dele
pelo Realtime.

Escalonamento conta de `aberta_em`, não de `assumida_em` — senão a forma mais
fácil de não ser escalado seria clicar em "Assumir" e esquecer.

### RPCs críticas
```sql
sime_now()                    -- server timestamp — SEMPRE usar
sime_acao_midia()             -- atualiza mídia com server ts
sime_importar_ator()          -- importa 1 ator manual (cadastro avulso, valida telefone)
sime_sync_atores_from_raw()   -- UPSERT em massa de mesário/apoio logístico a partir de
                               -- sime_mesarios_raw (ver "Atualização de mesários" abaixo)
```

### Atualização de mesários e apoio logístico (recarga do TRE)

`sime_mesarios_raw` é staging descartável — pode ser recarregada a qualquer
momento com uma nova exportação do TRE. Três formatos de origem, três
scripts em `scripts/` (todos rodam em disco e só imprimem contagem
agregada — nome/CPF/telefone nunca passam pelo console, muito menos por
chat, ver docstring de cada um):

| Origem | Script | Uso |
|---|---|---|
| Dump ELO `.md` (largura fixa, 81 colunas) | `parse_mesarios.py` | `python3 parse_mesarios.py saida.sql mesariosmrv.md mesariosal.md` |
| CSV exportado da planilha "convocação mesários" (abas `base geral MRV`/`Base Geral Apoio especializado` — mesmo cabeçalho de 81 colunas do ELO, confirmado em 20/08/2026, inclui `Confirmou convocação`/`Origem da resposta`/`Justificativa`) | `parse_mesarios_gsheet_csv.py` | `python3 parse_mesarios_gsheet_csv.py saida.sql mrv.csv apoio.csv` |
| CSV "MRV simples" (16 colunas, sem os campos de acompanhamento — outra exportação do TRE, mais enxuta) | `parse_mesarios_csv.py` | `python3 parse_mesarios_csv.py saida.sql arquivo.csv 7 PI` |

Os três geram o mesmo INSERT pronto pra colar no SQL Editor. `tipo_registro`
nunca é adivinhado por regra própria — vem direto da coluna "Tipo função
eleitoral"/"Nº Função Eleitoral" do próprio arquivo (que já traz 'MRV'/'AL'),
ou é fixo 'MRV' no formato simples (que só cobre mesa, não apoio).

**Direto pelo navegador, sem gerar SQL**: `SIME_convocacao.html` (módulo
próprio, separado de `SIME_atores.html` desde 20/08/2026 — antes eram duas
abas lá dentro) → aba **🔄 Sincronizar** tem TRÊS caminhos separados
(`sime_mesarios_sync.js`), pros formatos que o cartório recebe/tem em mãos,
cada um com propósito diferente:

- **📋 roster completo (81 colunas)** — mesma lógica de
  `parse_mesarios_gsheet_csv.py`, mas em JS, gravando direto no Supabase com
  a sessão da equipe (RLS `mesarios_raw_write_zona`, escopada pela zona do
  usuário — única policy de escrita em `sime_mesarios_raw`, adicionada em
  20/08/2026; antes só existia SELECT pra `authenticated`, e só o SQL Editor
  com service_role conseguia popular o staging). Deleta o staging antigo só
  daquela zona/UF (não `TRUNCATE` — preserva o staging de outra zona em
  paralelo), reinsere e chama `sime_sync_atores_from_raw` — que faz o diff
  completo (UPSERT + `ativo=false` em quem saiu). Pressupõe que o arquivo é
  o roster **inteiro** da zona.
- **📞 atualizar contatos (16 colunas, com `Ciente`)** — formato mais
  simples do TRE (`Zona/Seção/Nome/Inscrição/Situação/Localidade/Nº
  Local/Nome Local/Cód. Objeto Local/Nº Função Eleitoral/Função
  Eleitoral/Data Atualização/Ciente/whatsapp/celular/telefone2`), geralmente
  um **recorte** (ex.: só quem respondeu "não sou essa pessoa"), não o
  roster inteiro — por isso NÃO passa pelo pipeline acima: passar um
  recorte pelo diff completo inativaria por engano todo mundo ausente do
  arquivo. Em vez disso, é `UPDATE` direto em `sime_atores`, casando por
  `inscricao_eleitoral`, só em quem está no arquivo.
  `Ciente` (confirmado empiricamente em 20/08/2026 cruzando 3 arquivos reais
  da zona — nunca documentado formalmente pelo TRE): `0`=sem contato,
  `1`=confirmou convocação, `2`=informou não ser a pessoa procurada. Decisão
  deliberada de 20/08/2026: diferente do roster de 81 colunas (que nunca
  toca `confirmacao`), este arquivo é explicitamente sobre status de
  contato, então **escreve** em `sime_atores.confirmacao`
  (`Ciente=1`→`confirmado`, `Ciente=2`→`contato_incorreto`) e em
  `telefone_whatsapp` — exceção deliberada à regra "só WhatsApp/Hermes muda
  confirmacao", não descuido.
- **📋 colar lista de telefones (texto livre, 20/08/2026)** — pra quando o
  cartório tem só uma lista solta (WhatsApp, anotação, planilha copiada), não
  um dos dois arquivos oficiais do TRE acima. Cola texto qualquer numa
  textarea, uma pessoa por linha; nome e outras colunas, se tiver, são
  ignorados — só extrai **título de eleitor** (12 dígitos, tolera espaço
  entre blocos) e **telefone**, e faz `UPDATE` de `telefone_whatsapp`
  casando por `inscricao_eleitoral` (nunca mexe em `confirmacao`, nunca
  inativa ninguém — mesmo modelo do "atualizar contatos" acima, só que sem
  precisar virar CSV primeiro). Deliberadamente conservador: só aceita
  telefone que já bate limpo num formato válido — 10-11 dígitos (DDD+8/9),
  12-13 com `55` na frente, ou 8-9 dígitos soltos (aí assume DDD 86, seguro
  porque as duas zonas do SIME são no Piauí, que tem DDD único pro estado
  inteiro — não serviria um sistema genérico multi-estado). **Não tenta
  consertar contagem de dígito errada** — achado real numa lista real
  colada em produção: telefones com um dígito a mais depois do `55`
  (provável artefato de cópia/formatação de planilha de origem), outros sem
  DDD. Linha sem título ou sem telefone reconhecível fica de fora do
  resultado, listada pra conferência manual — adivinhar teria sido pior que
  não gravar (arriscava telefone errado no cadastro de alguém).

`SIME_convocacao.html` tem mais três abas:
- **📊 Dashboard** (`sime_resumo_secoes.js`, redesenhado em 20/08/2026 a
  partir de um mockup do cartório) — logo acima dos stat cards, uma
  **barra-funil da zona inteira** e **3 gráficos de pizza** (redesenhados em
  21/08/2026 — a pedido do cartório, substituindo o desenho de 4 pizzas de
  2 fatias que existia desde o dia anterior; SVG puro, sem lib de gráfico,
  projeto é sem framework):
  - **3 pizzas, uma por grupo** — MRV (Mesários) / Coordenadores de
    Acessibilidade / Auxiliares de Eleição (apoio logístico) — cada uma com
    **3 fatias mutuamente exclusivas que somam o Total daquele grupo**:
    Confirmado (verde) / Convocado — designado mas ainda não confirmado
    (azul) / Vazio — ninguém designado (cinza). Antes eram 2 pizzas por
    grupo (nomeado×vazio separada de confirmado×total); agora é uma pizza
    só, mais completa. "Total" tem semântica diferente pros dois tipos de
    grupo: MRV é por **cargo de mesa** (4 por seção — `rsCalcular()` já
    somava isso como `designados`/`totalCargos` pros cards de local, só
    nunca tinha virado pizza própria); Coordenador de Acessibilidade e
    Auxiliar de Eleição não têm cargo fixo no schema, então a vaga virou
    **1 por local de votação** (mesma premissa de "esse prédio tem alguém
    desse tipo?" que já existia no desenho anterior combinado, agora com
    Coordenador e Auxiliar **separados um do outro** em vez de um bucket só
    de "apoio logístico" — a query em `rsCarregar()` passou a trazer
    `funcao` junto pra dar pra distinguir).
  - **Barra-funil acima das pizzas** — resume a zona inteira (MRV + Coord. +
    Auxiliar somados) em 3 estágios sobrepostos na MESMA faixa horizontal
    (não 3 barras separadas, já que cada estágio é subconjunto do anterior):
    Total de vagas (faixa de fundo, cinza) → Convocados (barra mais curta
    por cima, azul) → Confirmados (a mais curta de todas, verde) —
    `rsBarraFunil()`.
  - **Tabela "🏘️ Progresso por município e função" (21/08/2026)** — pedido
    direto do cartório: "saber por cidade e por função se já está com todas
    as funções preenchidas e se já foi confirmado". A barra-funil e as
    pizzas são só da ZONA inteira; uma zona do SIME cobre vários municípios
    (ex.: 7ª Zona = Campo Maior + Jatobá do Piauí + Sigefredo Pacheco), e
    até então não tinha como ver esse recorte sem entrar local por local no
    drilldown. `rsCalcular()` agrega os mesmos números de `porLocal` (que já
    carrega `.municipio` em cada entrada) por município — uma linha por
    município, sem recalcular nada do zero. Cada grupo (MRV/Coord./
    Auxiliar) mostra DUAS contagens lado a lado, porque são perguntas
    diferentes: "confirmados/total" (cor verde se bateu o total, vermelha
    se ninguém) e, só quando diverge, uma nota "(N pr.)" = preenchido —
    tem alguém designado ali, confirmado ou não (mesmo padrão de
    `rsCardLocal`, que já separa designados de confirmados). Coluna
    **Situação** resume os 3 grupos num só selo: ✅ tudo confirmado (as 3
    funções bateram 100% confirmadas) / 🔶 preenchido mas falta confirmar
    (as 3 têm gente designada, mas nem tudo confirmado) / ❌ ainda falta
    preencher (pelo menos uma função tem vaga vazia). `rsSituacaoMunicipio()`
    calcula os dois booleanos (preenchido/confirmado) por grupo antes de
    decidir o selo. Tabela HTML de verdade (`<table>`), não `.import-card`
    em grade — mesmo padrão já usado no Relatório ELO, mais legível pra
    comparar município a município numa lista. **Fechada por padrão**
    (mesmo dia, ajuste rápido a pedido do cartório: "ficou denso demais no
    topo") — cabeçalho clicável tipo disclosure (▸/▾, `rsToggleMunicipios()`
    / `rsMunicipiosAberto`), corpo da tabela só entra no HTML quando
    expandida, não só escondido por CSS. Cogitou-se substituir por gráficos
    de pizza (um por município), mas descartado: com várias cidades vira
    muitos gráficos pequenos, mais difícil comparar todas de uma vez do que
    numa tabela — o problema era densidade visual, não o formato.
  - Nenhum dos três (funil, tabela por município, pizzas) aparece no
    drilldown por local — série específica pra visão de conjunto, repetir
    dentro do drilldown seria redundante.
  Depois dos gráficos, os 4 cards de estatística no topo (locais
  de votação, seções, **mesários MRV confirmados/total + quantos faltam**,
  **apoio logístico AL confirmados/total + quantos faltam** — antes os dois
  últimos cards só mostravam o total, sem quebra por `confirmacao`; o card
  de apoio foi de um `count` só pra buscar a linha inteira, já que agora
  precisa contar confirmados também) e, abaixo, cards por
  **local de votação** (`sime_secoes` não tem id próprio de "local" nem
  endereço — o agrupamento é por `local_nome`+`municipio`, sem rua/povoado)
  com barra de progresso (cargos designados/total), busca por nome e
  alternância grade/lista. Clicar num local abre o **drilldown por seção**:
  um card por seção com o nº de eleitores, os 4 cargos de mesa
  (❌ sem designação / 🔶 aguardando confirmação / ⚠️ recusou ou contato
  incorreto / 🔁 precisa ser substituído / ✅ confirmado) **com o nome de
  quem está designado** em cada cargo (20/08/2026 — antes só mostrava o
  ícone, sem dizer quem é a pessoa) e a data da última confirmação. **Clicar
  no nome** de um mesário no drilldown abre o mesmo modal de "Contatar
  mesários" (tentativas de contato + histórico) — `cmAbrirModal` carrega
  `cmDados` na hora se a aba Contatar mesários ainda não tiver sido visitada
  nesta sessão, em vez de abrir um modal vazio.

  **Bug real corrigido em 20/08/2026 — % do card de local era sobre
  designados, não confirmados.** Uma seção com mesário no cargo mas nunca
  contactado (ou contactado e sem resposta) contava como "pronta" — o
  cartório reportou um local em 100%/verde com pelo menos 3 seções ainda
  incompletas. A cor/barra/percentual agora são sobre `confirmados/total`;
  "designados" (tem alguém atribuído, confirmado ou não) continua exibido,
  só que como nota secundária, não mais controlando a cor.

  **`precisa_substituir` tem prioridade visual sobre `confirmacao`.** É uma
  flag booleana própria (`sime_atores.precisa_substituir`, default `false`),
  deliberadamente separada de `confirmacao='substituido'`: esta última é o
  status **já resolvido** (a pessoa confirmou que será trocada, geralmente
  via Hermes); a flag é o item de trabalho **ainda em aberto** — o cartório
  decidiu que alguém precisa ser trocado (não respondeu depois de várias
  tentativas, ficou inelegível, etc.) mas ainda não achou substituto. Por
  isso um mesário já `confirmado` pode ganhar a flag depois e o Dashboard
  troca o ícone de ✅ pra 🔁 (e ele deixa de contar como "mesa completa
  confirmada" nas estatísticas) — confirmado não é blindado contra precisar
  de troca depois. Setada/desfeita em "Contatar mesários" (botão no card e
  dentro do modal) ou no modal do mesário; nunca pelo Hermes.
- **📞 Contatar mesários** (`sime_contatar_mesarios.js`) — fila de contato
  por status (falta contactar, confirmado, recusou, contato incorreto,
  **precisa ser substituído** — filtro próprio, independente do bucket
  "já substituído" — e substituído), mostra o recado (`observacao`) de quem
  respondeu, e permite marcar **meio de contato** (WhatsApp/Carta
  Registrada/Oficial de Justiça)
  + status do envio por mesário (`sime_atores.meio_contato`/
  `status_contato_alternativo`, `sql/SIME_atores_meio_contato.sql` — Carta/
  Oficial de Justiça usam o endereço já no processo do TRE, o SIME só marca
  qual meio usar e o andamento, não guarda endereço). Botão **"📢 Criar
  campanha com estes"** pega o filtro atual (ex.: só quem falta contactar,
  já sem quem não tem WhatsApp) e manda pra `SIME_atores.html?tab=disparo`
  com esse grupo pré-selecionado (via `sessionStorage`, lido e apagado uma
  única vez) — reaproveita o motor de campanha que já existe em Disparo em
  massa, em vez de duplicar essa UI dentro de Convocação. **Clicar no nome**
  do mesário abre um **modal** (não mais painel inline — pedido do cartório
  em 20/08/2026) com telefone/WhatsApp e código de rastreio editáveis num
  "Salvar" só, mais duas listas de histórico: **📞 Tentativas de contato**
  (últimos 10 registros de `sime_campanhas_confirmacao` por `ator_id` — o
  que o Hermes de fato tentou mandar) e **📜 Atualizações** (últimos 10
  `sime_logs` cujo `payload->>ator_id` bate com a pessoa — telefone/rastreio
  editados manualmente, meio de contato trocado, status de envio, marcação
  de contato incorreto). Único ponto do sistema, além de `SIME_atores.html`,
  que deixa editar dado de contato de um ator.

  **Histórico do Hermes agora entra no modal (20/08/2026 — antes ficava de
  fora "de propósito").** `hermes_confirmou_mesario` e `hermes_atualizou_info`
  (gravados por `api/hermes-mesarios.js` quando o próprio mesário responde no
  WhatsApp) passaram a guardar `id` dentro de cada item de `afetados` (antes
  só nome/seção) — o modal casa esses logs por containment
  (`payload->afetados` contém `[{id}]`, via `.contains()`), não por
  `payload->>ator_id` como os logs gravados pelo próprio SIME (`afetados` é
  lista porque uma resposta pode valer pra mais de uma convocação da mesma
  pessoa — mesário e apoio logístico). Antes disso, casar exigiria
  comparação fuzzy por nome; agora é exato.

  **Observações e reestilo do modal (20/08/2026), a partir de referência
  visual do cartório.** O modal ganhou seções com cabeçalho (📇 Contato, 📞
  Tentativas de contato, 📜 Atualizações, 📝 Observações) e um bloco
  chave-valor no topo (função/seção/título/situação) — pedido explícito do
  cartório mostrando a tela de outro sistema como referência de estilo.
  `sime_atores.observacao` virou algo que o cartório também escreve, não só
  lê: `cmAdicionarObservacao()` anexa no mesmo formato que o Hermes já usa
  (`[carimbo] Autor: texto`, append-only, nunca sobrescreve — mesma regra de
  sempre), só trocando o autor pro nome de quem está logado
  (`sime_usuarios.nome`, cacheado por `window.nomeDoUsuario()` em
  `SIME_convocacao.html`, mesmo padrão de `zonaDoUsuario()`) marcado como
  "(cartório)" pra distinguir de recado vindo do WhatsApp. `cmParseObservacoes()`
  quebra o texto acumulado em entradas pra exibir como lista (split antes de
  cada carimbo `[AAAA-MM-DD`, não por linha — uma mensagem de WhatsApp pode
  ter quebra de linha própria). A observação nova NÃO entra na lista
  "Atualizações" (que lê `sime_logs`) pra não duplicar visualmente o que já
  aparece na seção própria — o `sime_logs` ainda é gravado, só não é
  renderizado ali.

  **Confirmar manualmente (21/08/2026, revertido no mesmo dia) — o TRE tem
  campanha própria, mas nem sempre alcança todo mundo; é de lá (ou de
  ligação/presencial) que o cartório sabe quem já confirmou sem ter passado
  pelo WhatsApp do SIME.** Botão **"✅ Confirmar participação"** (card e
  modal, some depois de confirmado) — pensado pro fluxo "ir de pessoa em
  pessoa": marca `confirmacao='confirmado'` igual o Hermes marcaria. Só
  isso. Primeira versão (mesmo dia) também enfileirava em
  `sime_campanhas_confirmacao` uma mensagem de convocação automática pro
  Hermes entregar — o cartório pediu pra tirar: confirmar participação por
  aqui não deve criar fila de envio nenhuma. `cmConfirmarEEnviar` (que
  fazia as duas coisas) virou `cmConfirmarParticipacao` (só a primeira);
  `CM_TEMPLATE_CONVOCACAO`/`cmPersonalizarMensagem` (o texto que era
  enfileirado) foram removidos por ficarem sem nenhum uso. Quem quiser
  mandar mensagem de verdade continua tendo o motor de campanha em massa de
  `SIME_atores.html` (disparo com verificação SIM/NÃO) — este botão nunca
  foi pensado pra substituir aquele fluxo.

  **Apoio logístico entrou na mesma fila de contato (21/08/2026) — achado
  real: era contado no card do Dashboard, mas não tinha como contactar/
  confirmar um por um.** `cmCarregar()` foi de `.eq('funcao','mesario')`
  pra `.in('funcao', ['mesario','coord_acessibilidade','auxiliar_eleicao'])`
  — apoio logístico ganha o mesmo modal, os mesmos botões (Confirmar,
  Marcar para substituir, meio de contato, tentativas), sem código
  duplicado. A única diferença é o rótulo de função: mesário usa
  `funcao_mesa` (Presidente/1º Mesário/...), apoio logístico não tem cargo
  de mesa, então `cmRotuloFuncao()` cai pro nome da própria função
  ("Coordenador(a) de Acessibilidade" / "Auxiliar de Serviços Eleitorais
  (apoio logístico)") — mesmo texto que `api/hermes-mesarios.js` já usa,
  pra não inventar um rótulo novo. O drilldown por seção do Dashboard
  continua só de mesário — é estruturalmente sobre os 4 cargos de mesa, não
  faz sentido encaixar apoio logístico ali; ele continua só no stat card
  agregado do topo.

  **Filtro por função (21/08/2026)** — segundo `<select>` na fila de
  contato (`cm-filtro-funcao`), independente do filtro por status
  (`CM_BUCKETS`): Todas as funções / Mesário (MRV) / Coordenador(a) de
  Acessibilidade / Auxiliar de Eleição. Os dois filtros se combinam (ex.:
  "falta contactar" + "só apoio logístico"). Pedido direto depois que apoio
  logístico entrou na mesma lista — sem isso não dava pra separar os dois
  grupos pra trabalhar um de cada vez.

  **Bug real, grave, corrigido em 21/08/2026 — "Registrar tentativa" (e toda
  ação registrada por esta página) gravava com sucesso mas ficava invisível
  pra sempre na releitura.** Sintoma reportado pelo cartório: clicar
  "Registrar tentativa" mostrava o toast de sucesso, mas a lista "Tentativas
  de contato" continuava sempre "Nenhuma tentativa registrada ainda" — mesmo
  depois de reabrir o modal. Causa raiz: `window.log()` (usado por toda
  `SIME_convocacao.html` — tentativa, observação, edição de telefone,
  confirmação manual, e o log de `sime_mesarios_sync.js` que alimenta a aba
  Histórico) nunca preenchia `eleicao_id` no insert em `sime_logs`. A policy
  de SELECT dessa tabela é `eleicao_id IN (SELECT id FROM sime_eleicoes
  WHERE zona visível)` — `NULL IN (...)` nunca é verdadeiro em SQL, então
  todo registro gravado com `eleicao_id` nulo ficava permanentemente
  invisível pra qualquer sessão autenticada (só um `service_role`, que
  ignora RLS, conseguia ver). A policy de INSERT é `WITH CHECK (true)`, por
  isso a escrita nunca falhava e o toast sempre dizia sucesso — o bug era
  inteiramente silencioso. Confirmado em produção antes do fix: 6
  `mesario_tentativa_contato`, 8 `mesario_editar_telefone`, 2
  `mesarios_sync_csv`, entre outros, todos com `eleicao_id` nulo. O mesmo
  defeito existia em `log()` de `SIME_atores.html` (usada por
  `SIME_relatorios.html`) — corrigido junto. As duas páginas agora resolvem
  a eleição ativa da zona do usuário (`getEleicaoAtiva()` de
  `sime_dados.js`, cacheada) e preenchem `eleicao_id` no insert;
  `SIME_convocacao.html` precisou passar a chamar `initSimeDados(supabase)`,
  que não fazia antes (sem isso, `getEleicaoAtiva()` sempre cai no fallback
  `null` e reproduziria o mesmo bug). `sql/SIME_logs_eleicao_id_fix.sql` tem
  o backfill do que já tinha sido gravado assim antes do fix — já aplicado
  em produção nas duas zonas.

  **Link do WhatsApp pré-preenchido, copiado em vez de aberto (21/08/2026,
  ajustado no mesmo dia)** — pedido do cartório: indo de nome em nome
  confirmar se o telefone cadastrado ainda é da pessoa certa, digitar a
  mesma pergunta toda vez que abre uma conversa nova era repetitivo.
  `cmMsgConfirmarContato(p)` monta "Bom dia, esse contato é de {NOME} ?" e
  `linkWhatsApp()` (já aceitava um 2º argumento de mensagem, só não era
  usado aqui) preenche via `?text=` do link `wa.me`. Primeira versão abria o
  link direto (`<a target="_blank">`); o cartório pediu pra trocar por
  **copiar** (`cmCopiarLinkWhatsApp`, `navigator.clipboard.writeText`) —
  abrir aba/app novo a cada clique, pessoa após pessoa, era mais disruptivo
  do que precisava; copiado, o link pode ir pra onde for mais conveniente
  (ex.: um WhatsApp Web já aberto). Ainda precisa colar e enviar manualmente
  — isso não manda nada sozinho. Só no botão dedicado do modal; o link do
  telefone no card da lista continua sendo um link normal, sem mensagem
  (contextos diferentes — o card é só "abrir a conversa", o botão do modal é
  especificamente o fluxo de "confirmar que é essa pessoa").

  **Copiar o link do WhatsApp já registra a tentativa sozinho (21/08/2026)**
  — pedido direto: "atualizar automaticamente que tentei contato". Antes,
  copiar o link e registrar que houve uma tentativa eram duas ações
  separadas (a segunda exigia preencher a Nota manualmente). Agora
  `cmCopiarLinkWhatsApp()` chama `cmRegistrarTentativaCore(id, 'whatsapp',
  'Copiou o link do WhatsApp pra confirmar contato')` na sequência e
  recarrega a timeline do modal — clicar em copiar já é, por si só, uma
  tentativa de contato registrada, sem passo extra.

  **Lista única de telefones — principal + alternativos do TRE + cadastrado
  à mão (21/08/2026)** — achado real: um mesário pode ter mais de um
  telefone de contato. A planilha do TRE (ELO) já traz até 5 campos por
  pessoa (`telefone_pessoal_mesario`, `telefone_1_eleitor`,
  `telefone_2_eleitor`, `telefone_contato_eleitor`,
  `telefone_comercial_mesario`, todos em `sime_mesarios_raw`), mas
  `sime_sync_atores_from_raw()` só grava UM em
  `sime_atores.telefone_whatsapp` — `COALESCE(telefone_pessoal_mesario,
  telefone_1_eleitor, telefone_2_eleitor, telefone_contato_eleitor)`, nessa
  ordem (`telefone_comercial_mesario` nem entra no COALESCE) — e os outros
  ficavam invisíveis pro cartório, mesmo intactos no staging. `cmListaTelefones(p, raw)`
  junta tudo numa lista só (principal + os do TRE que forem diferentes dele
  + `sime_atores.telefone_alternativo`, se tiver — ver
  `sql/SIME_atores_telefone_alternativo.sql`), sempre casando por título de
  eleitor (`inscricao_eleitoral`/`inscricao` — `ator_id` do staging nunca foi
  preenchido em produção) e deduplicando por dígito (sem o "55", já que o
  TRE não segue convenção nenhuma de formato).

  Cada telefone da lista tem seu próprio botão **"🔗 Copiar"** — pedido
  direto: "o botão de copiar vir antes de cada número, apresentando todos os
  números do mesário", pra realmente dar pra **tentar contato por qualquer
  um deles**, não só ver como referência (versão anterior, do mesmo dia, só
  copiava o texto cru sem montar link nem registrar tentativa —
  substituída). `cmCopiarLinkWhatsAppNumero(id, numero)` generaliza
  `cmCopiarLinkWhatsApp()` pra aceitar qualquer número: monta o link `wa.me`
  já com a mensagem de confirmação PRA AQUELE número específico e registra
  a tentativa igual ao principal.

  **`telefone_alternativo` (novo campo em `sime_atores`)** — pra quando o
  cartório descobre um número que não está em NENHUM campo oficial do TRE
  (ligou pra um parente, alguém do local informou outro contato). Campo
  "+ Adicionar telefone" no modal (`cmAdicionarTelefoneAlt`) grava ali sem
  mexer no `telefone_whatsapp` principal (que continua sendo o que
  Hermes/campanha em massa usam por padrão) — só esse item da lista tem
  botão de remover (✕), já que é o único que o cartório "possui" de fato (os
  do TRE são só leitura do staging, o principal se edita pelo campo de
  sempre). "Atualizar no ELO" continua manual — o SIME não escreve na
  planilha do TRE, isso é fora do sistema.

  **Toda ação desta tela agora grava QUEM fez, não só O QUE foi feito
  (21/08/2026) — achado real reportado pelo cartório num caso concreto
  (ADRIANA PAZ OLIVEIRA): "tentou contactar" e "telefone atualizado
  manualmente" apareciam na timeline sem dizer quem do cartório fez.** Só
  `cmAppendObservacao` (Observações) já cravava o autor — mas embutido no
  próprio texto do carimbo (`[data] Fulano (cartório): ...`), nunca como
  campo à parte no log; nenhuma das outras ações (registrar tentativa,
  copiar link do WhatsApp, editar telefone/rastreio, trocar meio de
  contato, marcar contato incorreto/precisa-substituir, confirmar
  manualmente, adicionar/remover telefone alternativo) gravava autor
  nenhum. Toda chamada a `log()` nesta tela passou a ir por `cmLog()`
  (`sime_contatar_mesarios.js`), que injeta `payload.autor =
  window.nomeDoUsuario()` (mesmo helper cacheado que a Observação já usava)
  antes de gravar — sem tocar no contrato de `acao`/demais campos do
  payload, então nada que já lia esses logs quebra. As duas timelines do
  modal (**📞 Tentativas de contato** e **📜 Atualizações**) mostram
  "(por Fulano)" ao final de cada item via `cmPorAutor()`, só quando o
  payload tem `autor` — entradas gravadas ANTES deste fix (produção já tem
  histórico assim) não têm de onde vir esse dado, então ficam sem o "(por
  ...)" mesmo, em vez de inventar um autor genérico pra elas. Campanhas
  automáticas do Hermes (📢 na timeline de tentativas) continuam sem autor
  de propósito — não foi uma pessoa do cartório que mandou aquela.

  **Bug real reportado em 21/08/2026 — "clico em Salvar e o modal não
  fecha".** Investigando, `cmSalvarModal()` não tinha nenhum try/catch ao
  redor do `await sb.from('sime_atores').update(patch)...`. Um erro de
  BANCO (RLS, constraint) não derruba esse await — a chamada resolve
  normalmente com `{data, error}`, e isso já era tratado (toast + mantém
  modal aberto). Mas uma falha de REDE de verdade (sem sinal, timeout —
  cenário que o próprio projeto já assume como normal, ver filosofia
  offline-first) FAZ o `await` lançar uma exceção de verdade — sem
  try/catch, ela saía sem tratamento nenhum: nenhum toast aparecia, e
  `cmFecharModal()` (a última linha da função) nunca era alcançado. Do
  ponto de vista de quem clicou, parecia que o botão simplesmente não fazia
  nada. `cmSalvarModal()` agora envolve as escritas num try/catch: em
  qualquer falha inesperada, mostra "⚠ Falha ao salvar — verifique a
  conexão e tente de novo" e MANTÉM o modal aberto (não descarta o que a
  pessoa digitou) em vez de falhar em silêncio.

  **Código de rastreio só aparece no modal quando o meio é Carta Registrada
  (21/08/2026) — antes aparecia sempre, inclusive pra WhatsApp/Ligação/
  Ofício, onde rastreio dos Correios não tem sentido nenhum** (achado do
  cartório: "informação de carta duplicada"). Virou condicional a
  `meio_contato === 'carta_registrada'`. Como o campo pode não existir no
  DOM quando o modal renderiza, `cmSalvarModal()` guarda contra
  `getElementById` retornando `null` — sem o guard, trocar pra WhatsApp e
  salvar o modal quebraria (e sem o `if (rastreioEl && ...)` no monta-patch,
  apagaria por engano um código de rastreio já salvo só por ele ter saído
  de tela).

  **Modal como ponto único de operacionalização da comunicação (20/08/2026)
  — pedido explícito do cartório depois de ver a tela de referência.** Três
  adições, todas dentro do modal (não só no card de fora):
  - **💬 Abrir WhatsApp** — link `wa.me` direto pro número da pessoa (mesma
    `linkWhatsApp()` já usada no card), pra não precisar copiar telefone.
  - **Seletor de meio de contato + status, duplicado do card pra dentro do
    modal** — `cmSalvarMeio`/`cmSalvarStatusAlt` ganharam um
    `if (cmModalId === id) cmRenderModal()` no final, senão o modal aberto
    ficava com o `<select>` desatualizado depois de mudar pelo card (ou
    vice-versa). Trocar WhatsApp→Carta→Ofício direto do modal é o que o
    cartório chamou de "evolução do meio de contato".
  - **➕ Registrar tentativa** — diferente das duas listas de histórico já
    existentes, isso é uma AÇÃO: grava um `sime_logs` novo
    (`mesario_tentativa_contato`, payload `{ator_id, meio, nota}`) que
    entra na mesma timeline de "Tentativas de contato", misturado com o que
    o Hermes já mandou via campanha (`sime_campanhas_confirmacao`) — os dois
    juntos, ordenados por data, é o que dá pra ver a evolução de abordagem
    (WhatsApp automático → ligação manual → carta) num lugar só.
    `mesario_tentativa_contato` fica de propósito FORA de `CM_LOG_LABEL`
    (não aparece em "Atualizações") — só existe dentro da timeline de
    tentativas, pra não duplicar a mesma entrada nas duas listas.

  **Bug real corrigido em 21/08/2026 — "Salvar" perdia nota de tentativa/
  observação digitada, sem aviso.** O modal tem 3 caixas de texto com ação
  própria (telefone+rastreio → botão "💾 Salvar" do rodapé; nota de
  tentativa → "➕ Registrar tentativa"; observação → "➕ Adicionar
  observação") — cartório reportou ter digitado algo e "não salvou": a
  pessoa digitava numa das caixas de ação rápida e clicava no "Salvar"
  geral (o botão mais visível, no rodapé, parece "salvar a tela toda"), e
  esse botão só cobria telefone/rastreio — o texto se perdia em silêncio,
  sem erro nem aviso. `cmSalvarModal()` agora também recolhe
  `#mm-tent-nota`/`#mm-obs-nova` se tiverem algo digitado (reaproveitando
  `cmRegistrarTentativaCore`/`cmAppendObservacao`, extraídos dos botões
  próprios pra não duplicar lógica) — os botões específicos continuam
  funcionando igual, só que agora "Salvar" também é uma rede de segurança.
  Além disso, salvar sem nenhuma alteração (nem telefone, nem rastreio, nem
  as duas caixas) mostra "Nada para salvar" em vez de fechar o modal calado
  — fechar sem nenhum feedback também parecia "não fez nada".

  **Bug mais sério, achado investigando o de cima: "Salvar" reescrevia o
  telefone (tirando o "55") a cada clique, mesmo sem editar nada.** O campo
  telefone mostra o valor formatado por `fmtTelefone()`, que já tira o "55"
  da frente pra exibir "(86) 9xxxx-xxxx"; mas `sime_atores.telefone_whatsapp`
  é guardado COM "55" (mesma convenção do resto do sistema — Ciente/
  colar-lista já gravam assim). `cmSalvarModal()` comparava esses dois
  valores direto — sem "55" de um lado, com "55" do outro — então SEMPRE
  achava que o telefone tinha mudado, mesmo só abrindo o modal e clicando
  Salvar sem tocar em nada, e regravava a versão sem "55" no banco. Corrigido
  normalizando os dois lados com `telSemPais()` antes de comparar, e
  gravando de volta com "55" quando realmente muda.

  **Normalização em massa de `telefone_whatsapp` (21/08/2026)** — investigar
  o bug acima levantou que ~32% dos 723 atores ativos com telefone (232
  registros) não estavam no formato "55"+DDD+9dígitos que o resto do sistema
  assume. Rodado via SQL Editor (não é uma migração — `sql/
  SIME_telefones_normalizacao.sql` documenta a query e o resultado, não
  reaplica sozinha): 229 registros corrigidos, cobrindo formatos com DDD+9
  faltando só o "55" (86, já seguro por definição), sem DDD nenhum (assume
  86 — as duas zonas do SIME são só no Piauí, DDD único, mesma premissa já
  usada no parser de "colar lista"), formato antigo de celular sem o dígito
  9 (regra: subscriber começando 6-9 é celular pré-2016 e ganha o 9; 2-5 é
  fixo e não ganha), e um "0" extra na frente por erro de digitação. Nenhuma
  premissa foi assumida sem checar exceção primeiro (COUNT contra os 723
  registros antes de aplicar). Ficaram de fora, de propósito, por exigirem
  adivinhar em vez de deduzir: **1 placeholder `"000000000000"`** (não é um
  número — não vira um número inventado; MARIA DE FATIMA GOMES EDUVIRGES
  precisa que o cartório confirme se ela tem telefone de verdade ou se o
  campo deve ficar `NULL`) e **1 registro de 14 dígitos** (ANA KAROLIINE DA
  SILVA ALVES, `"55869994881793"` — um dígito a mais depois do "55", mesmo
  artefato de cópia/planilha já documentado alhures; corrigir exigiria
  adivinhar QUAL dígito é o duplicado).

  **Ligação telefônica como meio de contato (20/08/2026).** Terceiro meio
  além de Carta Registrada/Oficial de Justiça, mas com vocabulário de status
  diferente — "Enviado/Entregue" não faz sentido pra uma ligação.
  `status_contato_alternativo` ganhou 4 valores novos
  (`a_ligar`/`atendeu`/`nao_atendeu`/`numero_errado`) só pra esse meio;
  `cmStatusLabelSet(meio)` escolhe qual dos dois conjuntos mostrar no
  `<select>`, e trocar de meio zera o status anterior só quando o
  vocabulário muda de fato (Carta↔Ofício continuam compartilhando os
  mesmos 4 valores de sempre, então não zeram entre si).

  **Título de eleitor na busca (20/08/2026).** `getAtores()` (`sime_dados.js`)
  e o `select()` de `sime_contatar_mesarios.js` agora trazem
  `inscricao_eleitoral`; a busca por nome em `SIME_atores.html` e em
  "Contatar mesários" também casa pelo número do título, e o card/modal de
  edição mostram o título quando existe. Campo somente leitura em
  `SIME_atores.html` (`abrirModal()`) — é dado do TRE, não editável pelo
  cartório, ao contrário de telefone/observação.

  **Rastreamento de Carta Registrada (20/08/2026) — sem API dos Correios.**
  Avaliado e descartado: a API oficial dos Correios pra consulta de
  rastreamento (SIGEP/Cartão de Postagem) exige contrato comercial pago —
  incompatível com o custo R$ 0,00/mês do projeto e com o volume baixo/
  irregular de cartas de um cartório (não é remetente contratado, envia
  avulso). `sime_atores.codigo_rastreio` (novo campo, texto livre — nunca
  validado por regex, o formato varia) guarda só o número do objeto pra
  montar o link público
  `https://rastreamento.correios.com.br/app/index.php?objetos=<codigo>` —
  o cartório clica, olha o site dos Correios, e marca o status manualmente
  em "Status do envio" (`status_contato_alternativo`) como sempre. Não há
  consulta automática nem polling — decisão deliberada, não pendência.

  **"Já contactado, aguardando resposta" (20/08/2026).** Dentro do bucket
  "pendente" (que hoje é binário: respondeu ou não), `cmCarregar()` também
  conta quantas campanhas com `status='enviado'` cada pessoa já recebeu
  (`sime_campanhas_confirmacao`, por `ator_id`) e mostra "📨 Já contactado
  (Nx) — aguardando resposta" no card de quem tem pelo menos uma — só pra
  quem ainda está `pendente` (confirmado/recusado/etc. já são um desfecho,
  não precisam dessa nota). Não virou bucket de filtro novo — é anotação
  visual dentro do "falta contactar / sem resposta" de sempre, não uma
  reclassificação.

  **"🧩 Rodar script conversacional" no modal (28/08/2026)** — pedido
  direto: rodar um script salvo (aba 🧩 Campanhas, em Cadastro de Atores)
  pra um número avulso, sem precisar montar um filtro no Disparo em massa só
  pra uma pessoa. Diferente de tudo que já existia nesta tela (que sempre
  usa `telefone_whatsapp` cadastrado), o campo "Número indicado" aceita
  **qualquer** telefone — pré-preenchido com o principal da pessoa, mas
  editável na hora (ex.: ela acabou de informar outro contato por telefone).
  `cmEnviarScript()` normaliza o número digitado com
  `normalizarTelefoneWhatsapp()` (mesma heurística de todo import — ver
  "Todo import normaliza telefone..." acima) e faz exatamente o mesmo
  INSERT que o Disparo em massa faz em lote pro modelo "script"
  (`sime_campanhas_confirmacao` com `campanha_id` + `etapa_atual: 1`,
  `status: 'pendente'`) — só que um item de cada vez, com o `ator_id` da
  pessoa sempre preservado mesmo quando o número indicado é outro (é o que
  faz o envio aparecer na timeline "📞 Tentativas de contato" dela, que já
  filtra por `ator_id`, não por telefone). A mensagem da etapa 1 é
  personalizada com os mesmos placeholders do Disparo
  (`{nome}`/`{funcao}`/`{secao}`/`{local}`/`{municipio}`,
  `cmPersonalizarScript()` — duplicado de `personalizarMensagem()` de
  `SIME_atores.html` porque esta página não carrega aquele arquivo). Lista
  de scripts (`cmScriptCampanhas`) carrega junto com o resto de
  `cmCarregar()`; campanha `encerrada` fica de fora do `<select>` (mesmo
  filtro do Disparo), e mandar pra uma campanha `pausada`/`rascunho` avisa
  no toast que o item entra na fila mas só sai quando ela for ativada — não
  bloqueia o envio, só avisa. Grava `mesario_script_enviado` em `sime_logs`
  (com autor, `campanha_id` e o telefone usado) pra aparecer também em "📜
  Atualizações".
- **📜 Histórico** (`sime_historico_sync.js`) — últimas sincronizações
  (`sime_logs` com `acao='mesarios_sync_csv'`): quando, quantos registros,
  quantos atualizados/inativados.
- **📄 Relatório ELO** (`sime_relatorio_elo.js`, 21/08/2026) — quem o SIME já
  sabe que confirmou (`sime_atores.confirmacao='confirmado'`, por WhatsApp ou
  manualmente) mas cujo registro na planilha do TRE (ELO, staging em
  `sime_mesarios_raw`) ainda não reflete isso. Nasceu de uma consulta pontual
  no banco (14 pessoas encontradas na 7ª Zona na primeira vez) que virou tela
  própria pra não precisar pedir de novo. Junta por **título de eleitor**
  (`sime_atores.inscricao_eleitoral = sime_mesarios_raw.inscricao`) — não por
  `ator_id`, que nunca foi preenchido no staging em produção (a sincronização
  casa por inscrição, não grava o id de volta lá). Três situações mostradas:
  **"Sem registro no ELO"** (a pessoa não aparece na exportação mais recente
  do TRE — situação mais comum), **"Sem resposta registrada no ELO"** (existe
  no ELO mas `confirmou_convocacao` está nulo) e **⚠️ "ELO diz 'Não'"**
  (existe uma resposta explícita diferente da do SIME — destacado em
  amarelo e contado à parte, porque isso é uma divergência real que merece
  conferir com a pessoa antes de simplesmente atualizar o ELO, não só uma
  lacuna). Quem não tem título de eleitor cadastrado fica de fora — sem
  título não dá pra cruzar com o ELO de jeito nenhum.

  **Confirmação em lote a partir de dados do próprio ELO (21/08/2026)** — o
  caminho inverso também acontece: o cartório olha o ELO e vê gente que
  **já confirmou por lá** (WhatsApp, Título Net, presencial) mas o SIME ainda
  não sabe. Tratado, na época, como uma aplicação em lote do mesmo `UPDATE`
  que o botão de confirmar fazia um de cada vez (`confirmacao='confirmado'`
  + `data_confirmacao`), casando por título de eleitor — **sem enfileirar
  mensagem nenhuma** (achado real ao aplicar isso pela primeira vez: as
  pessoas dessa lista específica não tinham `secao_id`/local designado no
  SIME, e o template de mensagem sem seção/local produzia um texto quebrado
  — "...na Seção  — local a confirmar, ."). Essa cautela virou regra geral
  no mesmo dia: o botão "Confirmar" (hoje `cmConfirmarParticipacao()`) foi
  revertido pra nunca mais enfileirar mensagem nenhuma, nem um de cada vez —
  ver bloco acima. Decisão: só sincronizar o status;
  enfileirar mensagem fica pra quando a pessoa já tiver local designado (ou
  pelo botão "✅ Confirmar" de sempre, um de cada vez, onde o cartório vê o
  resultado na hora antes de continuar).

> **Landing padrão do site (20/08/2026)**: `vercel.json` redireciona `/`
> pra `SIME_principal.html?tab=modulos` (antes ia direto pro Admin) —
> qualquer um que loga cai no hub de módulos, não numa página específica.
> `?tab=<nome>` é genérico (`abrirAbaDaUrl()`), não só pra `modulos`.

> **Aba "Módulos" — "Painéis de TV" era, na prática, um bucket de "sem fase
> definida" (achado do cartório, corrigido em 26/08/2026).** `MODS.tv`
> (`SIME_principal.html`) tinha 9 itens sob o título "Painéis de TV", mas só
> 2 (Gerenciador de Painéis, TV Dia da Eleição) são televisão de verdade — os
> outros 7 (Administração, Recolhimento de Mídias, Cadastro de Atores,
> Convocação de Mesários, Tokens & QR Codes, Problemas, Relatórios) foram
> parar ali só por não terem `fase` fixa (`dx`/`d1`/`d`), não por serem TV. O
> cartório sinalizou especificamente Problemas, Convocação de Mesários e
> Cadastro de Atores como fora de lugar ali. Separado em dois grupos de
> verdade: `MODS.tv` ficou só com os 2 itens de TV; `MODS.adm` (novo, título
> "Ferramentas do cartório") recebeu os outros 7. `renderModulos()` já
> itera `Object.entries(MODS)` genericamente — bastou acrescentar o
> `<div class="sec-title">`/`<div class="mod-grid" id="mods-adm">` no HTML,
> nenhuma mudança de lógica. Os demais módulos `TV_*` (Preparação, Véspera,
> Distribuição) já viviam nos grupos de fase (`dx`/`d1`) desde sempre, perto
> do módulo de campo que alimentam — não fazem parte desta confusão.
>
> **Acesso a `SIME_convocacao.html` não tem trava de perfil, decisão
> deliberada (20/08/2026).** Qualquer login da equipe do cartório — não só
> Coordenador Geral/Monitor de Campo — escreve lá (marcar contato incorreto,
> mudar meio de contato, editar telefone, registrar tentativa, etc.).
> Diferente de Admin, que restringe seções/equipe/tokens ao perfil
> `config_equipe`: convocação de mesários é trabalho de todo mundo do
> cartório, não de um perfil específico, então não faz sentido gatear.

> **O antigo "🧑‍⚖️ Confirmação de mesários" do Admin** (modal próprio em
> `SIME_admin.html`, aba Seções) foi removido e virou link pra
> `SIME_convocacao.html` — o modal só sabia confirmado/recusou/substituído
> (sem contato incorreto, sem meio alternativo, sem dashboard por
> local/seção) e duplicava o que a página nova já faz melhor.

> **"Recusou" ≠ "não é a pessoa procurada" — e o SIME não separa isso
> sozinho.** O Hermes grava `confirmacao='recusou'` tanto pra "sou eu mas
> não vou atuar" quanto pra "não sou essa pessoa" (contato/CPF errado no TRE)
> — são casos bem diferentes (o segundo precisa de busca de contato novo, o
> primeiro precisa de substituto) mas caem no mesmo valor. Separar isso
> automaticamente exigiria o Hermes (repositório separado) classificar a
> frase e chamar uma ação nova — decisão de 20/08/2026: não fazer isso agora.
> Em vez disso, o cartório lê o recado na aba "📞 Contatar mesários" e clica
> "🔍 Marcar contato incorreto", que grava manualmente
> `confirmacao='contato_incorreto'` — um valor que só essa tela escreve,
> nunca o Hermes.

> **O "Confirmou convocação" da planilha não vira o status de confirmação do
> SIME.** Sobe pro staging por completude/auditoria, mas
> `sime_sync_atores_from_raw` nunca leu (e continua sem ler)
> `confirmou_convocacao`/`origem_resposta`/`justificativa` pra dentro de
> `sime_atores.confirmacao` — são dois controles paralelos. O status real do
> SIME só muda quando a pessoa responde de fato pelo WhatsApp, via
> `api/hermes-mesarios.js`. É esse campo real que a aba **📊 Dashboard**
> mostra (não o da planilha).

A sincronização pra `sime_atores` é feita por `sime_sync_atores_from_raw(p_zona_numero, p_uf)`
— UPSERT por `(inscricao_eleitoral, funcao)`, não DELETE+INSERT: preserva o
`id` de cada ator (não quebra `sime_campanhas_confirmacao.ator_id` nem
histórico de notificações) e nunca toca `confirmacao`/`status_convocacao`.
Quem sai da nova exportação vira `ativo=false`, não é apagado.
Casa o local de trabalho por `lower(municipio)` (não `initcap()` — corrigido
em 20/08/2026: `initcap('JATOBÁ DO PIAUÍ')` capitaliza o conectivo "Do", que
não bate com `sime_secoes.municipio='Jatobá do Piauí'` gravado em minúsculo;
o join nunca casava pra esse município e ~120 mesários de lá entravam sem
`secao_id`).

> **Bug real corrigido em 21/08/2026 — `telefone_whatsapp` era sobrescrito a
> cada resync, desfazendo correção/normalização manual.** O comentário do
> código já prometia "preserva sempre... whatsapp\_\*", mas o `DO UPDATE SET`
> gravava `telefone_whatsapp = EXCLUDED.telefone_whatsapp` sem condição —
> ou seja, toda vez que a pessoa continuava na exportação do TRE, o número
> corrigido/normalizado no SIME (edição manual pelo modal, ou a normalização
> em massa de 229 registros já aplicada em produção, ver
> `sql/SIME_telefones_normalizacao.sql`) era substituído de volta pelo
> `COALESCE` cru dos 4 campos de telefone do próprio arquivo do TRE — mesmo
> sem o cartório ter mudado nada. Corrigido pra
> `COALESCE(NULLIF(sime_atores.telefone_whatsapp, ''), EXCLUDED.telefone_whatsapp)`:
> só entra o valor do TRE se o campo ainda estiver vazio (nunca teve telefone
> ou foi limpo); um telefone já preenchido nunca mais é tocado pelo resync —
> corrigir de fato passa a exigir uma ação manual (modal, "atualizar
> contatos" ou "colar lista"), nunca o roster de 81 colunas.

> **Bug real corrigido em 21/08/2026 — subir só UMA das duas planilhas do
> TRE inativava por engano quem era da outra.** MRV (`base geral MRV`) e
> Apoio especializado (`Base Geral Apoio especializado`) são duas
> abas/arquivos separados, e o cartório nem sempre tem os dois em mãos na
> mesma sessão de upload (ex.: só a MRV foi atualizada esta semana). Antes,
> `msSincronizar()` (`modules/sime_mesarios_sync.js`) apagava **todo** o
> staging da zona/UF em `sime_mesarios_raw` antes de reinserir — subindo só
> a MRV, o staging da Apoio (gravado numa sincronização anterior) sumia
> junto, e `sime_sync_atores_from_raw`, ao não achar mais ninguém daquele
> tipo no staging, marcava `ativo=false` em toda a Apoio da zona, mesmo que
> ninguém tivesse de fato saído da exportação oficial. Corrigido escopando o
> `delete()` também por `tipo_registro` (`IN` só dos tipos — 'MRV'/'AL' —
> presentes nos arquivos carregados nesta sincronização): subir só a MRV
> agora só mexe no staging da MRV; o staging da Apoio, gravado numa sessão
> anterior, continua intacto e segue valendo pro cálculo de quem ficou
> inativo.

> **Bug real corrigido em 22/08/2026 — Coordenador de Acessibilidade e
> Auxiliar de Eleição entravam SEMPRE sem `secao_id` (100% dos 99 registros
> AL da 7ª Zona), mesmo os já confirmados.** Achado investigando por que o
> Dashboard mostrava "Vazio: 63" e 0% pros dois grupos de apoio logístico —
> o join original só tenta casar por `secao_local_trabalho` (número de
> seção), e o arquivo do TRE **nunca** preenche esse campo pra
> `tipo_registro='AL'`, só pra `'MRV'` (confirmado: 0 de 99 registros AL da
> 7ª Zona tinham esse campo preenchido). Sem `secao_id`, a pessoa existe e
> pode até estar confirmada, mas o Dashboard (que agrupa por
> `local_nome`+`município` via esse campo) não tem como saber onde ela
> atua — aparecia como se ninguém tivesse sido designado em lugar nenhum.
>
> Corrigido com uma ponte que **não adivinha nada**: tanto MRV quanto AL
> trazem `numero_local_votacao_local_trabalho` (código do LOCAL de
> votação, diferente do número da seção) já preenchido — quando existe. Um
> mesário (MRV) do mesmo local+município sempre tem `secao_local_trabalho`
> preenchido, então a função agora usa o número de seção de **qualquer**
> mesário do mesmo local como ponte pra resolver o `secao_id` do AL.
> Verificado antes de aplicar que isso é seguro: todas as seções de um
> mesmo local compartilham o mesmo `sime_secoes.local_nome` (ex.: local
> 1325 em Campo Maior → 7 seções diferentes, todas "G.E. Treze de Março"),
> então não importa qual seção específica a ponte resolve — o
> `local_nome`/município (que é tudo que AL precisa) sai certo de qualquer
> uma delas. `sql/SIME_sync_al_secao_bridge.sql`.
>
> Resultado depois de rodar de novo o sync na 7ª Zona: **Coordenador de
> Acessibilidade foi de 0/69 pra 64/69 com `secao_id`** — os 5 que
> continuam sem é porque nem eles têm o número do local no arquivo de
> origem (nada pra resolver, sem adivinhar). **Auxiliar de Eleição
> continua 0/30** — não é bug do SIME: os 30 registros dessa função
> específica simplesmente não trazem `numero_local_votacao_local_trabalho`
> nenhum no arquivo do TRE (checado direto na fonte), diferente de
> Coordenador de Acessibilidade que traz na maioria. Sem esse dado na
> origem, não há ponte possível — precisaria de uma fonte de dado
> diferente do TRE pra resolver isso (fora do escopo desta correção).

```sql
-- via SQL Editor (service_role), pra dump ELO/CSV colado manualmente:
delete from sime_mesarios_raw where zona_eleitoral_trabalho='7' and uf_trabalho='PI';
-- rodar o INSERT gerado por qualquer um dos três parsers acima

-- sincronizar (idempotente — pode rodar quantas vezes precisar)
select * from sime_sync_atores_from_raw(7, 'PI');  -- 7ª Zona
select * from sime_sync_atores_from_raw(94, 'PI'); -- 94ª Zona
```

> **Rodar de novo em staging já existente conserta dado antigo.** O fix do
> `initcap()`→`lower()` acima só passou a valer na PRÓXIMA sincronização —
> não retroagiu sozinho. Descoberto em 20/08/2026 quando a seção 245
> (Jatobá do Piauí) apareceu com os 4 cargos ❌ no Dashboard mesmo com gente
> cadastrada: os 682 registros de `sime_mesarios_raw` da 7ª Zona estavam
> parados desde 03/08, de antes do fix, e ninguém tinha rodado
> `sime_sync_atores_from_raw` de novo depois dele. Bastou rodar de novo
> sobre o staging já existente (sem precisar reenviar arquivo) — 682
> atualizados, 0 sem `secao_id` no final. Se aparecer seção "toda ❌" com
> gente que deveria estar lá, suspeitar disso antes de procurar bug novo.

> **Todo import normaliza telefone pro padrão WhatsApp agora (21/08/2026)**
> — pedido do cartório depois da normalização em massa de produção:
> "sempre que importar o contato, normalizar todos os contatos pro formato
> WhatsApp". Antes, cada um dos 3 caminhos de importação gravava um formato
> diferente em `telefone_whatsapp` — `mcAtualizar()` (Atualizar contatos)
> gravava os dígitos crus do arquivo sem "55"; `cpAtualizar()`/
> `cpNormalizarTelefone()` (colar lista) devolvia sem "55" e sem o dígito 9
> de celular antigo; e a própria `sime_sync_atores_from_raw()` (roster de
> 81 colunas) inseria o COALESCE cru do TRE, também sem "55". Só o modal de
> edição (`cmSalvarModal()`) já gravava no padrão certo. Os três agora usam
> a mesma heurística da normalização em massa (`sql/SIME_telefones_normalizacao.sql`):
> `normalizarTelefoneWhatsapp()` em JS (`sime_ui_utils.js`, carregada antes
> dos demais scripts em `SIME_convocacao.html`) e sua gêmea em SQL
> `sime_normalizar_telefone_whatsapp()` (usada dentro do INSERT de
> `sime_sync_atores_from_raw`, só pra gente NOVA — o preenchimento só
> entra quando `telefone_whatsapp` já está vazio, ver bug corrigido acima).
> `cpNormalizarTelefone()` manteve exatamente o mesmo critério de aceitação
> de sempre (rejeita comprimentos fora de 8/9/10/11/12-13-com-55 — ex.: o
> caso de 14 dígitos de artefato de cópia continua descartado, listado pra
> conferência manual) — só o valor de SAÍDA para o que já era aceito virou
> canônico, com "55" e o dígito 9 quando faltava.

> **Segunda varredura de normalização em massa (21/08/2026, mesmo dia,
> `sql/SIME_telefones_normalizacao.sql`).** O cartório usou o site ao vivo
> na janela entre a primeira varredura e os 3 caminhos de import ficarem
> corrigidos (item acima) — 237 números novos entraram fora do padrão
> nesse meio-tempo. Como `sime_sync_atores_from_raw` nunca sobrescreve um
> `telefone_whatsapp` já preenchido (ver bug corrigido), um número ruim
> gravado uma vez fica errado pra sempre até uma varredura manual — não é
> bug voltando, é a mesma troca deliberada de sempre. Reaplicado usando a
> função `sime_normalizar_telefone_whatsapp()` direto (em vez de reescrever
> o CASE), confirmado idempotente (0 candidatos na checagem seguinte).
> Moral prática: **rodar essa varredura periodicamente** (não só uma vez)
> enquanto o cartório seguir usando os 3 caminhos de import em paralelo às
> minhas correções — é esperado que um pouco de dado não-canônico volte a
> aparecer entre uma sessão de trabalho e outra.

**Confirmação por telefone é diferente de confirmação por arquivo.**
`sime_atores.confirmacao` só muda por duas vias, e cada uma sabe algo que a
outra não sabe:
- **WhatsApp/Hermes** (`api/hermes-mesarios.js`) — a pessoa respondeu de
  verdade pelo número cadastrado. Fonte mais confiável para "confirmado" e
  "recusou" (é a pessoa falando por si).
- **Arquivo de 16 colunas com `Ciente`** (aba 📞 Atualizar contatos, ver
  acima) — o TRE já correu atrás desse contato por outro canal. Única fonte
  pra "contato incorreto" em massa (`Ciente=2`), já que o Hermes não tem
  como aprender isso sozinho quando o número nem é da pessoa.

O roster de 81 colunas fica de fora dessa lista de propósito — nunca deve
escrever em `confirmacao`, mesmo carregando `confirmou_convocacao` pro
staging (só auditoria).

---

## PADRÃO DE CÓDIGO — OFFLINE-FIRST

```javascript
// SEMPRE assim para qualquer ação com persistência:
async function confirmarAcao(secaoId, dados) {
  const ts = await supabase.rpc('sime_now'); // NUNCA Date.now()
  const payload = { ...dados, updated_at: ts.data };

  try {
    const { error } = await supabase
      .from('sime_mesa_estado')
      .upsert(payload, { onConflict: 'secao_id' });
    if (error) throw error;
    showToast('✓ Confirmado');
    updateSyncBadge(0);
  } catch(e) {
    await enqueue('nome_acao', payload); // IndexedDB
    showToast('🟡 Salvo — sincronizará em breve');
  }
  render();
}
```

## PADRÃO — REALTIME (TVs)

```javascript
supabase
  .channel('mesa_updates')
  .on('postgres_changes', {
    event: '*', schema: 'public',
    table: 'sime_mesa_estado',
  }, payload => updateSecaoUI(payload.new))
  .subscribe();
```

> **Armadilha real, já mordeu em produção (06/08/2026)**: assinar a tabela no
> JS não basta — ela também precisa estar na publicação `supabase_realtime`
> do Postgres (`ALTER PUBLICATION supabase_realtime ADD TABLE ...`), senão o
> canal nunca dispara e ninguém percebe (não dá erro; a tela só nunca
> atualiza sozinha). `sime_mesa_estado` ficou sem isso desde sempre — só
> `sime_ocorrencias` tinha sido adicionada — e o sintoma foi "TV Dia não
> atualiza depois que o cartório resolve um problema" (um celular disfarça
> o mesmo bug porque relê o estado a cada volta de tela; um TV box ligado o
> dia inteiro não tem esse reforço). Corrigido e formalizado em
> `sql/SIME_realtime_publicacao.sql` — ao criar uma `subscribeX()` nova em
> `sime_realtime.js`, adicionar a tabela lá também.

---

## PENDÊNCIAS (atualizado em 27/07/2026)

Os itens 1 a 5 da lista antiga (módulo de acessibilidade, novos perfis no
Admin, enum de funções, `sime_empresas`, token de acessibilidade) estão
**concluídos** — assim como Realtime nas TVs, Supabase Auth, deploy na Vercel
e os QR Codes por zona.

### Migração localStorage → Supabase (concluída)

Já leem do banco: Admin (seções, equipe, mesários, atores), portal
(zonas, eleição), TVs (Realtime), tokens e os 6 módulos de campo.

> Esta seção dizia até 10/08/2026 que carga/lacre, instalador e distribuição
> "ainda" só gravavam em `localStorage` — desatualizado desde os lotes 5d/E
> da auditoria de UI/UX (08/08). Corrigido aqui porque uma pendência marcada
> como aberta que já foi fechada é pior que não documentar nada: leva a
> gastar tempo "migrando" o que já está migrado.

**Estado de campo já é Supabase-first**, com `localStorage` só como cópia
offline (mesmo padrão de todo o resto do app — grava no banco, espelha
localmente, sincroniza quando volta a rede):
- **Carga/lacre** (Coordenador de Preparação, TV Preparação, TV Véspera) —
  tabela `sime_carga_lacre` (upsert por `eleicao_id,secao_id`), com Realtime
  propagando pras TVs. `localStorage['sime_lacre_v3']` é só o espelho local
  (`save()`/`load()` em `SIME_coordenador_preparacao.html`), não a fonte.
- **Instalador** — grava via RPC `sime_acao_mesa` (mesma usada pelo
  Mesário); `localStorage['sime_inst_v1']` é o espelho local.
- **Conferente / TV Distribuição** — grava via RPC `sime_rota_estado_upsert`/
  `sime_rota_urna_toggle`; TV Distribuição lê por Realtime
  (`subscribeRotasEstado`); `localStorage['sime_dist_v1']` é o espelho local
  do Conferente.

**Nome da eleição, início da distribuição e intervalo entre saídas** —
concluído: `sime_eleicoes` ganhou `nome`/`dist_inicio`/`intervalo_saidas_min`
(mesmo padrão dos demais campos — banco é a fonte, localStorage é a cópia
offline). `getEleicaoAtiva()` (`sime_dados.js`) já devolve os três; `nome` é
compartilhado entre as duas linhas (1º/2º turno) da mesma zona, já que o
formulário só tem um campo pra ele.

Cadastro/edição de ator em `SIME_atores.html` grava direto em `sime_atores`
com sessão (criar, editar, remover/soft-delete) — corrigido: antes só gravava
`localStorage`, então uma edição "sumia" ao abrir em outra máquina. Como
`getAtores()` fica cacheado pela sessão (`sime_dados.js`), o salvar aplica a
mudança na cópia local (`window.ATORES_REAIS`) em vez de rebuscar — rebuscar
devolveria a lista antiga do cache.

### Pânico — propagação de volta ao campo (parcial)

O `SIME_mesario.html` assina o Realtime da própria seção e relê o estado ao
abrir e a cada volta de tela, então a resolução feita pelo Admin chega ao
aparelho. Além disso, **os campos de pânico só entram no payload quando o
toque foi de pânico** — o RPC trata `NULL` como "mantém", então nenhuma outra
ação pode desfazer a resolução (vale offline também).

O `SIME_acessibilidade.html` também recebe — assina as seções do **local** do
coordenador (`secao_id=in.(...)`, não a zona inteira) e relê ao entrar e a cada
volta de tela. Só o pânico vem do servidor: a fila é contagem local do
coordenador, e sobrescrevê-la com o número de outro aparelho seria pior que não
sincronizar.

Motorista, conferente, instalador e mídias **continuam só escrevendo** — são os
quatro em que ninguém de fora altera o estado durante a operação. Mesário e
acessibilidade, os dois que a equipe altera à distância (pânico), já recebem.

### Operação — antes de 4 de outubro

> **Prioridade é a 7ª Zona.** A 94ª segue zerada (0 tokens, 0 atores) e fica
> deliberadamente fora do foco atual — não é bloqueador pra nada que envolva
> a 7ª, e não deve ditar prazo nem prioridade de trabalho enquanto a 7ª não
> estiver pronta. Retomar a 94ª como tarefa própria, não como item que puxa
> os demais.
- **Data de carga e lacre da 7ª Zona** (`data_dx_ini`) nula — não há padrão
  legal, é decisão do cartório.
- **Segredos do Hermes** (`HERMES_SECRET_ZONA_7/94`) na Vercel e no Hermes.
- **Testar em campo**: um QR real com PIN e a legibilidade física dos cartões.
- **Detecção de eventos de seção (`eventos.js`) só propõe, não grava**
  (`enc`, `zeresima`, `panico_*`, `urna`, `midia_pronta`, `mesa_completa` — o
  domínio de dia D). Regex + fallback IA identificam e mandam pro Telegram
  pra validação humana, mas nada chama `/api/hermes-update` — decisão
  deliberada (modo proposta), não escrever automaticamente sem medir taxa de
  acerto primeiro. Sem isso, "seção 63 encerrada" dito no grupo continua
  exigindo lançamento manual no Admin ou por telefone.
- **Escalonamento por papel — lado SIME pronto, lado Hermes falta ligar**: a
  fila de notificações drenada ainda manda pra todos os `ADMIN_NUMBERS` do
  Hermes, independente do nível. `sime_usuarios.telefone_whatsapp` (coluna
  nova) + `/api/hermes-contatos` (`acao=listar`) já resolvem "quem é o Gestor
  de Problemas/Chefe de Cartório desta zona" — o admin cadastra o próprio
  WhatsApp na aba Equipe do `SIME_admin.html` (campo só aparece pros dois
  perfis certos). Falta só `index.js` no Pi somar esses números aos
  `ADMIN_NUMBERS` conforme `idade_s` — ver `SIME_hermes_skill_escalonamento.md`
  no repositório `bernardobbs/hermes`.
  94ª Zona também zerada aqui (ninguém cadastrou telefone ainda).
- **Autoatendimento por telefone ("oi" → função + seção) não está ligado no
  Hermes** — o endpoint (`/api/hermes-mesarios acao=consultar`) existe e
  funciona, mas nada no `index.js` o chama ainda. Busca por **nome**
  (`acao=buscar_nome`) também existe no endpoint, mas o gatilho automático
  no WhatsApp (qualquer DM não reconhecida como comando, com 2+ palavras,
  era tratada como nome de convocação) foi **suprimido em 06/08/2026** —
  disparava em cima de conversa comum ("Bom dia", "É Bernardo do cartório")
  e respondia "não encontrei ninguém chamado <frase>" pra qualquer coisa que
  não fosse um comando, confundindo quem mandava mensagem normal pro número
  (flagrado em campo). `buscarConvocacaoPorNome` continua disponível em
  `modules/whatsapp/confirmacao.js`, só não é mais acionado automaticamente.
- **Canal de DM (individual) restrito a `ADMIN_NUMBERS`, desde 06/08/2026**
  — mesmo incidente do item acima. Antes, `status` e `fila` respondiam a
  qualquer remetente; agora todo o `modules/whatsapp/comandos.js` retorna
  sem responder nada pra quem não está na lista (nem "sem permissão" — só a
  DM chegando, sem nenhuma resposta visível). Toda DM é logada no `pm2 logs`
  (nunca no WhatsApp) pra ainda dar pra achar um admin legítimo bloqueado
  por JID `@lid` fora da lista.
- **94ª Zona sem instância de Hermes**: só a 7ª tem o Raspberry Pi rodando. O
  Pi já tem `HERMES_BACKUP_ATIVO` configurado (dois números de WhatsApp), mas
  isso hoje é redundância de **sessão** pra 7ª — os dois números compartilham
  o mesmo `HERMES_SECRET`, não dá cobertura à 94ª por si só. Fazer os dois
  números monitorarem grupos das duas zonas é mudança de arquitetura maior
  (grupo→zona, Bearer por zona, filas por zona) — patch consolidado pronto
  pra aplicar em `PATCH_CONSOLIDADO_2026-08-08.md` (repositório
  `bernardobbs/hermes`, junto com
  autoatendimento e escalonamento, numa sequência só), com o trade-off
  explícito: junta o raio de impacto de uma queda do Pi inteiro nas duas
  zonas (a redundância só
  cobre a sessão do WhatsApp cair, não o Pi cair).
- **JID `@lid` do Baileys**: quando o WhatsApp identifica o remetente por um ID
  interno em vez do telefone, o Hermes não consegue casar com `sime_atores` —
  bloqueia confirmação automática para essas mensagens. Medir a frequência.
- **Ponto único de falha do Hermes**: Pi 3B doméstico, Wi-Fi, sem redundância —
  se cair no dia da eleição, não há monitoramento por WhatsApp (a fila offline
  do SIME em si continua funcionando). Só existe um Raspberry Pi disponível,
  então não há como mitigar a queda do Pi em si — isso continua ponto único
  de falha real, sem solução. Mitigação parcial disponível desde 05/08, e
  restrita a um recorte menor do problema: `services/papel.js` +
  `core/bootstrap.js` permitem um **segundo número de WhatsApp no mesmo Pi**
  (`HERMES_BACKUP_ATIVO=true`, dois sockets Baileys no mesmo processo, cada
  um com sua pasta de sessão) assumir a **monitoria de grupo** quando o
  socket principal desconecta — decisão local e instantânea, não depende de
  rede. Cobre a sessão do WhatsApp cair sozinha (deslogado, banido, chave
  corrompida); **não cobre o Pi cair** (energia, Wi-Fi, SD, processo
  travado), já que os dois números são o mesmo processo/hardware. Também não
  cobre fila de pânico nem disparo em massa, que continuam só no principal
  mesmo com o backup ativo (decisão deliberada, ver `HERMES_RUNTIME.md` no
  repositório `bernardobbs/hermes`).
  Não ligado por padrão: exige um segundo número de WhatsApp + esse número
  adicionado manualmente em cada grupo monitorado.

---

## HERMES AGENT

### Gestão do Hermes (versão + heartbeat) — `sql/SIME_hermes_gestao_schema.sql` + `/api/hermes-heartbeat`

Primeiro passo da "Proposta de Evolução do Hermes Agent": dar ao SIME
visibilidade e controle remoto sobre o Hermes, sem reescrever o runtime
inteiro ainda.

- `sime_componentes` (por zona): `versao_instalada`/`commit_instalado`
  (o que o Hermes reportou), `versao_desejada`/`atualizar_agora` (o que o
  admin pediu). SIME nunca empurra comando — o mesmo problema de NAT de
  sempre — então pedir atualização é só marcar a linha; o Hermes decide se
  atende no próprio ciclo.
- `sime_heartbeat` (por zona): pulso de vida + telemetria (versão, uptime,
  CPU/RAM/temperatura, disco, status WhatsApp/Telegram, última sincronização).
  "Online" é derivado no cliente (heartbeat < 5 min), não guardado.
- **Via endpoint, não Supabase direto** — `/api/hermes-heartbeat`
  (`enviar`/`confirmar_atualizacao`/`erro_atualizacao`, ver
  `SIME_hermes_skill_heartbeat.md` no repositório `bernardobbs/hermes`),
  mesmo Bearer por zona dos demais.
  `index.js` não fala mais com o Supabase direto desde 03/08/2026 (ver
  `HERMES_RUNTIME.md` no repositório `bernardobbs/hermes`), então esta é a
  única gravação válida — nada de
  service key no Hermes pra estas tabelas.
- Aba "🤖 Hermes" no Admin (`SIME_admin.html`) **lê as tabelas direto** (RLS
  por zona) — isso é o padrão normal do SIME, o frontend sempre fala com o
  Supabase com a anon key; só o Hermes é que passa por endpoint. Tem o botão
  "Solicitar atualização", que faz upsert com `atualizar_agora=true` +
  `versao_desejada`. Realtime em `sime_heartbeat` (`subscribeHeartbeat` em
  `sime_realtime.js`) atualiza a tela sozinha.
- **Não automatizar a aplicação da atualização perto da eleição** (04/10) —
  o botão do Admin só marca o pedido; o próprio skill doc já registra isso
  como critério deliberado, não esquecimento.
- **Em produção desde 06/08/2026** — o Hermes da 7ª Zona chama o endpoint a
  cada ciclo (`services/telemetria.js`) e recebe `200`. Causa raiz de um 401
  e depois um 400 (`Zona não encontrada`) que bloquearam isso por um tempo:
  duas env vars do Vercel (`HERMES_SECRET_ZONA_7`, depois
  `SUPABASE_SERVICE_ROLE_KEY`) tinham valor vazio/errado apesar de aparecerem
  "configuradas" no painel — editar não persistia o novo valor; só deletar e
  recriar a variável resolveu as duas vezes.

### Skills instaladas
- `sime_monitor` — detecta 12 tipos de evento em linguagem natural
- `sime_notificar` — envia WhatsApp com 8 templates
- `sime_updater` — persiste eventos de seção via `/api/hermes-update` (só escrita)
- `sime_mesarios` — consulta mesários e registra confirmação de permanência na
  função via `/api/hermes-mesarios` (leitura + autoatendimento + `sime_atores.confirmacao`)
- `sime_campanha` — drena a fila de disparo em massa via `/api/hermes-campanhas`
  (leitura + `sime_campanhas_confirmacao.status`)
- `sime_heartbeat` — reporta telemetria e verifica pedido de atualização via
  `/api/hermes-heartbeat` (escrita em `sime_heartbeat`/`sime_componentes`)
- `sime_escalonamento` — resolve telefone de Gestor de Problemas/Chefe de
  Cartório via `/api/hermes-contatos` (só leitura) — **proposta, endpoint
  pronto mas ainda não chamado pelo `index.js`**

> As skills acima descrevem o **contrato de dados** com o SIME (schema dos
> endpoints, templates), não um agente de IA com skills de verdade — a
> instância da 7ª Zona é um app Node.js + Baileys sob medida num Raspberry
> Pi, documentado em `HERMES_RUNTIME.md` (não o CLI genérico que `setup.sh`
> instala — ambos no repositório `bernardobbs/hermes`). Regex cobre a maior
> parte da detecção; Gemini
> só entra como fallback nos casos que o regex não resolve. Estado de cada
> contrato, desde 03/08/2026:
>
> | Skill | Estado real no Pi |
> |---|---|
> | `sime_mesarios` | confirmação/recusa em PRIMEIRA pessoa grava via `/api/hermes-mesarios`, em grupo monitorado (`modules/whatsapp/confirmacao.js`) e por autoidentificação espontânea em DM (`modules/campanhas/autoidentificacao.js`, frases fixas tipo "sou mesário" → `consultar`); gatilho automático de busca por nome livre (`buscar_nome`) continua suprimido desde 06/08/2026 (disparava em cima de conversa comum). **Relato de TERCEIRO (21/08/2026, `modules/whatsapp/relatoTerceiro.js`)** — novo: monitora grupo E DM por alguém reportando a situação de um COLEGA nomeado (não de si mesmo); nunca confirma sozinho, só marca "precisa confirmar" via `relatar_terceiro` (ver acima). Esta linha documentava o estado de 03/08/2026 e ficou desatualizada em relação ao runtime real — corrigida em 21/08/2026 ao investigar este pedido. |
> | `sime_notificar` | fila de pânico drenada e enviada automaticamente (`/api/hermes-notificacoes`) |
> | `sime_campanha` | disparo em massa funcionando (`/api/hermes-campanhas`), com `pausar envio`/`retomar envio`/`fila` por WhatsApp — **desligado por padrão** (`DISPATCH_ATIVO=false`) |
> | `sime_monitor` / `sime_updater` | `eventos.js` detecta (regex + fallback IA) e propõe no Telegram — **modo proposta deliberado, não grava** via `/api/hermes-update` |
> | `sime_heartbeat` | reportando telemetria em produção desde 06/08/2026, `200` a cada ciclo |
> | `sime_escalonamento` | endpoint (`/api/hermes-contatos`) pronto em produção desde 08/08/2026; `index.js` ainda não o chama |
>
> A 94ª Zona ainda não tem instância nenhuma.

### Disparo em massa (`SIME_atores.html` → aba "📢 Disparo em massa")

O SIME popula `sime_campanhas_confirmacao` (telefone, `ator_id`, `zona_id`,
`mensagem_enviada`, `status='pendente'`); o Hermes é quem lê essa fila (via
`/api/hermes-campanhas`, mesmo padrão pendentes/confirmar/erro de
`hermes-notificacoes`) e envia, respeitando 5 msgs/min. A zona vem do usuário
logado (`zonaDoUsuario()`), nunca de campo na tela. Tem um modelo pronto de
alerta anti-golpe e um modo de mensagem livre; filtro por função decide quem
recebe (default: todos os ativos com telefone).

**O envio de fato depende do Hermes estar com `DISPATCH_ATIVO=true`** — isso é
decisão de quem opera o Raspberry Pi, fora deste repo. Popular a fila não
garante que a mensagem saia.

Ainda não implementado: capturar a resposta de quem recebeu a campanha
(`sime_campanhas_confirmacao.resposta_recebida`/`decisao_detectada`) — hoje
uma resposta cai no fluxo de sempre (`sime_mesarios` confirmar/recusar/
substituir/atualizar), não fica associada à campanha específica que a gerou.

**Bug real corrigido em 22/08/2026 — imagem do disparo nunca chegava pra
quem usava "🧩 Usar script salvo".** O campo "Imagem" da tela de Disparo em
massa aparecia igual pros 3 modelos (golpe/livre/script), mas
`api/hermes-campanhas.js` só repassava `imagem_url` quando
`proxima_acao='enviar'` (fluxo simples) — nunca pra
`enviar_etapa_script`/`reenviar_etapa_script`. O cartório digitava a URL,
disparava um script, e a imagem simplesmente não saía, sem erro nenhum.

Corrigido construindo suporte de verdade, não só repassando o campo:
imagem passou a pertencer à **ETAPA** (`sime_campanha_etapas.imagem_url`,
`sql/SIME_campanha_etapas_imagem.sql`), não à linha de fila — cada etapa do
script pode ter a sua própria imagem, inclusive etapas seguintes (2, 3...),
não só a primeira. Consequências:
- O campo "Imagem" do Disparo em massa (`SIME_atores.html`) deixa de
  aparecer pro modelo "🧩 Usar script salvo" — a prévia da etapa 1 mostra a
  imagem dela (só leitura) quando existe. Editar imagem de qualquer etapa é
  só no editor de script (aba 🧩 Campanhas,
  `modules/sime_campanha_script_editor.js`), junto da mensagem da etapa.
- `api/hermes-campanhas.js`: `pendentes` resolve `imagem_url` da etapa
  certa (busca em lote por `campanha_id:etapa_numero`, tanto pro primeiro
  envio quanto pro reenvio — reenvio usa a etapa ATUAL, nunca a etapa 1
  congelada); `avancar_etapa` devolve `proxima_imagem_url` junto de
  `proxima_mensagem` ao avançar pra próxima etapa.
- Lado Hermes (`bernardobbs/hermes`, `src/modules/campanhas/dispatch.js` e
  `script.js`): quando há `imagem_url`/`proxima_imagem_url`, manda
  `sock.sendMessage` com `image: {url}` + `caption`; sem imagem, continua
  mandando só texto, igual sempre.

Coberto por `tests/test_hermes_campanhas_script.mjs` (primeiro envio,
reenvio na mesma etapa, reenvio já avançado pra etapa sem imagem própria —
pra garantir que não herda a de outra etapa —, e `avancar_etapa` terminal
vs. não-terminal com/sem imagem no destino).

### Como o Hermes recebe as notificações (SIME → Hermes)

O Hermes roda atrás de NAT (Raspberry Pi em rede doméstica), sem endereço
público — o Supabase não consegue chamá-lo. Então **o Hermes é quem
pergunta**, a cada ~30s:

```
POST /api/hermes-notificacoes  { "acao": "pendentes" }   → fila da zona
POST /api/hermes-notificacoes  { "acao": "confirmar", "ids": [...] }
POST /api/hermes-notificacoes  { "acao": "erro", "ids": [...], "erro_msg": "..." }
```

O gatilho de pânico/mídia **enfileira** em `sime_notificacoes`; o POST direto
para o Hermes virou aceleração opcional, só quando `app.hermes_url` existe.
Cada notificação traz `idade_s` (relógio do servidor) — é com ela que o Hermes
decide o nível de escalonamento, sem depender do horário do PC.

A fila de disparo em massa segue o mesmo formato, endpoint próprio:
```
POST /api/hermes-campanhas  { "acao": "pendentes" }   → fila da zona
POST /api/hermes-campanhas  { "acao": "confirmar", "ids": [...], "whatsapp_existe"?: bool }
POST /api/hermes-campanhas  { "acao": "erro", "ids": [...], "erro_msg": "...", "whatsapp_existe"?: bool }
```
Item sem `mensagem_enviada` preenchida já não aparece em `pendentes` — evita o
Hermes gastar um ciclo só para dar erro num item vazio.

Atraso: até um ciclo. Para um pânico que escala em 10 min, irrelevante.

### Fluxo de atualização via WhatsApp
```
Mesário: "seção 63 encerrada"
  → Hermes detecta: secao=63, evento=enc
  → Hermes: "Seção 63 — Encerrada. Confirmar? (S/N)"
  → Coordenador: "S"
  → POST /api/hermes-update → Supabase → Realtime → TV Dia
  → Hermes: "✅ SIME atualizado — Seção 63: encerrada às 17:23"

Pânico: sem confirmação — atualiza imediatamente
```

### Endpoint Vercel
```
POST /api/hermes-update
Authorization: Bearer HERMES_SECRET_ZONA_<numero>
Body: { secao, evento, valor, remetente, origem }

Eventos suportados:
  enc, vot, zeresima, fila, panico_energia, panico_urna,
  panico_resolvido, urna, midia_pronta, mesa_completa
```

### Endpoint Vercel — mesários (leitura + autoatendimento + confirmação)
```
POST /api/hermes-mesarios
Authorization: Bearer HERMES_SECRET_ZONA_<numero>
Body: { acao, secao?, status?, telefone?, mensagem?, nome?, telefone_relator?, origem? }

Ações:
  listar                           → lista mesários + apoio logístico da zona (nome, telefone, seção, status)
  consultar                        → autoatendimento: telefone → função + seção (se MRV), pronto pra WhatsApp
  buscar_nome                      → autoatendimento por nome (substring), pra quem não manda do próprio telefone
  atualizar                        → anexa recado livre da PRÓPRIA pessoa em observacao (por telefone dela)
  relatar_terceiro                 → outro mesário reporta a situação de um COLEGA nomeado (por nome, não telefone)
  confirmar | recusar | substituir → grava sime_atores.confirmacao (por telefone)
```

`consultar` é o que responde quando alguém da base manda "oi" pela primeira
vez: acha pelo telefone (mesma pessoa pode ter 2 convocações — mesário E apoio
logístico), devolve `mensagem_wa` já pronta com a função e, sendo MRV, a seção
(número/local/município, via `secao_id`). Termina convidando a mandar correção,
que vai pra `atualizar` — ver `SIME_hermes_skill_mesarios.md` no
repositório `bernardobbs/hermes`.

**`relatar_terceiro` (21/08/2026)** — pedido direto: "o hermes agente deve
ficar monitorando as mensagens do grupo e dm que chegarem para poder
atualizar os contatos. indicar que foi atualização vinda de mesários e
precisa confirmar." Diferente de `atualizar`/`confirmar`/`recusar`/
`substituir` (sempre a PRÓPRIA pessoa, identificada pelo `telefone` dela),
aqui quem manda a mensagem (`telefone_relator`) reporta sobre OUTRA pessoa,
identificada por `nome` (substring, mesmo critério de `buscar_nome` — quem
relata raramente sabe o telefone cadastrado do colega). Por isso **nunca
muda `confirmacao=`** — só anexa em `observacao` um carimbo com a origem
(grupo/DM), o telefone de quem relatou e a marca **"PRECISA CONFIRMAR COM A
PESSOA"**, pro cartório verificar antes de agir (segundo-mão errado é pior
que não registrar). Ambíguo (2+ pessoas distintas batendo no nome) devolve
`409` sem gravar em ninguém — não adivinha qual. `sime_contatar_mesarios.js`
(`CM_LOG_HERMES_LABEL.hermes_relato_terceiro`) mostra esse log na aba
"📜 Atualizações" do modal com rótulo próprio ("⚠️ Relato de terceiro... —
PRECISA CONFIRMAR"), distinto de um recado da própria pessoa. Lado Hermes:
`modules/whatsapp/relatoTerceiro.js` (repositório `bernardobbs/hermes`) —
pré-filtro por palavras-gatilho ("não vai poder", "avisa que", "pediu pra
avisar" etc.) antes de gastar cota de IA, IA extrai nome+status, chamado em
paralelo tanto no roteamento de GRUPO quanto de DM (`modules/whatsapp/router.js`).

**`atualizar_telefone_terceiro` (21/08/2026)** — pedido direto depois que o
cartório testou encaminhar contatos de mesário (nome + telefone) pro
WhatsApp do Hermes esperando que isso atualizasse algo: hoje não atualizava
nada. Diferente de `relatar_terceiro` (que é sobre a SITUAÇÃO da pessoa e
nunca grava telefone): aqui o dado **é** um telefone. Casa por nome (mesmo
critério de `buscar_nome`/`relatar_terceiro`) e só grava automaticamente
quando bate em EXATAMENTE 1 pessoa — grava só em `telefone_alternativo`,
**nunca** em `telefone_whatsapp` (o que Hermes/campanha usam por padrão),
então nem um nome batendo errado sobrescreveria o telefone principal. Nome
ambíguo (409) ou não encontrado (404) não adivinha; telefone fora do
formato reconhecível (422, mesmo critério de aceitação de "colar lista" —
8/9/10/11/12-13-com-55 dígitos) também não grava. Lado Hermes:
`modules/whatsapp/atualizarContatoTerceiro.js` — sem IA, cobre DUAS formas
de chegar: (1) texto colado/digitado, reconhecido só por FORMATO (mensagem
de exatamente 2 linhas: nome na primeira, telefone na segunda), removendo
saudação da frente do nome se tiver ("Boa noite, Fulano" → "Fulano"); e (2)
**contato COMPARTILHADO de verdade** (`contactMessage`/`contactsArrayMessage`
do Baileys, adicionado no mesmo dia ao testar em campo e descobrir que um
cartão de contato de verdade — diferente de texto colado — não tem `text`
nenhum pro roteador extrair, precisando de um caminho próprio): usa o
`displayName` do cartão como nome e extrai o telefone do `vcard` (prioriza
o parâmetro `waid=`, já no formato do WhatsApp; cai pro número escrito
depois do `:` da linha `TEL` só se `waid=` não existir). Um cartão sem
telefone reconhecível no vCard é ignorado. Roda em paralelo com
`relatoTerceiro.js` tanto em grupo quanto em DM — não conflitam, porque o
pré-filtro de cada um é mutuamente exclusivo (um exige frase de status, o
outro exige formato de contato/vCard). Como já usa `telefone_alternativo`,
o campo aparece automaticamente na lista de telefones do modal de
"Contatar mesários" (`cmListaTelefones`) — nenhuma UI nova foi necessária
do lado SIME.

**Bug real corrigido em 22/08/2026, só lado Hermes — aviso do Telegram sem
contexto.** Um aviso real em produção chegou só como "não achei 'Daluz 🌝'
no SIME / Origem: DM", sem dizer quem mandou nem qual telefone estava em
jogo — o cartório não tinha nada pra agir. Toda mensagem do módulo
(ambíguo, não encontrado, telefone irreconhecível, falha de rede, sucesso,
e a sugestão de correção) agora sempre mostra o telefone do contato **e**
o telefone de quem mandou a mensagem no WhatsApp.

**Correção depois de um contato vira SUGESTÃO no Telegram, nunca gravação
automática (21/08/2026, só lado Hermes — nenhuma mudança no SIME).** Achado
em campo: depois de compartilhar um contato, é comum vir uma frase solta
esclarecendo o nome ("Esse é da Esther Mariele", "Vaniele Honório de
Carvalho 👆") — texto livre demais pra gravar sozinho com segurança.
`atualizarContatoTerceiro.sugerirSeReferenciaContato()` (repositório
`bernardobbs/hermes`) detecta isso (reply formal ao cartão, ou frase
deítica — "esse é"/emoji apontando — logo depois de um cartão no mesmo
chat, cache de 10 min) e manda só um aviso no Telegram com o contato
original + a frase, pro cartório decidir se atualiza manualmente pelo SIME
(nenhum endpoint novo — usa a mesma tela de sempre).

**Flag `tem_relato_terceiro_pendente` (21/08/2026, `sql/
SIME_atores_relato_terceiro_pendente.sql`)** — achado real ao perguntar "como
saberei os relatos de terceiros": o carimbo em `observacao` já ficava
gravado, mas invisível a menos que o cartório abrisse o modal daquela pessoa
especificamente — não tinha como saber QUEM tem relato pendente sem olhar um
por um. Mesmo espírito de `precisa_substituir` (flag booleana própria,
independente de `confirmacao`, `default false`): `api/hermes-mesarios.js`
grava `tem_relato_terceiro_pendente=true` junto com o carimbo em
`observacao` quando `relatar_terceiro` encontra a pessoa (nas duas linhas,
se ela tiver mesário + apoio). Em `sime_contatar_mesarios.js`: badge
"⚠️ Relato de terceiro pendente" no card e na linha "Situação" do modal,
bucket próprio em `CM_BUCKETS` (`relato_terceiro_pendente`, filtro
independente de qualquer valor de `confirmacao`) e botão "✓ Marcar relato
como resolvido" (`cmResolverRelatoTerceiro`, card e modal) que só desmarca a
flag — nunca mexe em `confirmacao` nem apaga o carimbo já anexado em
`observacao` (fica como registro histórico de que o relato existiu e foi
checado), gravando `mesario_relato_terceiro_resolvido` em `sime_logs`. Uso
esperado: o cartório vê o badge, confirma com a PRÓPRIA pessoa (telefone,
WhatsApp, presencial) o que o terceiro relatou, e só então desmarca.

### Endpoint Vercel — contatos por papel (escalonamento)
```
POST /api/hermes-contatos
Authorization: Bearer HERMES_SECRET_ZONA_<numero>
Body: { acao: 'listar' }

→ { ok, zona, contatos: { gestor_prob: [telefones...], coordenador: [telefones...] } }
```
Só leitura — telefone vem de `sime_usuarios.telefone_whatsapp` (`ativo=true`),
cadastrado pelo admin na aba Equipe. Lista vazia = ninguém daquele perfil
cadastrou telefone ainda, não é erro. Contrato completo e como pluga no loop
de `sime_notificar`: `SIME_hermes_skill_escalonamento.md` no repositório
`bernardobbs/hermes`.

---

## CRONOGRAMA

| Semana | Período | Entrega |
|---|---|---|
| S1-S2 | 01-14 Jul | Supabase + Vercel + Oracle provisionados |
| S3-S4 | 15-28 Jul | Admin e Mesário migrados + Hermes conectado |
| S5-S6 | 29 Jul-11 Ago | TV Dia Realtime + Edge Functions |
| S7 | 12-18 Ago | Deploy final + QR Codes impressos |
| S8-S10 | 19 Ago-12 Set | Testes e simulação completa |
| S11-S13 | 13 Set-03 Out | Treinamento + materiais físicos |
| **04 Out** | **ELEIÇÃO** | **Go-live** |

---

## PLANO DE CONTINGÊNCIA

O SIME é **auxiliar/informativo** — nenhum processo oficial da Justiça
Eleitoral depende dele. Não há "modo pendrive" nem fallback de sistema: ou ele
está no ar, ou não está. A única contingência real é a fila offline, que
garante que a **ação de um operador** não se perde enquanto a rede volta.

| Falha | Resposta |
|---|---|
| Supabase fora do ar | Fila offline (IndexedDB) assume automaticamente; a ação sincroniza quando a rede voltar |
| Vercel/Supabase indisponíveis juntos | O painel consolidado simplesmente para — sem impacto na eleição oficial. A operação segue por WhatsApp/telefone, como era antes do SIME |
| Hermes cai | Operação continua; as notificações ficam na fila (`sime_notificacoes`) e saem quando ele voltar |
| Celular do mesário sem bateria | Qualquer agente confirma pelo Admin |
| QR Code ilegível | PIN de 4 dígitos no verso do cartão |

