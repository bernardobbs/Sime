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
abas lá dentro) → aba **🔄 Sincronizar** tem DOIS uploads separados
(`sime_mesarios_sync.js`), pra dois arquivos que o cartório recebe
separadamente e com propósitos diferentes:

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

`SIME_convocacao.html` tem mais três abas:
- **📊 Dashboard** (`sime_resumo_secoes.js`, redesenhado em 20/08/2026 a
  partir de um mockup do cartório) — 4 cards de estatística no topo (locais
  de votação, seções, mesários, apoio logístico) e, abaixo, cards por
  **local de votação** (`sime_secoes` não tem id próprio de "local" nem
  endereço — o agrupamento é por `local_nome`+`municipio`, sem rua/povoado)
  com barra de progresso (cargos designados/total), busca por nome e
  alternância grade/lista. Clicar num local abre o **drilldown por seção**:
  um card por seção com o nº de eleitores, os 4 cargos de mesa
  (❌ sem designação / 🔶 aguardando confirmação / ⚠️ recusou ou contato
  incorreto / 🔁 precisa ser substituído / ✅ confirmado) **com o nome de
  quem está designado** em cada cargo (20/08/2026 — antes só mostrava o
  ícone, sem dizer quem é a pessoa) e a data da última confirmação.

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

  **Histórico não cobre tudo, de propósito.** `hermes_confirmou_mesario` e
  `hermes_atualizou_info` (gravados por `api/hermes-mesarios.js` quando o
  próprio mesário responde no WhatsApp) guardam `afetados` como lista de
  nome/seção, sem `ator_id` — casar isso com uma pessoa exigiria comparação
  fuzzy por nome, o que é pior que não mostrar. Ficou de fora da lista
  "Atualizações" por decisão, não esquecimento; o status atual
  (confirmado/recusou/etc.) já aparece no badge do card, só o histórico
  detalhado dessas trocas que não está no modal ainda.

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
- **📜 Histórico** (`sime_historico_sync.js`) — últimas sincronizações
  (`sime_logs` com `acao='mesarios_sync_csv'`): quando, quantos registros,
  quantos atualizados/inativados.

> **Landing padrão do site (20/08/2026)**: `vercel.json` redireciona `/`
> pra `SIME_principal.html?tab=modulos` (antes ia direto pro Admin) —
> qualquer um que loga cai no hub de módulos, não numa página específica.
> `?tab=<nome>` é genérico (`abrirAbaDaUrl()`), não só pra `modulos`.
>
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
histórico de notificações) e nunca toca `confirmacao`/`status_convocacao`/
`whatsapp_*`. Quem sai da nova exportação vira `ativo=false`, não é apagado.
Casa o local de trabalho por `lower(municipio)` (não `initcap()` — corrigido
em 20/08/2026: `initcap('JATOBÁ DO PIAUÍ')` capitaliza o conectivo "Do", que
não bate com `sime_secoes.municipio='Jatobá do Piauí'` gravado em minúsculo;
o join nunca casava pra esse município e ~120 mesários de lá entravam sem
`secao_id`).

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
> | `sime_mesarios` | confirmação/recusa grava via `/api/hermes-mesarios`; gatilho automático de busca por nome (`buscar_nome`) suprimido em 06/08/2026 (disparava em cima de conversa comum); autoatendimento por telefone (`consultar`, alguém manda "oi") não está ligado |
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
Body: { acao, secao?, status?, telefone?, mensagem? }

Ações:
  listar                           → lista mesários + apoio logístico da zona (nome, telefone, seção, status)
  consultar                        → autoatendimento: telefone → função + seção (se MRV), pronto pra WhatsApp
  atualizar                        → anexa recado livre da pessoa em observacao (nunca sobrescreve dado do TRE)
  confirmar | recusar | substituir → grava sime_atores.confirmacao (por telefone)
```

`consultar` é o que responde quando alguém da base manda "oi" pela primeira
vez: acha pelo telefone (mesma pessoa pode ter 2 convocações — mesário E apoio
logístico), devolve `mensagem_wa` já pronta com a função e, sendo MRV, a seção
(número/local/município, via `secao_id`). Termina convidando a mandar correção,
que vai pra `atualizar` — ver `SIME_hermes_skill_mesarios.md` no
repositório `bernardobbs/hermes`.

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

