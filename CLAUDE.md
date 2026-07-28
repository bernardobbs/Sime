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
- IA + WhatsApp: Hermes Agent (PC do cartório — sem túnel, ver hermes/README.md)
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
> o Hermes consulta — que é o modo correto. Ver `hermes/README.md`.

---

## ESTRUTURA DE ARQUIVOS

```
/
├── CLAUDE.md                          ← Este arquivo
├── modules/                           ← 16 módulos HTML
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
│   ├── SIME_principal.html               Todos
│   ├── SIME_tokens.html                  Pré-eleição
│   └── SIME_paineis.html                 Todos
├── api/
│   ├── hermes-update.js               ← escrita de eventos de seção
│   ├── hermes-mesarios.js             ← leitura + confirmação de mesários
│   └── hermes-notificacoes.js         ← fila que o Hermes consulta (SIME → Hermes)
├── sql/
│   ├── SIME_schema.sql                ← Schema principal
│   ├── SIME_whatsapp_schema.sql       ← Notificações WhatsApp
│   └── SIME_hermes_trigger.sql        ← Triggers para o Hermes
├── hermes/
│   ├── README.md                      ← Configuração (Linux e Windows)
│   ├── SIME_hermes_skill_monitor.md   ← Skill: monitora grupos
│   ├── SIME_hermes_skill_notificar.md ← Skill: drena a fila e envia WhatsApp
│   ├── SIME_hermes_skill_updater.md   ← Skill: persiste no Supabase
│   ├── SIME_hermes_skill_mesarios.md  ← Skill: confirma mesários
│   └── setup.sh                       ← Instalação (ZONA=7 bash setup.sh)
└── docs/
    ├── descricao_completa.md
    ├── plano_implementacao.md
    └── prompt_chatgpt.md
```

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
| **Coordenador de Preparação** | SIME_coordenador_preparacao | D-X | Todas as seções |
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

### Autônomo
| Papel | Tecnologia | Função |
|---|---|---|
| **Hermes Agent** | IA (PC do cartório ou VPS) | Monitora grupos WhatsApp + envia notificações |

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
```

### RPCs críticas
```sql
sime_now()                -- server timestamp — SEMPRE usar
sime_acao_midia()         -- atualiza mídia com server ts
sime_importar_ator()      -- importa ator validando duplicatas
```

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

---

## PENDÊNCIAS (atualizado em 27/07/2026)

Os itens 1 a 5 da lista antiga (módulo de acessibilidade, novos perfis no
Admin, enum de funções, `sime_empresas`, token de acessibilidade) estão
**concluídos** — assim como Realtime nas TVs, Supabase Auth, deploy na Vercel
e os QR Codes por zona.

### Migração localStorage → Supabase (parcial)

Já leem do banco: Admin (seções, equipe, mesários, atores), portal
(zonas, eleição), TVs (Realtime), tokens e os 6 módulos de campo.

Ainda só em `localStorage`:
- **Nome da eleição, início da distribuição e intervalo entre saídas** — não
  têm coluna em `sime_eleicoes` (o resto da configuração já persiste).
- **Cadastro/edição de ator** em `SIME_atores.html` — a *leitura* vem do banco,
  mas criar e editar ainda grava local.
- **Estado de campo** (`sime_lacre_v3`, `sime_inst_v1`, `sime_dist_v1`) —
  escrito pelos módulos e lido pelas TVs.

### Pânico — propagação de volta ao campo (parcial)

O `SIME_mesario.html` assina o Realtime da própria seção e relê o estado ao
abrir e a cada volta de tela, então a resolução feita pelo Admin chega ao
aparelho. Além disso, **os campos de pânico só entram no payload quando o
toque foi de pânico** — o RPC trata `NULL` como "mantém", então nenhuma outra
ação pode desfazer a resolução (vale offline também).

Os outros cinco módulos de campo (motorista, conferente, instalador, mídias,
acessibilidade) **ainda só escrevem**. O caso real é o pânico da
acessibilidade: se a equipe resolver pelo Admin, aquele aparelho não fica
sabendo. Instrução operacional até lá: resolver naquele aparelho.

### Operação — antes de 4 de outubro

- **94ª Zona zerada**: 0 tokens e 0 atores. Precisa importar os atores e gerar
  os cartões.
- **Data de carga e lacre** (`data_dx_ini`) nula nas duas zonas — não há padrão
  legal, é decisão de cada cartório.
- **Segredos do Hermes** (`HERMES_SECRET_ZONA_7/94`) na Vercel e no Hermes.
- **Testar em campo**: um QR real com PIN e a legibilidade física dos cartões.

---

## HERMES AGENT

### Skills instaladas
- `sime_monitor` — detecta 12 tipos de evento em linguagem natural
- `sime_notificar` — envia WhatsApp com 8 templates
- `sime_updater` — persiste eventos de seção via `/api/hermes-update` (só escrita)
- `sime_mesarios` — consulta mesários e registra confirmação de permanência na
  função via `/api/hermes-mesarios` (leitura + `sime_atores.confirmacao`)

### Como o Hermes recebe as notificações (SIME → Hermes)

O Hermes roda atrás de NAT (PC do cartório), sem endereço público — o Supabase
não consegue chamá-lo. Então **o Hermes é quem pergunta**, a cada ~30s:

```
POST /api/hermes-notificacoes  { "acao": "pendentes" }   → fila da zona
POST /api/hermes-notificacoes  { "acao": "confirmar", "ids": [...] }
POST /api/hermes-notificacoes  { "acao": "erro", "ids": [...], "erro_msg": "..." }
```

O gatilho de pânico/mídia **enfileira** em `sime_notificacoes`; o POST direto
para o Hermes virou aceleração opcional, só quando `app.hermes_url` existe.
Cada notificação traz `idade_s` (relógio do servidor) — é com ela que o Hermes
decide o nível de escalonamento, sem depender do horário do PC.

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

### Endpoint Vercel — mesários (leitura + confirmação)
```
POST /api/hermes-mesarios
Authorization: Bearer HERMES_SECRET_ZONA_<numero>
Body: { acao, secao?, status?, telefone? }

Ações:
  listar                          → lista mesários da zona (nome, telefone, seção, status)
  confirmar | recusar | substituir → grava sime_atores.confirmacao (por telefone)
```

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

