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
  casos que o regex não cobre. Ver `hermes/README.md` e `hermes/HERMES_RUNTIME.md`.
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
│   ├── hermes-mesarios.js             ← leitura + autoatendimento + confirmação de mesários
│   ├── hermes-notificacoes.js         ← fila de notificações que o Hermes consulta (SIME → Hermes)
│   └── hermes-campanhas.js            ← fila de disparo em massa que o Hermes consulta (SIME → Hermes)
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

`sime_mesarios_raw` é staging descartável — pode ser truncada e recarregada a
qualquer momento com uma nova exportação ELO do TRE (`parse_mesarios.py` em
`scripts/`, ou onde tiver sido salvo, gera o SQL de INSERT a partir do
`.md` bruto, nunca digitado à mão — ver commit da carga inicial da 7ª Zona).

A sincronização pra `sime_atores` é feita por `sime_sync_atores_from_raw(p_zona_numero, p_uf)`
— UPSERT por `(inscricao_eleitoral, funcao)`, não DELETE+INSERT: preserva o
`id` de cada ator (não quebra `sime_campanhas_confirmacao.ator_id` nem
histórico de notificações) e nunca toca `confirmacao`/`status_convocacao`/
`whatsapp_*`. Quem sai da nova exportação vira `ativo=false`, não é apagado.

```sql
-- 1. truncar e recarregar o staging com a exportação nova
truncate sime_mesarios_raw;
-- rodar o INSERT gerado pelo parser (gera o .sql a partir do .md, nunca à mão)

-- 2. sincronizar (idempotente — pode rodar quantas vezes precisar)
select * from sime_sync_atores_from_raw(7, 'PI');  -- 7ª Zona
select * from sime_sync_atores_from_raw(94, 'PI'); -- 94ª Zona
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
- **Estado de campo** (`sime_lacre_v3`, `sime_inst_v1`, `sime_dist_v1`) —
  escrito pelos módulos e lido pelas TVs.

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

- **94ª Zona zerada**: 0 tokens e 0 atores. Precisa importar os atores e gerar
  os cartões.
- **Data de carga e lacre** (`data_dx_ini`) nula nas duas zonas — não há padrão
  legal, é decisão de cada cartório.
- **Segredos do Hermes** (`HERMES_SECRET_ZONA_7/94`) na Vercel e no Hermes.
- **Testar em campo**: um QR real com PIN e a legibilidade física dos cartões.
- **Detecção de eventos de seção (`eventos.js`) só propõe, não grava**
  (`enc`, `zeresima`, `panico_*`, `urna`, `midia_pronta`, `mesa_completa` — o
  domínio de dia D). Regex + fallback IA identificam e mandam pro Telegram
  pra validação humana, mas nada chama `/api/hermes-update` — decisão
  deliberada (modo proposta), não escrever automaticamente sem medir taxa de
  acerto primeiro. Sem isso, "seção 63 encerrada" dito no grupo continua
  exigindo lançamento manual no Admin ou por telefone.
- **Escalonamento por papel ainda não differencia destinatário**: a fila de
  notificações drenada manda pra todos os `ADMIN_NUMBERS` do Hermes,
  independente do nível (Monitor de Campo/Gestor de Problemas/Chefe de
  Cartório) — falta um endpoint que resolva telefone por papel.
- **Autoatendimento por telefone ("oi" → função + seção) não está ligado no
  Hermes** — o endpoint (`/api/hermes-mesarios acao=consultar`) existe e
  funciona, mas nada no `index.js` o chama ainda. Buscar convocação por
  **nome** já funciona (`acao=buscar_nome`, quem manda 2+ palavras no
  privado do Hermes recebe a convocação de volta).
- **94ª Zona sem instância de Hermes**: só a 7ª tem o Raspberry Pi rodando.
- **JID `@lid` do Baileys**: quando o WhatsApp identifica o remetente por um ID
  interno em vez do telefone, o Hermes não consegue casar com `sime_atores` —
  bloqueia confirmação automática para essas mensagens. Medir a frequência.
- **Ponto único de falha do Hermes**: Pi 3B doméstico, Wi-Fi, sem redundância —
  se cair no dia da eleição, não há monitoramento por WhatsApp (a fila offline
  do SIME em si continua funcionando).

---

## HERMES AGENT

> **Discrepância conhecida, ainda não resolvida**: os endpoints e skills
> abaixo descrevem uma arquitetura "Hermes pergunta via HTTP" que foi
> documentada aqui, mas o runtime real do Raspberry Pi (Node + Baileys + PM2,
> visto em produção 02/08/2026) conecta **direto no Supabase** com
> `SUPABASE_SERVICE_KEY` — não fala com nenhum destes endpoints `/api/hermes-*`.
> O código real (`index.js`/`telegram.js`/`eventos.js`/`keywords.js`) não está
> neste repositório. Ver "Proposta de Evolução do Hermes Agent" (04/08/2026) —
> a seção **Gestão do Hermes** abaixo já foi desenhada para a realidade
> confirmada (Supabase direto), não para o padrão HTTP legado. Antes de
> investir mais nos endpoints `/api/hermes-mesarios`/`hermes-campanhas`,
> confirmar se eles têm consumidor real ou se são caminho morto (mesmo caso já
> documentado de `sime_campanhas_confirmacao`, ver `sql/SIME_campanhas_confirmacao.sql`).

### Gestão do Hermes (versão + heartbeat) — `sql/SIME_hermes_gestao_schema.sql`

Primeiro passo da evolução proposta pelo usuário: dar ao SIME visibilidade e
controle remoto sobre o Hermes, sem reescrever o runtime ainda (isso depende
de trazer o código real do Pi pra dentro do repo — pendente, ver acima).

- `sime_componentes` (por zona): `versao_instalada`/`commit_instalado`
  (o que o Hermes reportou), `versao_desejada`/`atualizar_agora` (o que o
  admin pediu). SIME nunca empurra comando — o mesmo problema de NAT de
  sempre — então pedir atualização é só marcar a linha; o Hermes decide se
  atende no próprio ciclo.
- `sime_heartbeat` (por zona): pulso de vida + telemetria (versão, uptime,
  CPU/RAM/temperatura, disco, status WhatsApp/Telegram, última sincronização).
  "Online" é derivado no cliente (heartbeat < 5 min), não guardado.
- **Sem endpoint Vercel novo** — decisão deliberada: o Hermes real já fala
  direto com o Supabase (é como ele lê `sime_atores` hoje), então heartbeat e
  checagem de versão são UPSERT/SELECT direto nas tabelas acima, mesmo
  caminho. Um endpoint HTTP a mais só repetiria o que o client Supabase já
  faz.
- Aba "🤖 Hermes" no Admin (`SIME_admin.html`) lê as duas tabelas (RLS por
  zona) e tem o botão "Solicitar atualização", que faz upsert com
  `atualizar_agora=true` + `versao_desejada`. Realtime em `sime_heartbeat`
  (`subscribeHeartbeat` em `sime_realtime.js`) atualiza a tela sozinha.
- **O Hermes real ainda não escreve nessas tabelas** — o painel funciona e
  mostra "Nenhum heartbeat ainda" até que o runtime do Pi seja atualizado pra
  fazer o UPSERT. Essa é a próxima peça que falta.

### Skills instaladas
- `sime_monitor` — detecta 12 tipos de evento em linguagem natural
- `sime_notificar` — envia WhatsApp com 8 templates
- `sime_updater` — persiste eventos de seção via `/api/hermes-update` (só escrita)
- `sime_mesarios` — consulta mesários e registra confirmação de permanência na
  função via `/api/hermes-mesarios` (leitura + autoatendimento + `sime_atores.confirmacao`)
- `sime_campanha` — drena a fila de disparo em massa via `/api/hermes-campanhas`
  (leitura + `sime_campanhas_confirmacao.status`)

> As skills acima descrevem o **contrato de dados** com o SIME (schema dos
> endpoints, templates), não um agente de IA com skills de verdade — a
> instância da 7ª Zona é um app Node.js + Baileys sob medida num Raspberry
> Pi, documentado em `hermes/HERMES_RUNTIME.md` (não o CLI genérico que
> `hermes/setup.sh` instala). Regex cobre a maior parte da detecção; Gemini
> só entra como fallback nos casos que o regex não resolve. Estado de cada
> contrato, desde 03/08/2026:
>
> | Skill | Estado real no Pi |
> |---|---|
> | `sime_mesarios` | confirmação/recusa grava via `/api/hermes-mesarios`; busca por nome (`buscar_nome`) funciona; autoatendimento por telefone (`consultar`, alguém manda "oi") não está ligado |
> | `sime_notificar` | fila de pânico drenada e enviada automaticamente (`/api/hermes-notificacoes`) |
> | `sime_campanha` | disparo em massa funcionando (`/api/hermes-campanhas`), com `pausar envio`/`retomar envio`/`fila` por WhatsApp — **desligado por padrão** (`DISPATCH_ATIVO=false`) |
> | `sime_monitor` / `sime_updater` | `eventos.js` detecta (regex + fallback IA) e propõe no Telegram — **modo proposta deliberado, não grava** via `/api/hermes-update` |
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
que vai pra `atualizar` — ver `hermes/SIME_hermes_skill_mesarios.md`.

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

