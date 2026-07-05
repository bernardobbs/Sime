# Prompt para o ChatGPT — SIME: Sistema de Monitoramento Eleitoral

---

## Contexto

Você está sendo contratado para continuar o desenvolvimento do **SIME (Sistema de Monitoramento Eleitoral)**, um sistema auxiliar de observabilidade operacional desenvolvido para a **7ª Zona Eleitoral do Piauí**, abrangendo os municípios de **Campo Maior**, **Jatobá do Piauí** e **Sigefredo Pacheco**.

O sistema cobre **174 seções eleitorais**, **63 locais de votação**, **34.967 eleitores** e **12 rotas de distribuição de urnas**.

O SIME **não substitui** nenhum processo oficial da Justiça Eleitoral. É um sistema auxiliar de visibilidade em tempo real para a equipe operacional do cartório.

---

## Filosofia central do sistema

> "Sistema auxiliar, não prioridade. O trabalho real de campo acontece independentemente do SIME."

- **Toque único** para ações simples
- **Confirmação modal** apenas para ações irreversíveis
- **Nunca bloquear** por campos opcionais
- **Botões grandes** — uso às 5h30 da manhã em campo
- **Vibração háptica** como confirmação extra
- **Offline-first** — funciona sem internet, sincroniza quando disponível
- **Auditável** — toda ação registrada em log com timestamp do servidor

---

## Stack tecnológica

### Fase atual (homologação — COMPLETA)
- **Frontend:** HTML + JS puro, sem framework, sem build
- **Armazenamento:** `localStorage` por chave compartilhada entre módulos
- **Offline:** `IndexedDB` para fila de ações pendentes (retry automático a cada 30s)
- **Badge de sync:** 🟢 Sync / 🟡 N pendentes

### Fase de produção (pós-homologação — PENDENTE)
- **Banco de dados:** Supabase (PostgreSQL + Realtime)
- **Hospedagem:** Vercel (.vercel.app)
- **Auth:** Supabase Auth (email+senha para admins; QR Code + PIN para operadores de campo)
- **Timestamps:** SEMPRE via `supabase.rpc('sime_now')` — NUNCA usar `Date.now()` do device
- **Custo:** R$ 0,00/mês (plano gratuito Supabase + Vercel)

### Conectividade no dia da eleição
- Computadores fixos do cartório: **rede da Justiça Eleitoral** (sem internet externa)
- Tablets/notebooks com TV Dia e TV Véspera: **chip 4G próprio**
- Celulares dos agentes de campo: **dados móveis próprios**

---

## Arquitetura de dados (localStorage keys — fase atual)

| Chave | Gravado por | Lido por |
|---|---|---|
| `sime_lacre_v3` | Coordenador de Preparação | TV Preparação · TV Véspera · Painéis |
| `sime_inst_v1` | Instalador | TV Véspera · Painéis |
| `sime_dist_v1` | Conferente | TV Distribuição |
| `sime_mesa_v1` | Mesário · Motorista · Admin | TV Dia · Admin · Mídias |
| `sime_motorista_v1` | Motorista | TV Dia · Admin |
| `sime_midias_v1` | Mesário (pronta) · Mídias (coleta) | TV Dia · Admin |
| `sime_atores_v1` | Admin / Atores | Admin · Modo Guerra |
| `sime_eleicao_v1` | Painel Principal | Todos os módulos |
| `sime_tokens_v1` | Tokens de Acesso | Conferente · Mesário |
| `sime_equipe_v1` | Administração | Administração |
| `sime_sons_v1` | TV Dia (config) | TV Dia |
| `sime_panels_v1` | Gerenciador Painéis | Painéis TV |
| `sime_logs_v1` | Todos os módulos | Admin · Debug |

---

## Módulos concluídos (15 arquivos)

### 1. `SIME_coordenador_preparacao.html`
- Checklist de **carga → preparação → lacre** por seção (sequência obrigatória)
- 3 barras de progresso, filtros, busca
- Salva em `sime_lacre_v3`

### 2. `SIME_tv_preparacao.html`
- Relógio HH:MM:SS + 3 barras de progresso
- Lê `sime_lacre_v3` em loop

### 3. `SIME_instalador.html`
- 3 etapas independentes por seção: chegou / posicionada / instalada
- Registro de problemas
- Salva em `sime_inst_v1`

### 4. `SIME_conferente.html`
- Login via **QR Code** (`?token=ID`) ou **PIN de 4 dígitos**
- Urnas em **ordem inversa** de distribuição (última parada embarca primeiro)
- Toque único por urna, modal para confirmar saída
- Recalcula horários das rotas pendentes ao confirmar saída
- Salva em `sime_dist_v1`

### 5. `SIME_tv_vespera.html`
- Círculos SVG com 3 arcos por seção (lacre / chegou / instalada)
- Paginação por cidade com fade transition
- Badge `!` pulsando para problemas
- Alarme sonoro, indicador dados reais vs simulação
- Atualiza a cada 5s

### 6. `SIME_tv_distribuicao.html`
- Grid dinâmico de 12 rotas (adapta colunas: ≤6→3col, ≤12→4×3, etc.)
- Cards com status, barra de progresso, horário previsto, alerta de atraso
- Alarme sonoro 3 bips quando rota com urna faltando

### 7. `SIME_mesario.html`
- Interface **dark** tipo "controle remoto" com botões 3D e feedback tátil
- **Chegada da mesa:** 4 botões (Pres/M1/M2/Sec) — ciclo ausente→presente→problema
- **Zerésima, Iniciar votação, Encerramento, BU, Material recolhido, Urna recolhida**
- **Fila inline:** contador sempre visível com botões −5/−/0/+/+5, salva imediatamente sem modal, vibração háptica
- **Pânico energia/urna:** 2 botões — aciona (pulso vermelho) → resolve (verde)
- **Mídia:** botão sempre visível com 3 estados:
  - 🔒 Bloqueado (antes do encerramento)
  - 📦 Disponível — roxo (após encerramento)
  - ✅ Confirmado — verde (após toque)
- Salva em `sime_mesa_v1`

### 8. `SIME_motorista.html`
- Acesso via QR Code da rota: `?rota=007` ou seleção manual
- **Fase Entrega (D-1):** confirma entrega de cada urna individualmente por parada
- **Fase Recolhimento (Dia D):** aguarda encerramento do mesário → botão "Recolher" → confirma chegada ao cartório (desbloqueia quando todas recolhidas)
- Resiliente: qualquer agente pode confirmar qualquer seção
- Atualiza `sime_mesa_v1.urna` e `urna_cartorio`

### 9. `SIME_tv_dia.html`
- **Fase Abertura — 4 arcos** por seção: chegou / completa / zerésima / votação
- **Fase Encerramento — 3 arcos** + barras de progresso por local (🚗 Recolhidas / 📦 No cartório)
- **Tela ⚠ Problemas:** lista seções com alertas ativos
- **Badge no círculo:** `E` (energia) ou `U` (urna) em vez de `!`
- **Tooltip ao hover:** tipo do problema + horário de detecção
- **Clique no círculo:** modal com detalhe completo + link para Mesário
- **Ticker "📡 AO VIVO":** barra preta rolante na base com eventos únicos
- **Troca automática de fase** configurável (padrão 17h)
- **⚙️ Configurador de sons:** 5 presets por categoria (Pânico / Aviso) + upload de arquivo .mp3/.wav + volume independente
- **Card de clima** (canto superior direito) via Open-Meteo (gratuito, sem API key): temperatura, condição, probabilidade de chuva. Alerta "⚠ Possível atraso na logística" quando chuva > 50%
- Salva config em `sime_sons_v1`

### 10. `SIME_admin.html`
- **5 abas:** Dashboard · Seções · Problemas · Equipe · Config
- **+ 2 abas novas:** 📦 Mídias · 👥 Atores
- Dashboard: stat cards, feed de eventos, progresso por cidade, equipe de plantão
- Seções: tabela de 174 seções com filtros, edição individual de todos os campos
- Lançamento de ocorrência por telefone (sem precisar do app do mesário)
- Problemas: lista alertas com botão resolver pânico
- Equipe: CRUD de membros com 5 perfis e permissões granulares
- Mídias: painel de stats + lista de mídias prontas com botão coletar
- Atores: tabela com busca e link WhatsApp direto

### 11. `SIME_principal.html`
- **5 abas:** Eleição · Zonas · Módulos · Usuários · Config
- Configuração de datas D-X/D-1/Dia D e horários por turno
- Linha do tempo visual com fase atual destacada
- Links para todos os 15 módulos
- Arquivamento de turno e reset de dados

### 12. `SIME_tokens.html`
- Geração de tokens para operadores de campo
- Gera ID de 8 chars + PIN de 4 dígitos + QR Code
- Impressão individual ou em lote
- Validade: fim do Dia D

### 13. `SIME_paineis.html`
- Cria painéis personalizados para TVs por: intervalo / cidade / rota / manual
- Rotação automática ou estática

### 14. `SIME_midias.html` *(novo)*
- **3 abas:** Coleta por Rota · Coleta Dedicada · Transmissão
- Fluxo: `aguardando_encerramento → pronta_para_coleta → coletada → entregue_transmissao`
- Barra de progresso global (X de 174 mídias recolhidas)
- Botão "Coletar" por seção (atualiza também `sime_mesa_v1.urna = true`)
- Confirmação de entrega na transmissão em lote
- **Offline-first:** IndexedDB + badge 🟢/🟡 + retry automático a cada 30s

### 15. `SIME_atores.html` *(novo)*
- **3 abas:** Lista · Modo Guerra · Importar CSV
- CRUD de atores com nome, telefone, seção, função
- **Modo Guerra:** lista por seção com botão 📲 CONTATAR (abre WhatsApp)
- **Importação CSV:** formato `nome,telefone,secao,funcao` — valida telefone, evita duplicatas, preview antes de confirmar
- Todo acionamento no Modo Guerra registrado em `sime_logs_v1`

### 16. `SIME_schema.sql` *(novo)*
SQL completo para Supabase incluindo:
- Tabelas: `sime_midias`, `sime_atores`, `sime_logs` (+ tabelas base)
- Enums: `sime_midia_status`, `sime_tipo_coleta`, `sime_ator_funcao`
- Triggers: `update_midia_updated_at`
- RPCs: `sime_now()`, `sime_acao_midia()`, `sime_importar_ator()`
- RLS: Row Level Security por zona eleitoral
- Views: `vw_midias_resumo`, `vw_midias_pendentes`, `vw_atores_por_secao`

---

## Perfis de usuário

| Perfil | Ver | Editar seções | Resolver pânico | Lançar por tel. | Distribuição | Config equipe |
|---|---|---|---|---|---|---|
| Coordenador Geral | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Monitor de Campo | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Gestor de Problemas | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ |
| Gestor de Distribuição | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| Observador | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

Operadores de campo (mesários, conferentes, técnicos, motoristas) acessam via QR Code ou PIN — sem cadastro individual no Supabase.

---

## Linha do tempo operacional

| Fase | Quando | Módulos ativos |
|---|---|---|
| **D-X** — Preparação | Semanas antes | Coordenador de Preparação · TV Preparação |
| **D-1** — Véspera | Dia anterior | Conferente · TV Distribuição · Instalador · TV Véspera · Motorista (entrega) |
| **Dia D** — Eleição | Dia da votação | Mesário · TV Dia · Motorista (recolhimento) · Mídias · Admin |
| **Pós-eleição** | Após 17h | Mídias (entrega na transmissão) · Motorista (cartório) |

---

## O que ainda falta fazer

### Prioridade ALTA — antes da eleição

#### 1. Migração localStorage → Supabase
- Criar projeto Supabase (instalação limpa — sem migrar dados de teste)
- Executar `SIME_schema.sql`
- Em cada módulo, substituir:
  ```js
  // DE (localStorage):
  localStorage.setItem('sime_mesa_v1', JSON.stringify(data));
  
  // PARA (Supabase):
  await supabase.from('sime_mesa_estado').upsert(data);
  ```
- **CRÍTICO:** Substituir `Date.now()` por `await supabase.rpc('sime_now')` em TODAS as ações
- Implementar `supabase.channel().on('postgres_changes')` para Realtime nos TVs

#### 2. Supabase Auth
- Login de admins: email + senha
- Página de cadastro do primeiro Super Admin (via script seed)
- Middleware de autenticação nos módulos admin
- JWT claims para controle de zona

#### 3. Deploy no Vercel
- Criar projeto Vercel
- Conectar ao repositório
- Configurar variáveis de ambiente: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- URL pública para acesso da equipe

#### 4. API de clima (serverless)
- Criar endpoint `/api/weather` no Vercel
- Cachear resposta por 10 minutos (evitar rate limit da Open-Meteo)
- Retornar: `{ temperatura, sensacao, condicao, chuva_prob, forecast_3h, impacto_logistico }`
- TV Dia consome `/api/weather` em vez de Open-Meteo diretamente

#### 5. Mesário — SECAO_ID via QR Code
- Atualmente hardcoded como `'0063'`
- Implementar: `?secao=0063` na URL via QR Code gerado no SIME Tokens
- Validar o token antes de exibir a interface

#### 6. Instalador — seções via token de rota
- Atualmente lista todas as seções
- Implementar: ao fazer login com token, filtrar apenas seções da rota atribuída

### Prioridade MÉDIA

#### 7. Sincronização bidirecional (TV Dia)
- TV Dia atualmente lê `sime_mesa_v1` do localStorage local
- Com Supabase Realtime, receberá updates de qualquer mesário em campo em tempo real
- Implementar reconexão automática em caso de queda de sinal

#### 8. Modal de detalhe da seção no TV Dia
- Clique no círculo abre modal com status completo
- Já implementado, mas o link "Abrir Mesário" precisa passar `?secao=XXXX` correto

#### 9. Impressão dos QR Codes
- SIME Tokens gera QR Code em tela, mas não tem layout de impressão otimizado
- Criar template de impressão: 1 QR por folha A4 com nome, rota, PIN e instrução

#### 10. Segundo turno
- SIME Principal já tem campo para 2º turno
- Validar que dados do 1º turno são arquivados corretamente antes de iniciar o 2º
- Testar reset seletivo (apenas `sime_mesa_v1`, sem apagar `sime_equipe_v1` e `sime_atores_v1`)

#### 11. TV Dia — integração com Mídias
- Mostrar indicador no círculo quando `sime_midias_v1[secao].status === 'pronta_para_coleta'`
- Sugestão: pequeno badge roxo "📦" no círculo da seção

#### 12. Tela de status do Modo Guerra no Admin
- Quando ator é contatado via Modo Guerra, registra em `sime_logs_v1`
- Admin deveria ter uma visão de "quem foi contatado hoje e quando"

### Prioridade BAIXA / Pós-eleição

#### 13. Relatório pós-eleição
- Exportar PDF/Excel com:
  - Horário de abertura e encerramento de cada seção
  - Ocorrências registradas (pânico, atrasos, problemas)
  - Timeline de cada urna (saída, recolhimento, cartório)
  - Mídias: horário de prontidão e coleta

#### 14. Expansão multi-zona
- Cadastrar 96ª Zona (já prevista no Painel Principal)
- Cada zona: dados, usuários, painéis e rotas completamente isolados
- Super Admin com visão consolidada multi-zona

#### 15. App nativo (opcional)
- Converter Mesário e Motorista em PWA (Progressive Web App)
- Push notifications para alertas de pânico
- Modo offline mais robusto com Service Worker

---

## Regras técnicas críticas — nunca violar

1. **Nunca usar `Date.now()` ou `new Date()` para timestamps de ação** — sempre chamar `sime_now()` no Supabase
2. **Nunca deletar registros de log** — `sime_logs` é append-only
3. **Nunca bloquear a interface** por campos opcionais ou sequências
4. **Offline-first:** toda ação vai para IndexedDB antes de tentar o servidor
5. **RLS ativo:** usuário só lê/escreve dados da sua zona eleitoral
6. **Resiliente:** qualquer agente autorizado pode confirmar qualquer seção (sem travamento por "dono" da seção)

---

## Padrão de código existente

```javascript
// Estrutura padrão de uma ação com offline-first
async function confirmarAcao(secao, dados) {
  const ts = await supabase.rpc('sime_now'); // SEMPRE server timestamp
  const payload = { ...dados, ts: ts.data };
  
  try {
    const { error } = await supabase.rpc('sime_acao_midia', payload);
    if (error) throw error;
    showToast('✓ Confirmado');
    updateSyncBadge(0);
  } catch(e) {
    await enqueue('acao_nome', payload); // IndexedDB
    showToast('🟡 Salvo — sincronizará em breve');
    updateSyncBadge(await countPending());
  }
  
  render(); // sempre re-renderiza
}
```

```javascript
// Realtime (Supabase) — TV Dia
supabase
  .channel('mesa_updates')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'sime_mesa_estado',
    filter: `eleicao_id=eq.${eleicaoId}`
  }, payload => {
    updateSecaoFromRealtime(payload.new);
  })
  .subscribe();
```

---

## Próxima tarefa sugerida

**Migração para Supabase** seguindo esta ordem:
1. Criar projeto Supabase → executar `SIME_schema.sql`
2. Criar um arquivo `supabase.js` com o cliente configurado e as funções de acesso
3. Começar pelo `SIME_admin.html` (mais simples, não é tempo-real)
4. Depois `SIME_mesario.html` + `SIME_motorista.html`
5. Por último `SIME_tv_dia.html` (mais complexo — Realtime)
6. Deploy Vercel + Supabase Auth

---

*Prompt gerado automaticamente a partir do histórico completo de desenvolvimento do SIME — Abril 2026*
