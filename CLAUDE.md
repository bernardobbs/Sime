# SIME — Sistema de Monitoramento Eleitoral
## Contexto completo para o Claude Code

---

## IDENTIDADE DO PROJETO

Sistema auxiliar de observabilidade operacional para eleições.
**Não substitui** nenhum processo oficial da Justiça Eleitoral.
Desenvolvido para a **7ª Zona Eleitoral do Piauí**.
Cobre **Campo Maior**, **Jatobá do Piauí** e **Sigefredo Pacheco**.

### Números da operação
- 174 seções eleitorais
- 63 locais de votação
- 34.967 eleitores aptos
- 12 rotas de distribuição de urnas
- 3 municípios
- Eleição: **4 de outubro de 2026**

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
- IA + WhatsApp: Hermes Agent no Oracle Cloud Always Free
- Custo total: **R$ 0,00/mês**

### Variáveis de ambiente necessárias (Vercel)
```
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
HERMES_URL=http://SEU_ORACLE_IP:3000
HERMES_WEBHOOK_SECRET=senha-forte-aqui
```

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
│   ├── SIME_acessibilidade.html          Dia D (PENDENTE)
│   ├── SIME_atores.html                  Todos
│   ├── SIME_principal.html               Todos
│   ├── SIME_tokens.html                  Pré-eleição
│   └── SIME_paineis.html                 Todos
├── api/
│   └── hermes-update.js               ← Vercel serverless function
├── sql/
│   ├── SIME_schema.sql                ← Schema principal
│   ├── SIME_whatsapp_schema.sql       ← Notificações WhatsApp
│   └── SIME_hermes_trigger.sql        ← Triggers para o Hermes
├── hermes/
│   ├── sime_monitor.md                ← Skill: monitora grupos
│   ├── sime_notificar.md              ← Skill: envia WhatsApp
│   ├── sime_updater.md                ← Skill: persiste no Supabase
│   └── setup.sh                       ← Instalação no Oracle Cloud
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
| **Hermes Agent** | IA (Oracle Cloud) | Monitora grupos WhatsApp + envia notificações |

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
sime_secoes         -- 174 seções com local, município, eleitores
sime_rotas          -- 12 rotas com paradas
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

## MÓDULOS PENDENTES (implementar nesta ordem)

### Alta prioridade

1. **`SIME_acessibilidade.html`** — módulo novo
   - Interface simplificada para Coordenador de Acessibilidade
   - Filtra seções pelo `local_id` do token de acesso
   - Botões: Fila (contador) / Energia (pânico) / Urna (pânico)
   - Mesmo padrão visual do Mesário (dark, botões grandes)
   - QR Code + PIN como acesso

2. **`SIME_admin.html`** — novos perfis
   - Coord. de Motoristas: filtro por `empresa_id` (só vê rotas da empresa)
   - Coord. de Acessibilidade: filtro por `local_id` (só vê seções do local)
   - Coletor de Mídias: campo `substituto_temporario` + notificação WA

3. **`SIME_atores.html`** — atualizar enum funções
   - Adicionar: `auxiliar_eleicao`, `coord_motoristas`,
     `coord_acessibilidade`, `coletor_midias`, `preposto`

4. **`SIME_schema.sql`** — novas tabelas
   ```sql
   CREATE TABLE sime_empresas (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     zona_id UUID REFERENCES sime_zonas(id),
     nome TEXT NOT NULL,
     rotas UUID[],  -- rotas atribuídas à empresa
     ativo BOOLEAN DEFAULT true
   );
   ALTER TABLE sime_usuarios ADD COLUMN empresa_id UUID REFERENCES sime_empresas(id);
   ALTER TABLE sime_usuarios ADD COLUMN local_id UUID;  -- para coord. acessibilidade
   ```

5. **`SIME_tokens.html`** — novo tipo de token
   - `coord_acessibilidade`: filtra por `local_id`, não por rota

### Média prioridade

6. **Migração localStorage → Supabase** (todos os 16 módulos)
7. **Supabase Auth** (login email+senha para admins)
8. **Deploy Vercel** com variáveis de ambiente
9. **Realtime** nos TVs (TV Dia, TV Véspera, TV Distribuição)
10. **Edge Function WhatsApp** (Hermes já configurado)
11. **QR Codes** gerados para 174 seções + 12 rotas + tokens

---

## HERMES AGENT (Oracle Cloud)

### Skills instaladas
- `sime_monitor` — detecta 12 tipos de evento em linguagem natural
- `sime_notificar` — envia WhatsApp com 8 templates
- `sime_updater` — persiste eventos de seção via `/api/hermes-update` (só escrita)
- `sime_mesarios` — consulta mesários e registra confirmação de permanência na
  função via `/api/hermes-mesarios` (leitura + `sime_atores.confirmacao`)

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
Authorization: Bearer HERMES_WEBHOOK_SECRET
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
| Hermes cai | Operação continua, perde só notificações automáticas |
| Celular do mesário sem bateria | Qualquer agente confirma pelo Admin |
| QR Code ilegível | PIN de 4 dígitos no verso do cartão |

