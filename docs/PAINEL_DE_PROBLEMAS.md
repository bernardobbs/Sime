# Painel de Problemas — projeto

Transformar a tela de problemas de um **aviso** em um **fluxo de trabalho**:
alguém assume, encaminha, contata quem está no local, resolve — e, se demorar,
o sistema escala sozinho.

> Projetado em 28/07/2026, a partir do uso real do painel. Os números deste
> documento vêm do Supabase de produção, não de estimativa.
>
> **Estado: implementado** em `modules/SIME_problemas.html` e
> `sql/SIME_ocorrencias.sql`. O que falta é cadastro, não código — ver §5.

---

## 0. A regra que organiza a tela

**O contato oferecido é função do tipo do problema.** Foi a definição do
cartório, e é o que separa esta tela de uma lista de telefones:

| Problema | Quem resolve |
|---|---|
| ⚡ Faltou luz | **Equatorial** |
| 🖥️ Urna com problema | **Auxiliar de eleição** — contratado do TRE que faz manutenção de urna |
| 👥 Faltou mesário | **A própria mesa** (Presidente primeiro) |
| ♿ Acessibilidade | **Coord. de acessibilidade** do local |

O primeiro da lista vem destacado em verde — é quem acionar primeiro. Os
demais ficam abaixo, porque na prática o primeiro às vezes não atende.

---

## 1. O que existe hoje

Um "problema" **não é um registro**. É uma leitura derivada de booleanos em
`sime_mesa_estado`, recalculada a cada 5s:

| Tipo | De onde vem |
|---|---|
| ⚡ Falta de energia | `panico_energia AND NOT panico_energia_resolvido` |
| 🖥️ Problema na urna | `panico_urna AND NOT panico_urna_resolvido` |
| ⏱ Votação não iniciada | calculado: passou do horário e `NOT votacao` |
| 👥 Mesa incompleta | calculado: menos de 4 membros após o limite |
| 🔧 Problema na instalação | `problema_instalacao` (véspera) |

Consequência direta: **não há onde escrever quem assumiu.** Um booleano não
tem dono, não tem histórico e não tem relógio próprio. É por isso que o
escalonamento previsto no `CLAUDE.md` (10 min → Gestor, 30 min → Chefe) hoje
só existe como regra escrita para o Hermes seguir, e não como estado que
alguém possa ver na tela.

**Esta é a mudança central do projeto:** promover o problema a registro.

---

## 2. Decisão de arquitetura — onde cada coisa acontece

O pedido fala em "clicar no problema e indicar que vai resolver". Vale separar
duas telas que hoje se parecem:

| | TV Dia / TV Véspera | Admin |
|---|---|---|
| Onde roda | Telão na parede, TV Box | Celular e PC de quem está operando |
| Entrada | Nenhuma (o app de TV só tem D-pad) | Toque e teclado |
| Papel no fluxo | **Mostra** quem assumiu e há quanto tempo | **É onde se assume, encaminha e resolve** |

Projetar a atribuição na TV seria projetar para um aparelho que ninguém opera —
o `docs/APP_TV_BOX.md` fixou "sem interação" como premissa do telão, e o
controle remoto está numa gaveta.

**Então:** o fluxo de trabalho vive em `SIME_admin.html`; as TVs ganham apenas
a marca visual de que o problema **já tem dono** — que é o que falta hoje para
duas pessoas não ligarem para a mesma seção ao mesmo tempo.

---

## 3. `sime_ocorrencias` — o problema como registro

```sql
CREATE TABLE IF NOT EXISTS sime_ocorrencias (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id       UUID NOT NULL REFERENCES sime_zonas(id),
  eleicao_id    UUID REFERENCES sime_eleicoes(id),
  secao_id      UUID REFERENCES sime_secoes(id),

  tipo          TEXT NOT NULL,      -- energia | urna | instalacao | votacao_atrasada | mesa_incompleta | outro
  origem        TEXT NOT NULL,      -- mesario | acessibilidade | instalador | hermes | admin
  descricao     TEXT,

  -- Ciclo de vida
  status        TEXT NOT NULL DEFAULT 'aberta'
                CHECK (status IN ('aberta','assumida','encaminhada','resolvida','cancelada')),
  responsavel_id UUID REFERENCES sime_usuarios(id),   -- quem está com ela agora
  encaminhada_por UUID REFERENCES sime_usuarios(id),

  -- Relógio (sempre do servidor — nunca do aparelho)
  aberta_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assumida_em   TIMESTAMPTZ,
  resolvida_em  TIMESTAMPTZ,
  resolvida_por UUID REFERENCES sime_usuarios(id),
  resolucao     TEXT,

  -- Escalonamento
  nivel_escalonamento SMALLINT NOT NULL DEFAULT 0,   -- 0 nenhum · 1 gestor · 2 chefe
  escalonada_em TIMESTAMPTZ,

  UNIQUE (secao_id, tipo, aberta_em)
);
CREATE INDEX ON sime_ocorrencias (zona_id, status);
CREATE INDEX ON sime_ocorrencias (responsavel_id) WHERE status IN ('assumida','encaminhada');
```

Mais `sime_ocorrencia_eventos` (append-only, mesmo espírito de `sime_logs`):
cada assumir / encaminhar / contatar / resolver vira uma linha, com autor e
timestamp de servidor. É o que permite responder depois "por que essa seção
levou 40 minutos".

### A regra que evita duas verdades

`sime_mesa_estado.panico_*` continua sendo **o que o campo diz**.
`sime_ocorrencias` é **o que o cartório está fazendo a respeito**. Não se
sobrepõem, e a direção é única:

```
campo aciona pânico → trigger abre a ocorrência (se não houver aberta)
campo resolve       → trigger fecha a ocorrência
cartório resolve    → RPC fecha a ocorrência E baixa o pânico na seção
```

Sem isso, teríamos um problema "resolvido" no Admin com o celular do mesário
ainda vermelho — exatamente o defeito que acabamos de corrigir no
`SIME_mesario.html`, reintroduzido pela porta dos fundos.

Fechar pelo cartório escreve via `sime_acao_mesa` com **apenas** os campos de
pânico preenchidos, que é o padrão que o mesário já usa: o RPC trata `NULL`
como "mantém", e o Realtime leva a resolução ao aparelho do mesário sozinho.

---

## 4. A tela

### 4.1 Lista — filtro por responsável

```
┌──────────────────────────────────────────────────────┐
│  ⚠ Problemas          [ Meus (2) ] [ Todos (7) ]     │
├──────────────────────────────────────────────────────┤
│ ⚡ Seção 63 · G.E. Treze de Março                     │
│    Falta de energia · aberta há 18 min                │
│    👤 Maria (assumiu há 12 min)          🔴 escalado  │
├──────────────────────────────────────────────────────┤
│ 🖥️ Seção 145 · CAIC                                   │
│    Problema na urna · aberta há 4 min                  │
│    — sem responsável —                    [ Assumir ] │
└──────────────────────────────────────────────────────┘
```

O par **Meus / Todos** é o pedido de filtro. Padrão sugerido: abre em **Todos**
para quem é `coordenador` ou `super_admin` (precisa da visão inteira) e em
**Meus** para os demais. "Sem responsável" aparece sempre nos dois — problema
órfão é o que não pode passar despercebido.

### 4.2 Detalhe — o que abre ao clicar

```
┌──────────────────────────────────────────────────────┐
│ ⚡ Seção 63 — Falta de energia                    [✕] │
│ G.E. Treze de Março · Campo Maior                     │
│ Aberta às 08:12 (há 18 min) · relatada pelo mesário   │
├──────────────────────────────────────────────────────┤
│ QUEM ESTÁ NO LOCAL                                    │
│  💬 Presidente · Ana Paula          (86) 99999-6666   │
│  💬 Coord. acessibilidade · João    (86) 98888-1111   │
│  💬 Auxiliar de eleição · Pedro     (86) 97777-2222   │
│  ⚡ Equatorial · Campo Maior              0800 ...    │
├──────────────────────────────────────────────────────┤
│ RESPONSÁVEL                                           │
│  👤 Maria Gomes — assumiu às 08:18                    │
│  [ Encaminhar para ▾ ]                                │
├──────────────────────────────────────────────────────┤
│ [ ✓ Marcar como resolvido ]        [ Assumir ]        │
└──────────────────────────────────────────────────────┘
```

Cada `💬` é o `wa.me` já com mensagem escrita — o mesmo `linkWhatsApp()` que as
TVs passaram a usar. Botão que não tem número **não aparece**, em vez de abrir
conversa vazia.

---

## 5. Os quatro contatos — e o que falta no cadastro

Aqui está a parte do pedido que **não é só tela**. Consultando a 7ª Zona:

| Contato | Como está hoje | Cobertura real |
|---|---|---|
| **Mesário** | `sime_atores`, ancorado em `secao_id` | 141 de 175 seções têm ao menos um com telefone |
| **Coord. de acessibilidade** | idem, ancorado em `secao_id` | 45 de 64 **locais** |
| **Auxiliar de eleição** | idem | **19 de 175 seções** |
| **Equatorial** | **não existe no banco** | 0 |

Três achados que mudam o trabalho:

**a) O coordenador de acessibilidade responde por um local, não por uma seção.**
O `CLAUDE.md` diz isso, mas o cadastro guarda `secao_id`. Buscar pelo
`secao_id` exato encontra o coordenador em 52 seções; buscar pelo **local**
(`zona_id` + `local_nome`, já que `sime_secoes` não tem `local_id`) alcança as
45 sedes e, com elas, a maioria das 175 seções. **É só mudar a busca — não
precisa recadastrar ninguém.**

**b) O auxiliar de eleição é o contratado do TRE que faz manutenção de urna** —
por isso ele, e não a Equatorial, é o primeiro contato quando a urna dá
problema. Ele cobre **várias seções**, mas o modelo só admite uma (`secao_id`);
por isso 21 auxiliares apareciam em 19 seções.

**Adotado:** buscar pelo **local**, igual ao item (a). Sem migração e sem
recadastro. A diferença para a solução "correta" — uma tabela
`sime_ator_secoes (ator_id, secao_id)` — só aparece se um auxiliar cobrir
seções de **locais diferentes**; se isso acontecer na prática, a migração é
pequena e fica para depois de outubro.

**c) A Equatorial não existe em lugar nenhum.** E o contato provavelmente não
é um só — a 7ª Zona abrange Campo Maior, Jatobá do Piauí e Sigefredo Pacheco,
e a 94ª outros quatro municípios. Proposta mínima:

```sql
CREATE TABLE IF NOT EXISTS sime_contatos_externos (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id    UUID NOT NULL REFERENCES sime_zonas(id),
  tipo       TEXT NOT NULL,        -- energia | telefonia | pm | bombeiros | prefeitura
  nome       TEXT NOT NULL,        -- 'Equatorial — plantão Campo Maior'
  municipio  TEXT,                 -- NULL = vale para a zona toda
  telefone   TEXT NOT NULL,
  whatsapp   BOOLEAN NOT NULL DEFAULT true,
  observacao TEXT,
  ativo      BOOLEAN NOT NULL DEFAULT true
);
```

Deliberadamente genérica: no dia da eleição a lista de "quem eu ligo" nunca é
só a concessionária de energia. Um telefone fixo entra com `whatsapp = false`
e o botão vira `tel:` em vez de `wa.me`.

**Onde se cadastra:** aba **☎️ Contatos externos** em `SIME_atores.html` — é
onde a equipe já procura telefone. Ficam em tabela própria, e não em
`sime_atores`, porque não são pessoas de uma seção: são organizações com
abrangência por município, e entrariam contando como "ator" nos números da
zona e nas campanhas de confirmação de mesário.

A zona vem do usuário logado, nunca de um campo na tela — cadastrar na zona
errada seria oferecer o telefone de outra comarca no dia D.

> **Isto é cadastro, não código.** Os números da Equatorial precisam vir do
> cartório — é a única parte deste projeto que não posso levantar sozinho.

---

## 6. Escalonamento automático

A regra já está no `CLAUDE.md` e **não muda**:

```
10 min sem resolução → Gestor de Problemas
30 min sem resolução → Chefe de Cartório
NUNCA escala para o juiz eleitoral
```

O que muda é que ela deixa de depender do Hermes estar de pé. Uma função
agendada (`pg_cron`, de minuto em minuto) percorre as ocorrências abertas,
sobe `nivel_escalonamento` e enfileira a notificação em `sime_notificacoes` —
a mesma fila que o Hermes já drena. Se o Hermes estiver fora, a fila espera; o
nível na tela sobe do mesmo jeito, e quem está no Admin vê o vermelho.

O "perfil superior" é resolvido pela hierarquia que já existe em
`sime_usuarios.perfil`:

```
monitor · gestor_dist · coord_* → gestor_prob → coordenador → super_admin
```

Se não houver ninguém com o perfil do próximo nível na zona, escala direto
para `coordenador`. Um escalonamento que não encontra destinatário e falha em
silêncio é pior que não ter escalonamento.

**Nota de projeto:** o relógio é `aberta_em`, não "assumida em". Assumir uma
ocorrência e não resolvê-la não deve parar o cronômetro — senão a forma mais
fácil de não ser escalado passa a ser clicar em "Assumir" e esquecer.

---

## 7. O que aparece nas TVs

Mudança pequena e de propósito — o telão não vira ferramenta de trabalho:

| Hoje | Passa a ser |
|---|---|
| `⚡ Seção 63 · desde 08:12` | `⚡ Seção 63 · desde 08:12 · 👤 Maria` |
| — | borda vermelha pulsando quando `nivel_escalonamento > 0` |
| — | contador "3 sem responsável" no topo |

O terceiro item é o mais útil dos três: é o número que faz alguém no cartório
levantar a cabeça.

---

## 8. Riscos

| Risco | Gravidade | Mitigação |
|---|---|---|
| **Duas verdades** (pânico na seção × status da ocorrência) | Alta | Direção única do §3; fechar pelo cartório passa pelo mesmo RPC do mesário |
| Contato da Equatorial não cadastrado até outubro | Alta | É cadastro; depende do cartório. O botão some se faltar — não quebra |
| Equipe pequena demais para "encaminhar" | Média | Hoje há **3 usuários reais** (2 coordenadores + 1 super admin). Encaminhar só faz sentido com a equipe cadastrada |
| Ocorrência órfã (aberta e ninguém viu) | Média | Filtro "Todos" mostra sem-responsável primeiro; contador na TV |
| `pg_cron` indisponível no plano | Baixa | Alternativa: o próprio Admin calcula o nível ao renderizar; a fila sai quando alguém tem a tela aberta |

O risco que eu destacaria não é técnico: **encaminhar pressupõe equipe.** Com
3 pessoas cadastradas, "assumir" e "resolver" já entregam quase todo o valor;
"encaminhar" só ganha sentido quando os monitores e gestores de problema
estiverem no `sime_usuarios`. Vale cadastrar antes de construir.

---

## 9. Esforço

| Etapa | Estimativa |
|---|---|
| `sime_ocorrencias` + eventos + triggers + RLS | 1 dia |
| Busca de contato por local (a) e `sime_contatos_externos` (c) | 0,5 dia |
| Tela de lista com filtro Meus/Todos | 1 dia |
| Detalhe: contatos, assumir, encaminhar, resolver | 1,5 dia |
| Escalonamento agendado + fila | 0,5 dia |
| Marca de responsável nas TVs | 0,5 dia |
| Testes (Playwright + RLS com 2 zonas) | 1 dia |
| **Total** | **~6 dias** |

---

## 10. Ordem sugerida

1. **`sime_ocorrencias` + assumir/resolver.** Já resolve o essencial: ninguém
   liga duas vezes para a mesma seção.
2. **Contatos** — a busca por local (a) é a de melhor retorno: transforma 52
   seções cobertas em quase todas, sem recadastrar nada.
3. **Escalonamento**, que só faz sentido depois que existe `aberta_em`.
4. **Encaminhar**, quando a equipe estiver cadastrada.
5. **Marca nas TVs**, por último — é reflexo do resto.

O item 2 vale ser feito mesmo que o resto espere: melhora o botão de contato
que as TVs **já têm hoje**, sem depender de nenhuma tabela nova.
