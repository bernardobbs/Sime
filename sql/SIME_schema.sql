-- ============================================================
-- SIME — Schema SQL Completo para Supabase (PostgreSQL)
-- Inclui: módulos base + Mídias + Atores + Logs
--
-- ÍNDICE
--   1. TABELAS BASE (zonas, seções, rotas, empresas, eleições,
--      usuários, tokens, mesa_estado)
--   2. EMBARQUE DE ROTA (Conferente, D-1)
--   3. MÓDULO DE MÍDIAS
--   4. MÓDULO DE ATORES
--   5. LOGS DE AUDITORIA
--   6. VIEWS ÚTEIS
--   7. RPCs (sime_now, ações de mídia/mesa/acessibilidade/embarque,
--      importação de atores)
--   8. RLS (Row Level Security) — produção
--   9. DADOS INICIAIS (seed) — 7ª Zona Piauí
--
-- Cada tabela também carrega, logo após o CREATE TABLE original, os
-- ALTER TABLE incrementais das fases que vieram depois (marcados
-- "Migração para bancos já existentes") — mantidos nessa ordem de
-- propósito: reordenar pra "juntar tudo no CREATE" quebraria a
-- idempotência já testada contra Postgres real em produção.
-- ============================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- busca fuzzy

-- ------------------------------------------------------------
-- 1. TABELAS BASE (já documentadas na arquitetura)
-- ------------------------------------------------------------

-- Zonas eleitorais
CREATE TABLE IF NOT EXISTS sime_zonas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero      INTEGER NOT NULL,
  municipio   TEXT NOT NULL,
  estado      CHAR(2) NOT NULL DEFAULT 'PI',
  lat         DOUBLE PRECISION, -- usado pelo card de clima da TV Dia
  lon         DOUBLE PRECISION,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migração para bancos já existentes
ALTER TABLE sime_zonas ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE sime_zonas ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION;
-- Backfill da 7ª Zona com as coordenadas hoje hardcoded em SIME_tv_dia.html
UPDATE sime_zonas SET lat = -4.8252, lon = -42.1733
WHERE numero = 7 AND lat IS NULL;

-- Seções eleitorais
-- (rota_id/parada ligam a sime_rotas, definida a seguir — a FK e os índices
-- entram por ALTER logo depois que sime_rotas existir, ver abaixo)
CREATE TABLE IF NOT EXISTS sime_secoes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id     UUID REFERENCES sime_zonas(id),
  numero      INTEGER NOT NULL,
  local_nome  TEXT NOT NULL,
  municipio   TEXT NOT NULL,
  eleitores   INTEGER,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT sime_secoes_zona_numero_key UNIQUE (zona_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_secoes_zona ON sime_secoes(zona_id);
CREATE INDEX IF NOT EXISTS idx_secoes_numero ON sime_secoes(numero);

-- Rotas de distribuição
CREATE TABLE IF NOT EXISTS sime_rotas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id     UUID REFERENCES sime_zonas(id),
  codigo      VARCHAR(3) NOT NULL, -- '001' a '012'
  nome        TEXT NOT NULL,
  municipios  TEXT[],
  itinerario      TEXT,     -- descrição livre das paradas/localidades (planilha de distribuição)
  urnas_estimadas INTEGER,  -- qtde de urnas a recolher na rota (planilha de pesquisa de preços)
  ativo       BOOLEAN NOT NULL DEFAULT true
);

-- sime_secoes.rota_id/parada: liga cada seção à sua rota de distribuição e à
-- ordem de parada dentro dela (1, 2, 3...). Antes desta fase essa relação só
-- existia em arrays hardcoded no client (`ROTAS` em SIME_conferente.html/
-- SIME_motorista.html) — necessário para modules/sime_dados.js.getRotas().
ALTER TABLE sime_secoes ADD COLUMN IF NOT EXISTS rota_id UUID REFERENCES sime_rotas(id);
ALTER TABLE sime_secoes ADD COLUMN IF NOT EXISTS parada INTEGER;
CREATE INDEX IF NOT EXISTS idx_secoes_rota ON sime_secoes(rota_id);

-- Empresas contratadas (motoristas terceirizados)
CREATE TABLE IF NOT EXISTS sime_empresas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id     UUID REFERENCES sime_zonas(id),
  nome        TEXT NOT NULL,
  rotas       UUID[],  -- rotas atribuídas à empresa (sime_rotas.id)
  ativo       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_empresas_zona ON sime_empresas(zona_id);

-- Eleições (por zona e turno)
CREATE TABLE IF NOT EXISTS sime_eleicoes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id       UUID REFERENCES sime_zonas(id),
  turno         INTEGER NOT NULL DEFAULT 1,
  data_d        DATE,
  data_d1       DATE,
  data_dx_ini   DATE,
  horario_ab    TIME NOT NULL DEFAULT '07:00',
  horario_enc   TIME NOT NULL DEFAULT '17:00',
  ativa         BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uma eleição por (zona, turno). É a chave que o painel usa para gravar a
-- configuração com upsert; sem ela, cada "Salvar" criaria uma linha nova e
-- getEleicaoAtiva() teria que adivinhar a certa pelo created_at.
ALTER TABLE sime_eleicoes DROP CONSTRAINT IF EXISTS sime_eleicoes_zona_turno_key;
ALTER TABLE sime_eleicoes ADD  CONSTRAINT sime_eleicoes_zona_turno_key UNIQUE (zona_id, turno);

-- Usuários administrativos
CREATE TABLE IF NOT EXISTS sime_usuarios (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id       UUID REFERENCES sime_zonas(id),
  nome          TEXT NOT NULL,
  email         TEXT UNIQUE,
  perfil        TEXT NOT NULL CHECK(perfil IN (
                  'coordenador','monitor','gestor_prob','gestor_dist','observador',
                  'coord_motoristas','coord_acessibilidade','coletor_midias','super_admin')),
  empresa_id    UUID REFERENCES sime_empresas(id),  -- Coord. de Motoristas (preposto): só vê rotas da empresa
  local_id      UUID,                               -- Coord. de Acessibilidade: só vê seções do local
  auth_user_id  UUID UNIQUE,                        -- sub do JWT (login real via auth.users OU
                                                     -- assinado manualmente por sime-login p/ TV/campo)
  ativo         BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migração para bancos já existentes (colunas + novos perfis)
ALTER TABLE sime_usuarios ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES sime_empresas(id);
ALTER TABLE sime_usuarios ADD COLUMN IF NOT EXISTS local_id UUID;
ALTER TABLE sime_usuarios ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE;
ALTER TABLE sime_usuarios DROP CONSTRAINT IF EXISTS sime_usuarios_perfil_check;
ALTER TABLE sime_usuarios ADD CONSTRAINT sime_usuarios_perfil_check CHECK (perfil IN (
  'coordenador','monitor','gestor_prob','gestor_dist','observador',
  'coord_motoristas','coord_acessibilidade','coletor_midias','super_admin'));

-- Tokens de acesso para operadores de campo E para as TVs (tipo='tv').
-- Trocados por uma sessão JWT via a Edge Function supabase/functions/sime-login
-- (ver Fase 3/4 do plano multi-zona) — token de TV não usa `pin` (a function pula
-- essa checagem quando tipo='tv'), mas a coluna é NOT NULL: insira um placeholder
-- fixo (ex.: '0000'). Exemplo de provisionamento de um token de TV para a zona 7
-- (rodar manualmente no SQL Editor até o Fase 4 trazer isso para SIME_tokens.html):
--   INSERT INTO sime_tokens (eleicao_id, token, pin, tipo, expira_em)
--   SELECT e.id, 'TV' || substr(md5(random()::text), 1, 6), '0000', 'tv',
--          now() + interval '90 days'
--   FROM sime_eleicoes e WHERE e.zona_id = (SELECT id FROM sime_zonas WHERE numero = 7)
--     AND e.ativa;
CREATE TABLE IF NOT EXISTS sime_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eleicao_id  UUID REFERENCES sime_eleicoes(id),
  usuario_id  UUID REFERENCES sime_usuarios(id),
  token       VARCHAR(8) NOT NULL UNIQUE,
  pin         VARCHAR(4) NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'conferente', -- 'conferente' | 'coord_acessibilidade' | 'tv' | ...
  rotas       TEXT[],   -- escopo por rota (conferente/motorista)
  local_id    UUID,     -- escopo por local (coord_acessibilidade)
  local_nome  TEXT,     -- nome do local (exibição no módulo de campo)
  secoes      TEXT[],   -- escopo por seção (mesário: 1 elemento; instalador/mídias: N)
  expira_em   TIMESTAMPTZ,
  usado_em    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migração para bancos já existentes
ALTER TABLE sime_tokens ADD COLUMN IF NOT EXISTS tipo       TEXT NOT NULL DEFAULT 'conferente';
ALTER TABLE sime_tokens ADD COLUMN IF NOT EXISTS local_id   UUID;
ALTER TABLE sime_tokens ADD COLUMN IF NOT EXISTS secoes     TEXT[];
ALTER TABLE sime_tokens ADD COLUMN IF NOT EXISTS local_nome TEXT;

-- Estado operacional das seções (Dia D)
CREATE TABLE IF NOT EXISTS sime_mesa_estado (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eleicao_id      UUID REFERENCES sime_eleicoes(id),
  secao_id        UUID REFERENCES sime_secoes(id),
  mesa_pres       INTEGER DEFAULT 0 CHECK(mesa_pres IN (0,1,2)),
  mesa_m1         INTEGER DEFAULT 0 CHECK(mesa_m1 IN (0,1,2)),
  mesa_m2         INTEGER DEFAULT 0 CHECK(mesa_m2 IN (0,1,2)),
  mesa_sec        INTEGER DEFAULT 0 CHECK(mesa_sec IN (0,1,2)),
  zeresima        BOOLEAN DEFAULT false,
  votacao         BOOLEAN DEFAULT false,
  encerrada       BOOLEAN DEFAULT false,
  bu_impresso     BOOLEAN DEFAULT false,
  fila            INTEGER DEFAULT 0,
  panico_energia  BOOLEAN DEFAULT false,
  panico_urna     BOOLEAN DEFAULT false,
  panico_energia_resolvido BOOLEAN DEFAULT false,
  panico_urna_resolvido    BOOLEAN DEFAULT false,
  urna_recolhida  BOOLEAN DEFAULT false,
  urna_cartorio   BOOLEAN DEFAULT false,
  observacao      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      UUID REFERENCES sime_usuarios(id),
  updated_by_origem TEXT,   -- origem da última atualização (ex.: 'hermes_whatsapp'); usado pela API do Hermes
  UNIQUE(eleicao_id, secao_id)
);
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS updated_by_origem TEXT;  -- migração p/ bancos existentes
CREATE INDEX IF NOT EXISTS idx_mesa_eleicao ON sime_mesa_estado(eleicao_id);
CREATE INDEX IF NOT EXISTS idx_mesa_secao ON sime_mesa_estado(secao_id);

-- Fase 4 (JWT de campo): colunas descobertas em falta ao conectar os módulos
-- de campo de verdade — cada uma tinha um fato sendo gravado só em
-- localStorage, sem coluna nenhuma correspondente.
--   urna_entregue*      — SIME_motorista.html, entrega da urna na seção (D-1)
--   urna_recolhida_ts    — timestamp do já existente urna_recolhida (Dia D)
--   urna_cartorio_ts     — timestamp do já existente urna_cartorio (Dia D)
--   material_recolhido  — SIME_mesario.html, campo "mat" (material da eleição recolhido)
--   urna_chegou/posicionada/instalada* — SIME_instalador.html, checklist de véspera
--     (D-1, distinto de urna_entregue do motorista: são confirmações de atores
--     diferentes — motorista confirma que entregou, instalador confirma que
--     recebeu/montou; mantidos como sinais separados, não deduplicados)
--   problema_instalacao* — SIME_instalador.html, problema na instalação da urna
--     em D-1 (distinto de panico_urna, que é do Dia D)
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS urna_entregue BOOLEAN DEFAULT false;
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS urna_entregue_ts TIMESTAMPTZ;
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS urna_recolhida_ts TIMESTAMPTZ;
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS urna_cartorio_ts TIMESTAMPTZ;
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS material_recolhido BOOLEAN DEFAULT false;
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS urna_chegou BOOLEAN DEFAULT false;
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS urna_chegou_ts TIMESTAMPTZ;
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS urna_posicionada BOOLEAN DEFAULT false;
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS urna_posicionada_ts TIMESTAMPTZ;
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS urna_instalada BOOLEAN DEFAULT false;
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS urna_instalada_ts TIMESTAMPTZ;
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS problema_instalacao BOOLEAN DEFAULT false;
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS problema_instalacao_resolvido BOOLEAN DEFAULT false;

-- SOS: pânico genérico do mesário, para qualquer problema que não seja
-- energia nem urna (conflito de fiscais, conflito entre eleitores, fila
-- descontrolada etc.) — o toque não carrega motivo, só o alerta; quem
-- recebe liga pra seção pra entender o que é. Mesmo mecanismo de
-- panico_energia/panico_urna.
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS panico_sos BOOLEAN DEFAULT false;
ALTER TABLE sime_mesa_estado ADD COLUMN IF NOT EXISTS panico_sos_resolvido BOOLEAN DEFAULT false;

-- ------------------------------------------------------------
-- 2. ESTADO DE EMBARQUE DE ROTA (Conferente, D-1)
-- ------------------------------------------------------------
-- Antes da Fase 4 não existia NENHUMA tabela pra isso — SIME_conferente.html
-- só gravava em localStorage (sime_dist_v1). Duas tabelas porque o objeto
-- original mistura duas granularidades: estado agregado da rota (1 linha) e
-- checklist de urna por seção (N linhas) — não dá pra normalizar numa só.
CREATE TABLE IF NOT EXISTS sime_rotas_estado (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eleicao_id      UUID REFERENCES sime_eleicoes(id),
  rota_id         UUID REFERENCES sime_rotas(id),
  status          TEXT NOT NULL DEFAULT 'aguardando'
                  CHECK (status IN ('aguardando','embarcando','pronta','alerta','saiu')),
  conferente_nome TEXT,
  ts_aberta       TIMESTAMPTZ,
  ts_pronta       TIMESTAMPTZ,
  ts_saiu         TIMESTAMPTZ,
  alerta          BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(eleicao_id, rota_id)
);
CREATE INDEX IF NOT EXISTS idx_rotas_estado_eleicao ON sime_rotas_estado(eleicao_id);
CREATE INDEX IF NOT EXISTS idx_rotas_estado_rota    ON sime_rotas_estado(rota_id);

CREATE TABLE IF NOT EXISTS sime_rotas_urnas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rota_estado_id  UUID REFERENCES sime_rotas_estado(id),
  secao_id        UUID REFERENCES sime_secoes(id),
  embarcada       BOOLEAN NOT NULL DEFAULT false,
  embarcada_ts    TIMESTAMPTZ,
  UNIQUE(rota_estado_id, secao_id)
);
CREATE INDEX IF NOT EXISTS idx_rotas_urnas_estado ON sime_rotas_urnas(rota_estado_id);
CREATE INDEX IF NOT EXISTS idx_rotas_urnas_secao  ON sime_rotas_urnas(secao_id);

-- ------------------------------------------------------------
-- 3. MÓDULO DE MÍDIAS
-- ------------------------------------------------------------

-- CREATE TYPE não aceita IF NOT EXISTS — usa bloco DO com captura de duplicidade
DO $$ BEGIN
  CREATE TYPE sime_midia_status AS ENUM (
    'aguardando_encerramento',
    'pronta_para_coleta',
    'em_coleta_rota',
    'coleta_dedicada',
    'coletada',
    'entregue_transmissao'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE sime_tipo_coleta AS ENUM (
    'rota',
    'dedicada',
    'mesario_entrega'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS sime_midias (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eleicao_id          UUID REFERENCES sime_eleicoes(id),
  secao_id            UUID REFERENCES sime_secoes(id),
  rota_id             UUID REFERENCES sime_rotas(id),
  status              sime_midia_status NOT NULL DEFAULT 'aguardando_encerramento',
  pronta_ts           TIMESTAMPTZ,
  em_coleta_ts        TIMESTAMPTZ,
  coletada_ts         TIMESTAMPTZ,
  entregue_ts         TIMESTAMPTZ,
  responsavel_coleta  UUID, -- FK pra sime_atores(id) adicionada por ALTER mais abaixo (tabela ainda não existe aqui)
  tipo_coleta         sime_tipo_coleta,
  observacao          TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by          UUID,
  UNIQUE(eleicao_id, secao_id)
);

CREATE INDEX IF NOT EXISTS idx_midias_eleicao   ON sime_midias(eleicao_id);
CREATE INDEX IF NOT EXISTS idx_midias_secao     ON sime_midias(secao_id);
CREATE INDEX IF NOT EXISTS idx_midias_rota      ON sime_midias(rota_id);
CREATE INDEX IF NOT EXISTS idx_midias_status    ON sime_midias(status);

-- Trigger: atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION update_midia_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_midias_updated_at
  BEFORE UPDATE ON sime_midias
  FOR EACH ROW EXECUTE FUNCTION update_midia_updated_at();

-- ------------------------------------------------------------
-- 4. MÓDULO DE ATORES
-- ------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE sime_ator_funcao AS ENUM (
    'mesario',
    'motorista',
    'tecnico',
    'auxiliar_eleicao',
    'coord_acessibilidade',
    'coord_motoristas',
    'coletor_midias',
    'preposto',
    'cartorio',
    'coordenador_acessibilidade'  -- alias legado (dados antigos)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Migração do enum para bancos já existentes:
--   ALTER TYPE ... ADD VALUE deve rodar fora de bloco transacional.
ALTER TYPE sime_ator_funcao ADD VALUE IF NOT EXISTS 'auxiliar_eleicao';
ALTER TYPE sime_ator_funcao ADD VALUE IF NOT EXISTS 'coord_acessibilidade';
ALTER TYPE sime_ator_funcao ADD VALUE IF NOT EXISTS 'coord_motoristas';
ALTER TYPE sime_ator_funcao ADD VALUE IF NOT EXISTS 'coletor_midias';
ALTER TYPE sime_ator_funcao ADD VALUE IF NOT EXISTS 'preposto';
ALTER TYPE sime_ator_funcao ADD VALUE IF NOT EXISTS 'junta_eleitoral';

CREATE TABLE IF NOT EXISTS sime_atores (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id           UUID REFERENCES sime_zonas(id),
  eleicao_id        UUID REFERENCES sime_eleicoes(id),
  nome_completo     TEXT NOT NULL,
  telefone_whatsapp VARCHAR(20), -- pode faltar no cadastro oficial (TRE); nunca bloquear por isso
  secao_id          UUID REFERENCES sime_secoes(id),
  local_id          UUID,
  funcao            sime_ator_funcao NOT NULL,
  ativo             BOOLEAN NOT NULL DEFAULT true,
  -- Rastreio de permanência na função (verificação pré-eleição):
  -- pendente (default) | confirmado | recusou | substituido
  confirmacao       TEXT NOT NULL DEFAULT 'pendente'
                    CHECK (confirmacao IN ('pendente','confirmado','recusou','substituido')),
  observacao        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID REFERENCES sime_usuarios(id)
);

-- Idempotente para instalações que já criaram sime_atores com telefone_whatsapp NOT NULL:
-- o cadastro oficial do TRE às vezes não tem telefone algum (pessoal nem comercial).
ALTER TABLE sime_atores ALTER COLUMN telefone_whatsapp DROP NOT NULL;

-- Idempotente para instalações que já criaram sime_atores antes desta coluna.
ALTER TABLE sime_atores
  ADD COLUMN IF NOT EXISTS confirmacao TEXT NOT NULL DEFAULT 'pendente';
DO $$ BEGIN
  ALTER TABLE sime_atores ADD CONSTRAINT sime_atores_confirmacao_chk
    CHECK (confirmacao IN ('pendente','confirmado','recusou','substituido'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_atores_zona     ON sime_atores(zona_id);
CREATE INDEX IF NOT EXISTS idx_atores_eleicao  ON sime_atores(eleicao_id);
CREATE INDEX IF NOT EXISTS idx_atores_secao    ON sime_atores(secao_id);
CREATE INDEX IF NOT EXISTS idx_atores_funcao   ON sime_atores(funcao);
-- Busca fuzzy por nome
CREATE INDEX IF NOT EXISTS idx_atores_nome_trgm ON sime_atores USING gin(nome_completo gin_trgm_ops);

-- Garantir telefone único por seção + função + eleição (evitar duplicidade na importação)
CREATE UNIQUE INDEX IF NOT EXISTS idx_atores_unique
  ON sime_atores(eleicao_id, secao_id, telefone_whatsapp, funcao)
  WHERE ativo = true;

-- Chave estável por pessoa+função: permite UPSERT em vez de delete+reinsert a
-- cada nova exportação do TRE. Uma mesma pessoa pode legitimamente ter duas
-- linhas (ex.: mesário E apoio logístico na mesma eleição) — por isso a chave
-- é (inscricao_eleitoral, funcao), não só inscricao_eleitoral. Parcial porque
-- atores fora do fluxo TRE (motorista, técnico, cartório) não têm inscrição.
CREATE UNIQUE INDEX IF NOT EXISTS idx_atores_inscricao_funcao
  ON sime_atores(inscricao_eleitoral, funcao)
  WHERE inscricao_eleitoral IS NOT NULL;

-- sime_midias.responsavel_coleta referencia sime_atores (não sime_usuarios):
-- quem coleta mídia em campo é sempre um ator externo (motorista/técnico
-- convocado), nunca um admin do cartório. Corrigido aqui (não na definição da
-- tabela, lá em cima) porque sime_atores só existe a partir deste ponto do
-- arquivo. Drop+add deixa idempotente mesmo trocando a tabela referenciada.
ALTER TABLE sime_midias DROP CONSTRAINT IF EXISTS sime_midias_responsavel_coleta_fkey;
ALTER TABLE sime_midias ADD CONSTRAINT sime_midias_responsavel_coleta_fkey
  FOREIGN KEY (responsavel_coleta) REFERENCES sime_atores(id);

-- ------------------------------------------------------------
-- 5. LOGS DE AUDITORIA
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sime_logs (
  id          BIGSERIAL PRIMARY KEY,
  acao        TEXT NOT NULL,          -- 'midia_pronta', 'midia_coletada', etc.
  modulo      TEXT NOT NULL,          -- 'mesario', 'midias', 'atores', etc.
  secao_id    UUID REFERENCES sime_secoes(id),
  eleicao_id  UUID REFERENCES sime_eleicoes(id),
  usuario_id  UUID,
  payload     JSONB,                  -- dados extras da ação
  ip          TEXT,
  user_agent  TEXT,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_acao      ON sime_logs(acao);
CREATE INDEX IF NOT EXISTS idx_logs_modulo    ON sime_logs(modulo);
CREATE INDEX IF NOT EXISTS idx_logs_secao     ON sime_logs(secao_id);
CREATE INDEX IF NOT EXISTS idx_logs_eleicao   ON sime_logs(eleicao_id);
CREATE INDEX IF NOT EXISTS idx_logs_ts        ON sime_logs(ts DESC);
-- Logs são append-only: nunca UPDATE nem DELETE

-- Particionamento por mês (recomendado para produção)
-- CREATE TABLE sime_logs_2026_10 PARTITION OF sime_logs
--   FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

-- ------------------------------------------------------------
-- 6. VIEWS ÚTEIS
-- ------------------------------------------------------------

-- Painel de mídias por status
CREATE OR REPLACE VIEW vw_midias_resumo AS
SELECT
  e.id           AS eleicao_id,
  m.status,
  COUNT(*)       AS total,
  MIN(m.updated_at) AS primeira_atualizacao,
  MAX(m.updated_at) AS ultima_atualizacao
FROM sime_midias m
JOIN sime_eleicoes e ON e.id = m.eleicao_id
GROUP BY e.id, m.status;

-- Seções com mídia pendente
CREATE OR REPLACE VIEW vw_midias_pendentes AS
SELECT
  s.numero       AS secao_numero,
  s.local_nome,
  s.municipio,
  m.status,
  m.pronta_ts,
  m.updated_at
FROM sime_midias m
JOIN sime_secoes s ON s.id = m.secao_id
WHERE m.status NOT IN ('coletada','entregue_transmissao')
ORDER BY m.pronta_ts ASC NULLS LAST;

-- Atores por seção (para Modo Guerra)
CREATE OR REPLACE VIEW vw_atores_por_secao AS
SELECT
  s.numero       AS secao_numero,
  s.local_nome,
  a.nome_completo,
  a.telefone_whatsapp,
  a.funcao,
  'https://wa.me/55' || regexp_replace(a.telefone_whatsapp,'\D','','g') AS whatsapp_url
FROM sime_atores a
JOIN sime_secoes s ON s.id = a.secao_id
WHERE a.ativo = true
ORDER BY s.numero, a.funcao;

-- ------------------------------------------------------------
-- 7. RPCs
-- ------------------------------------------------------------

-- RPC: server timestamp (para nunca usar horário do device)

CREATE OR REPLACE FUNCTION sime_now()
RETURNS TIMESTAMPTZ AS $$
  SELECT NOW();
$$ LANGUAGE SQL STABLE;

-- RPC: registrar ação de mídia com server timestamp
CREATE OR REPLACE FUNCTION sime_acao_midia(
  p_secao_id  UUID,
  p_eleicao_id UUID,
  p_status    sime_midia_status,
  p_tipo      sime_tipo_coleta DEFAULT NULL,
  p_resp      UUID DEFAULT NULL,
  p_obs       TEXT DEFAULT NULL
) RETURNS sime_midias AS $$
DECLARE
  v_row sime_midias;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  INSERT INTO sime_midias(eleicao_id, secao_id, status, tipo_coleta, responsavel_coleta, observacao,
    pronta_ts, em_coleta_ts, coletada_ts, entregue_ts, updated_at)
  VALUES (p_eleicao_id, p_secao_id, p_status, p_tipo, p_resp, p_obs,
    CASE WHEN p_status = 'pronta_para_coleta'    THEN v_now ELSE NULL END,
    CASE WHEN p_status = 'em_coleta_rota'        THEN v_now ELSE NULL END,
    CASE WHEN p_status = 'coletada'              THEN v_now ELSE NULL END,
    CASE WHEN p_status = 'entregue_transmissao'  THEN v_now ELSE NULL END,
    v_now)
  ON CONFLICT (eleicao_id, secao_id) DO UPDATE SET
    status              = p_status,
    tipo_coleta         = COALESCE(p_tipo, sime_midias.tipo_coleta),
    responsavel_coleta  = COALESCE(p_resp, sime_midias.responsavel_coleta),
    observacao          = COALESCE(p_obs, sime_midias.observacao),
    pronta_ts    = CASE WHEN p_status = 'pronta_para_coleta'   AND sime_midias.pronta_ts   IS NULL THEN v_now ELSE sime_midias.pronta_ts   END,
    em_coleta_ts = CASE WHEN p_status = 'em_coleta_rota'       AND sime_midias.em_coleta_ts IS NULL THEN v_now ELSE sime_midias.em_coleta_ts END,
    coletada_ts  = CASE WHEN p_status = 'coletada'             AND sime_midias.coletada_ts  IS NULL THEN v_now ELSE sime_midias.coletada_ts  END,
    entregue_ts  = CASE WHEN p_status = 'entregue_transmissao' AND sime_midias.entregue_ts  IS NULL THEN v_now ELSE sime_midias.entregue_ts  END,
    updated_at   = v_now
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- Transmissão de resultados (JE-Connect): distinto da entrega FÍSICA da mídia
-- (status = 'entregue_transmissao' acima). Aqui rastreamos quem é o técnico
-- responsável por transmitir cada seção (matriz nominal, definida antes do
-- dia D) e se a transmissão DIGITAL em si deu certo — a lacuna real de 2024
-- foi não saber quem tinha essa seção e não perceber uma falha de conexão
-- até alguém mandar mensagem avulsa no grupo.
ALTER TABLE sime_midias ADD COLUMN IF NOT EXISTS tecnico_responsavel_id UUID REFERENCES sime_atores(id);
ALTER TABLE sime_midias ADD COLUMN IF NOT EXISTS transmissao_status TEXT NOT NULL DEFAULT 'pendente';
DO $$ BEGIN
  ALTER TABLE sime_midias ADD CONSTRAINT sime_midias_transmissao_status_chk
    CHECK (transmissao_status IN ('pendente','em_andamento','transmitido','falhou'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE sime_midias ADD COLUMN IF NOT EXISTS transmissao_ts  TIMESTAMPTZ;
ALTER TABLE sime_midias ADD COLUMN IF NOT EXISTS transmissao_obs TEXT;
CREATE INDEX IF NOT EXISTS idx_midias_transmissao_status ON sime_midias(transmissao_status);
CREATE INDEX IF NOT EXISTS idx_midias_tecnico ON sime_midias(tecnico_responsavel_id);

-- RPC: atribuir técnico e/ou atualizar status de transmissão. Separada de
-- sime_acao_midia de propósito — não altera a assinatura da RPC de coleta
-- física, que já está em produção.
CREATE OR REPLACE FUNCTION sime_midia_transmissao_upsert(
  p_secao_id    UUID,
  p_eleicao_id  UUID,
  p_tecnico_id         UUID DEFAULT NULL,
  p_transmissao_status TEXT DEFAULT NULL,
  p_transmissao_obs    TEXT DEFAULT NULL
) RETURNS sime_midias AS $$
DECLARE
  v_row sime_midias;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  INSERT INTO sime_midias(eleicao_id, secao_id, tecnico_responsavel_id, transmissao_status,
    transmissao_obs, transmissao_ts, updated_at)
  VALUES (p_eleicao_id, p_secao_id, p_tecnico_id, COALESCE(p_transmissao_status,'pendente'),
    p_transmissao_obs, CASE WHEN p_transmissao_status IS NOT NULL THEN v_now END, v_now)
  ON CONFLICT (eleicao_id, secao_id) DO UPDATE SET
    tecnico_responsavel_id = COALESCE(p_tecnico_id, sime_midias.tecnico_responsavel_id),
    transmissao_status = COALESCE(p_transmissao_status, sime_midias.transmissao_status),
    transmissao_obs = COALESCE(p_transmissao_obs, sime_midias.transmissao_obs),
    -- reflete a ÚLTIMA mudança de status (o status oscila falhou→em_andamento
    -- →transmitido; diferente do padrão "primeira vez" usado em urna_*_ts).
    transmissao_ts = CASE WHEN p_transmissao_status IS NOT NULL THEN v_now ELSE sime_midias.transmissao_ts END,
    updated_at = v_now
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- RPC: ação do Coord. de Acessibilidade (fila/pânico de energia/urna) — Fase 4.
-- Sem RPC dedicada até agora (SIME_acessibilidade.html só gravava em
-- localStorage); parâmetros opcionais (NULL = não mexe) porque a UI sempre
-- atualiza um campo por vez (um botão de fila, ou um toggle de pânico).
CREATE OR REPLACE FUNCTION sime_acao_acessibilidade(
  p_secao_id    UUID,
  p_eleicao_id  UUID,
  p_fila        INTEGER DEFAULT NULL,
  p_panico_energia            BOOLEAN DEFAULT NULL,
  p_panico_urna               BOOLEAN DEFAULT NULL,
  p_panico_energia_resolvido  BOOLEAN DEFAULT NULL,
  p_panico_urna_resolvido     BOOLEAN DEFAULT NULL
) RETURNS sime_mesa_estado AS $$
DECLARE
  v_row sime_mesa_estado;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  INSERT INTO sime_mesa_estado(eleicao_id, secao_id, fila, panico_energia, panico_urna,
    panico_energia_resolvido, panico_urna_resolvido, updated_at, updated_by_origem)
  VALUES (p_eleicao_id, p_secao_id, COALESCE(p_fila, 0), COALESCE(p_panico_energia, false),
    COALESCE(p_panico_urna, false), COALESCE(p_panico_energia_resolvido, false),
    COALESCE(p_panico_urna_resolvido, false), v_now, 'coord_acessibilidade')
  ON CONFLICT (eleicao_id, secao_id) DO UPDATE SET
    fila                      = COALESCE(p_fila, sime_mesa_estado.fila),
    panico_energia            = COALESCE(p_panico_energia, sime_mesa_estado.panico_energia),
    panico_urna               = COALESCE(p_panico_urna, sime_mesa_estado.panico_urna),
    panico_energia_resolvido  = COALESCE(p_panico_energia_resolvido, sime_mesa_estado.panico_energia_resolvido),
    panico_urna_resolvido     = COALESCE(p_panico_urna_resolvido, sime_mesa_estado.panico_urna_resolvido),
    updated_at                = v_now,
    updated_by_origem         = 'coord_acessibilidade'
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- RPC: ação genérica sobre sime_mesa_estado — usada por mesário, motorista e
-- instalador (Fase 4). Parâmetros opcionais (NULL = não mexe) porque cada UI
-- só manda os campos que mudaram naquele toque. As colunas *_ts (urna_entregue,
-- urna_recolhida, urna_cartorio, urna_chegou/posicionada/instalada) só são
-- setadas na PRIMEIRA vez que o booleano correspondente vira true — chamadas
-- seguintes não sobrescrevem o timestamp do evento original.
CREATE OR REPLACE FUNCTION sime_acao_mesa(
  p_secao_id    UUID,
  p_eleicao_id  UUID,
  p_mesa_pres   INTEGER DEFAULT NULL,
  p_mesa_m1     INTEGER DEFAULT NULL,
  p_mesa_m2     INTEGER DEFAULT NULL,
  p_mesa_sec    INTEGER DEFAULT NULL,
  p_zeresima    BOOLEAN DEFAULT NULL,
  p_votacao     BOOLEAN DEFAULT NULL,
  p_encerrada   BOOLEAN DEFAULT NULL,
  p_bu_impresso BOOLEAN DEFAULT NULL,
  p_material_recolhido BOOLEAN DEFAULT NULL,
  p_fila        INTEGER DEFAULT NULL,
  p_panico_energia  BOOLEAN DEFAULT NULL,
  p_panico_urna     BOOLEAN DEFAULT NULL,
  p_panico_energia_resolvido BOOLEAN DEFAULT NULL,
  p_panico_urna_resolvido    BOOLEAN DEFAULT NULL,
  p_panico_sos      BOOLEAN DEFAULT NULL,
  p_panico_sos_resolvido     BOOLEAN DEFAULT NULL,
  p_urna_entregue    BOOLEAN DEFAULT NULL,
  p_urna_recolhida   BOOLEAN DEFAULT NULL,
  p_urna_cartorio    BOOLEAN DEFAULT NULL,
  p_urna_chegou      BOOLEAN DEFAULT NULL,
  p_urna_posicionada BOOLEAN DEFAULT NULL,
  p_urna_instalada   BOOLEAN DEFAULT NULL,
  p_problema_instalacao           BOOLEAN DEFAULT NULL,
  p_problema_instalacao_resolvido BOOLEAN DEFAULT NULL,
  p_observacao  TEXT DEFAULT NULL,
  p_origem      TEXT DEFAULT NULL
) RETURNS sime_mesa_estado AS $$
DECLARE
  v_row sime_mesa_estado;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  INSERT INTO sime_mesa_estado (
    eleicao_id, secao_id, mesa_pres, mesa_m1, mesa_m2, mesa_sec,
    zeresima, votacao, encerrada, bu_impresso, material_recolhido, fila,
    panico_energia, panico_urna, panico_energia_resolvido, panico_urna_resolvido,
    panico_sos, panico_sos_resolvido,
    urna_entregue, urna_entregue_ts, urna_recolhida, urna_recolhida_ts,
    urna_cartorio, urna_cartorio_ts, urna_chegou, urna_chegou_ts,
    urna_posicionada, urna_posicionada_ts, urna_instalada, urna_instalada_ts,
    problema_instalacao, problema_instalacao_resolvido, observacao,
    updated_at, updated_by_origem
  ) VALUES (
    p_eleicao_id, p_secao_id,
    COALESCE(p_mesa_pres,0), COALESCE(p_mesa_m1,0), COALESCE(p_mesa_m2,0), COALESCE(p_mesa_sec,0),
    COALESCE(p_zeresima,false), COALESCE(p_votacao,false), COALESCE(p_encerrada,false), COALESCE(p_bu_impresso,false),
    COALESCE(p_material_recolhido,false), COALESCE(p_fila,0),
    COALESCE(p_panico_energia,false), COALESCE(p_panico_urna,false),
    COALESCE(p_panico_energia_resolvido,false), COALESCE(p_panico_urna_resolvido,false),
    COALESCE(p_panico_sos,false), COALESCE(p_panico_sos_resolvido,false),
    COALESCE(p_urna_entregue,false),    CASE WHEN p_urna_entregue    THEN v_now END,
    COALESCE(p_urna_recolhida,false),   CASE WHEN p_urna_recolhida   THEN v_now END,
    COALESCE(p_urna_cartorio,false),    CASE WHEN p_urna_cartorio    THEN v_now END,
    COALESCE(p_urna_chegou,false),      CASE WHEN p_urna_chegou      THEN v_now END,
    COALESCE(p_urna_posicionada,false), CASE WHEN p_urna_posicionada THEN v_now END,
    COALESCE(p_urna_instalada,false),   CASE WHEN p_urna_instalada   THEN v_now END,
    COALESCE(p_problema_instalacao,false), COALESCE(p_problema_instalacao_resolvido,false), p_observacao,
    v_now, p_origem
  )
  ON CONFLICT (eleicao_id, secao_id) DO UPDATE SET
    mesa_pres = COALESCE(p_mesa_pres, sime_mesa_estado.mesa_pres),
    mesa_m1   = COALESCE(p_mesa_m1, sime_mesa_estado.mesa_m1),
    mesa_m2   = COALESCE(p_mesa_m2, sime_mesa_estado.mesa_m2),
    mesa_sec  = COALESCE(p_mesa_sec, sime_mesa_estado.mesa_sec),
    zeresima  = COALESCE(p_zeresima, sime_mesa_estado.zeresima),
    votacao   = COALESCE(p_votacao, sime_mesa_estado.votacao),
    encerrada = COALESCE(p_encerrada, sime_mesa_estado.encerrada),
    bu_impresso = COALESCE(p_bu_impresso, sime_mesa_estado.bu_impresso),
    material_recolhido = COALESCE(p_material_recolhido, sime_mesa_estado.material_recolhido),
    fila = COALESCE(p_fila, sime_mesa_estado.fila),
    panico_energia = COALESCE(p_panico_energia, sime_mesa_estado.panico_energia),
    panico_urna    = COALESCE(p_panico_urna, sime_mesa_estado.panico_urna),
    panico_energia_resolvido = COALESCE(p_panico_energia_resolvido, sime_mesa_estado.panico_energia_resolvido),
    panico_urna_resolvido    = COALESCE(p_panico_urna_resolvido, sime_mesa_estado.panico_urna_resolvido),
    panico_sos = COALESCE(p_panico_sos, sime_mesa_estado.panico_sos),
    panico_sos_resolvido = COALESCE(p_panico_sos_resolvido, sime_mesa_estado.panico_sos_resolvido),
    urna_entregue    = COALESCE(p_urna_entregue, sime_mesa_estado.urna_entregue),
    urna_entregue_ts = CASE WHEN p_urna_entregue AND sime_mesa_estado.urna_entregue_ts IS NULL THEN v_now ELSE sime_mesa_estado.urna_entregue_ts END,
    urna_recolhida    = COALESCE(p_urna_recolhida, sime_mesa_estado.urna_recolhida),
    urna_recolhida_ts = CASE WHEN p_urna_recolhida AND sime_mesa_estado.urna_recolhida_ts IS NULL THEN v_now ELSE sime_mesa_estado.urna_recolhida_ts END,
    urna_cartorio    = COALESCE(p_urna_cartorio, sime_mesa_estado.urna_cartorio),
    urna_cartorio_ts = CASE WHEN p_urna_cartorio AND sime_mesa_estado.urna_cartorio_ts IS NULL THEN v_now ELSE sime_mesa_estado.urna_cartorio_ts END,
    urna_chegou    = COALESCE(p_urna_chegou, sime_mesa_estado.urna_chegou),
    urna_chegou_ts = CASE WHEN p_urna_chegou AND sime_mesa_estado.urna_chegou_ts IS NULL THEN v_now ELSE sime_mesa_estado.urna_chegou_ts END,
    urna_posicionada    = COALESCE(p_urna_posicionada, sime_mesa_estado.urna_posicionada),
    urna_posicionada_ts = CASE WHEN p_urna_posicionada AND sime_mesa_estado.urna_posicionada_ts IS NULL THEN v_now ELSE sime_mesa_estado.urna_posicionada_ts END,
    urna_instalada    = COALESCE(p_urna_instalada, sime_mesa_estado.urna_instalada),
    urna_instalada_ts = CASE WHEN p_urna_instalada AND sime_mesa_estado.urna_instalada_ts IS NULL THEN v_now ELSE sime_mesa_estado.urna_instalada_ts END,
    problema_instalacao = COALESCE(p_problema_instalacao, sime_mesa_estado.problema_instalacao),
    problema_instalacao_resolvido = COALESCE(p_problema_instalacao_resolvido, sime_mesa_estado.problema_instalacao_resolvido),
    observacao = COALESCE(p_observacao, sime_mesa_estado.observacao),
    updated_at = v_now,
    updated_by_origem = COALESCE(p_origem, sime_mesa_estado.updated_by_origem)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- RPC: upsert do estado de embarque de uma rota (Conferente de Embarque —
-- Fase 4). ts_aberta/ts_pronta/ts_saiu só são setados na PRIMEIRA vez que o
-- booleano correspondente vira true (mesmo padrão de sime_acao_mesa). Retorna
-- a linha inteira porque o client precisa do `id` gerado como FK ao gravar em
-- sime_rotas_urnas logo em seguida.
CREATE OR REPLACE FUNCTION sime_rota_estado_upsert(
  p_eleicao_id UUID,
  p_rota_id    UUID,
  p_status     TEXT DEFAULT NULL,
  p_conferente_nome TEXT DEFAULT NULL,
  p_ts_aberta  BOOLEAN DEFAULT NULL,
  p_ts_pronta  BOOLEAN DEFAULT NULL,
  p_ts_saiu    BOOLEAN DEFAULT NULL,
  p_alerta     BOOLEAN DEFAULT NULL
) RETURNS sime_rotas_estado AS $$
DECLARE
  v_row sime_rotas_estado;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  INSERT INTO sime_rotas_estado (eleicao_id, rota_id, status, conferente_nome,
    ts_aberta, ts_pronta, ts_saiu, alerta, updated_at)
  VALUES (p_eleicao_id, p_rota_id, COALESCE(p_status, 'aguardando'), p_conferente_nome,
    CASE WHEN p_ts_aberta THEN v_now END, CASE WHEN p_ts_pronta THEN v_now END,
    CASE WHEN p_ts_saiu THEN v_now END, COALESCE(p_alerta, false), v_now)
  ON CONFLICT (eleicao_id, rota_id) DO UPDATE SET
    status          = COALESCE(p_status, sime_rotas_estado.status),
    conferente_nome = COALESCE(p_conferente_nome, sime_rotas_estado.conferente_nome),
    ts_aberta = CASE WHEN p_ts_aberta AND sime_rotas_estado.ts_aberta IS NULL THEN v_now ELSE sime_rotas_estado.ts_aberta END,
    ts_pronta = CASE WHEN p_ts_pronta AND sime_rotas_estado.ts_pronta IS NULL THEN v_now ELSE sime_rotas_estado.ts_pronta END,
    ts_saiu   = CASE WHEN p_ts_saiu   AND sime_rotas_estado.ts_saiu   IS NULL THEN v_now ELSE sime_rotas_estado.ts_saiu   END,
    alerta    = COALESCE(p_alerta, sime_rotas_estado.alerta),
    updated_at = v_now
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- RPC: toggle de uma urna dentro do embarque de uma rota — Fase 4. Diferente
-- das colunas *_ts de sime_acao_mesa (evento irreversível), embarque de urna
-- é um toggle real (o conferente pode desmarcar por engano) — o timestamp
-- reflete sempre a ÚLTIMA marcação como embarcada, não a primeira.
CREATE OR REPLACE FUNCTION sime_rota_urna_toggle(
  p_rota_estado_id UUID,
  p_secao_id       UUID,
  p_embarcada      BOOLEAN
) RETURNS sime_rotas_urnas AS $$
DECLARE
  v_row sime_rotas_urnas;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  INSERT INTO sime_rotas_urnas (rota_estado_id, secao_id, embarcada, embarcada_ts)
  VALUES (p_rota_estado_id, p_secao_id, p_embarcada, CASE WHEN p_embarcada THEN v_now END)
  ON CONFLICT (rota_estado_id, secao_id) DO UPDATE SET
    embarcada    = p_embarcada,
    embarcada_ts = CASE WHEN p_embarcada THEN v_now ELSE NULL END
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- RPC: importar ator via CSV (valida duplicidade)
CREATE OR REPLACE FUNCTION sime_importar_ator(
  p_zona_id     UUID,
  p_eleicao_id  UUID,
  p_nome        TEXT,
  p_telefone    TEXT,
  p_secao_num   INTEGER,
  p_funcao      sime_ator_funcao,
  p_created_by  UUID DEFAULT NULL
) RETURNS sime_atores AS $$
DECLARE
  v_secao_id UUID;
  v_row      sime_atores;
  v_tel      TEXT;
BEGIN
  -- Limpar telefone (apenas dígitos)
  v_tel := regexp_replace(p_telefone, '\D', '', 'g');
  
  -- Validar telefone (10 ou 11 dígitos)
  IF length(v_tel) NOT BETWEEN 10 AND 11 THEN
    RAISE EXCEPTION 'Telefone inválido: %', p_telefone;
  END IF;
  
  -- Buscar secao_id pelo número
  SELECT id INTO v_secao_id FROM sime_secoes
    WHERE zona_id = p_zona_id AND numero = p_secao_num LIMIT 1;
  IF v_secao_id IS NULL THEN
    RAISE EXCEPTION 'Seção % não encontrada', p_secao_num;
  END IF;
  
  -- Inserir ou ignorar duplicata
  INSERT INTO sime_atores(zona_id, eleicao_id, nome_completo, telefone_whatsapp, secao_id, funcao, created_by)
  VALUES (p_zona_id, p_eleicao_id, p_nome, v_tel, v_secao_id, p_funcao, p_created_by)
  ON CONFLICT (eleicao_id, secao_id, telefone_whatsapp, funcao) WHERE ativo = true
  DO UPDATE SET nome_completo = p_nome, updated_at = NOW()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- Sincroniza sime_atores a partir de sime_mesarios_raw (staging, recarregável
-- a qualquer momento) via UPSERT por inscricao_eleitoral+funcao — substitui o
-- padrão anterior de "DELETE da zona + INSERT do zero", que recriava UUIDs a
-- cada carga e quebraria referências (sime_campanhas_confirmacao.ator_id,
-- sime_notificacoes) assim que existissem. Preserva sempre confirmacao/
-- status_convocacao/whatsapp_* — não fazem parte do SET do upsert. Quem sai
-- da nova exportação (substituído de verdade) vira ativo=false, não é
-- apagado — mantém histórico e não quebra FK.
CREATE OR REPLACE FUNCTION sime_sync_atores_from_raw(p_zona_numero INT, p_uf TEXT DEFAULT 'PI')
RETURNS TABLE(atualizados INT, inativados INT) AS $$
DECLARE
  v_zona_id UUID;
  v_eleicao_id UUID;
  v_atualizados INT;
  v_inativados INT;
BEGIN
  SELECT id INTO v_zona_id FROM sime_zonas WHERE numero = p_zona_numero AND estado = p_uf;
  IF v_zona_id IS NULL THEN
    RAISE EXCEPTION 'Zona % / % não encontrada em sime_zonas', p_zona_numero, p_uf;
  END IF;
  SELECT id INTO v_eleicao_id FROM sime_eleicoes WHERE zona_id = v_zona_id AND turno = 1 LIMIT 1;

  WITH fonte AS (
    -- dedup defensivo: se a exportação do TRE algum dia trouxer a mesma
    -- pessoa+função duas vezes no mesmo arquivo, o upsert não pode processar
    -- o mesmo conflito 2x numa única instrução (erro do Postgres) — fica só
    -- a primeira ocorrência.
    SELECT r.*,
      CASE
        WHEN r.tipo_registro = 'MRV' THEN 'mesario'::sime_ator_funcao
        WHEN r.tipo_registro = 'AL' AND r.descricao_funcao_eleitoral = 'Coordenador de Acessibilidade' THEN 'coord_acessibilidade'::sime_ator_funcao
        ELSE 'auxiliar_eleicao'::sime_ator_funcao
      END AS funcao_calc,
      ROW_NUMBER() OVER (
        PARTITION BY r.inscricao,
          CASE
            WHEN r.tipo_registro = 'MRV' THEN 'mesario'
            WHEN r.tipo_registro = 'AL' AND r.descricao_funcao_eleitoral = 'Coordenador de Acessibilidade' THEN 'coord_acessibilidade'
            ELSE 'auxiliar_eleicao'
          END
        ORDER BY r.id
      ) AS rn
    FROM sime_mesarios_raw r
    WHERE r.zona_eleitoral_trabalho = p_zona_numero::text
      AND r.uf_trabalho = p_uf
      AND r.tipo_registro IN ('MRV', 'AL')
  ),
  upsert AS (
    INSERT INTO sime_atores (
      zona_id, eleicao_id, nome_completo, telefone_whatsapp, secao_id,
      funcao, funcao_mesa, inscricao_eleitoral, fonte_contato, ativo
    )
    SELECT
      v_zona_id, v_eleicao_id, f.nome_civil,
      COALESCE(
        NULLIF(regexp_replace(f.telefone_pessoal_mesario, '\D', '', 'g'), ''),
        NULLIF(regexp_replace(f.telefone_1_eleitor, '\D', '', 'g'), ''),
        NULLIF(regexp_replace(f.telefone_2_eleitor, '\D', '', 'g'), ''),
        NULLIF(regexp_replace(f.telefone_contato_eleitor, '\D', '', 'g'), '')
      ),
      s.id,
      f.funcao_calc,
      CASE WHEN f.tipo_registro = 'MRV' THEN f.descricao_funcao_eleitoral ELSE NULL END,
      f.inscricao,
      'sistema_2026',
      true
    FROM fonte f
    LEFT JOIN sime_secoes s
      ON s.zona_id = v_zona_id
      AND s.numero = NULLIF(f.secao_local_trabalho, '')::int
      -- lower(), não initcap(): initcap('JATOBÁ DO PIAUÍ') vira 'Jatobá Do
      -- Piauí' (capitaliza o conectivo "Do"), mas sime_secoes.municipio
      -- grava 'Jatobá do Piauí' (minúsculo) — o join nunca casava pra esse
      -- município, e o mesário entrava em sime_atores sem secao_id (função
      -- ficava certa, só a seção que sumia). lower() em ambos os lados não
      -- tem esse problema com conectivos em português.
      AND lower(s.municipio) = lower(f.nome_municipio_local_trabalho)
    WHERE f.rn = 1
    ON CONFLICT (inscricao_eleitoral, funcao) WHERE inscricao_eleitoral IS NOT NULL
    DO UPDATE SET
      nome_completo     = EXCLUDED.nome_completo,
      telefone_whatsapp = EXCLUDED.telefone_whatsapp,
      secao_id          = EXCLUDED.secao_id,
      funcao_mesa       = EXCLUDED.funcao_mesa,
      zona_id           = EXCLUDED.zona_id,
      eleicao_id        = EXCLUDED.eleicao_id,
      ativo             = true
    RETURNING sime_atores.id
  )
  SELECT count(*) INTO v_atualizados FROM upsert;

  WITH inativados AS (
    UPDATE sime_atores a
    SET ativo = false
    WHERE a.zona_id = v_zona_id
      AND a.funcao IN ('mesario', 'coord_acessibilidade', 'auxiliar_eleicao')
      AND a.inscricao_eleitoral IS NOT NULL
      AND a.ativo = true
      AND NOT EXISTS (
        SELECT 1 FROM sime_mesarios_raw r
        WHERE r.inscricao = a.inscricao_eleitoral
          AND r.zona_eleitoral_trabalho = p_zona_numero::text
          AND r.uf_trabalho = p_uf
          AND r.tipo_registro IN ('MRV', 'AL')
      )
    RETURNING a.id
  )
  SELECT count(*) INTO v_inativados FROM inativados;

  RETURN QUERY SELECT v_atualizados, v_inativados;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ------------------------------------------------------------
-- 8. RLS (Row Level Security) — produção
-- Filosofia #8: "RLS sempre ativo — usuário só lê/escreve dados da sua zona".
--
-- Escopo: protege o acesso AUTENTICADO (admins do cartório via Supabase Auth).
-- O acesso de campo (mesário/motorista/etc. via QR Code + PIN, sem auth.uid())
-- é feito por Edge Function/API com service_role, que ignora RLS por design.
-- ------------------------------------------------------------

-- Helper: zona do usuário autenticado.
-- SECURITY DEFINER + search_path fixo evita recursão de RLS quando as próprias
-- políticas consultam sime_usuarios (que também tem RLS habilitado).
-- Casa por auth_user_id (não por id): o UUID interno do registro em sime_usuarios
-- é independente do "sub" do JWT, porque nem toda sessão vem de auth.users (login
-- de senha do Admin sim; token de TV e, na Fase 4, token de campo são JWT assinados
-- manualmente por sime-login, sem usuário real em auth.users).
CREATE OR REPLACE FUNCTION sime_user_zona()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT zona_id FROM sime_usuarios WHERE auth_user_id = auth.uid();
$$;

-- Helper: usuário autenticado é super_admin (enxerga todas as zonas).
-- Mesmo padrão de sime_user_zona() — SECURITY DEFINER evita recursão de RLS.
CREATE OR REPLACE FUNCTION sime_is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM sime_usuarios WHERE auth_user_id = auth.uid() AND perfil = 'super_admin' AND ativo
  );
$$;

-- Predicado único de visibilidade por zona: usado em toda política RLS abaixo,
-- em vez de espalhar "OR sime_is_super_admin()" em cada uma. Mudar quem enxerga
-- o quê (ex.: um futuro perfil de auditor cross-zona) passa a tocar só esta função.
CREATE OR REPLACE FUNCTION sime_zona_visivel(p_zona_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_zona_id = sime_user_zona() OR sime_is_super_admin();
$$;

-- Habilita RLS em todas as tabelas com dados de zona
ALTER TABLE sime_zonas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sime_secoes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sime_rotas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sime_eleicoes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sime_empresas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sime_usuarios    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sime_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sime_mesa_estado ENABLE ROW LEVEL SECURITY;
ALTER TABLE sime_midias      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sime_atores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sime_logs        ENABLE ROW LEVEL SECURITY;

-- ── Tabelas com zona_id direto (a própria zona é o id em sime_zonas) ──
DROP POLICY IF EXISTS zonas_zona_policy ON sime_zonas;
CREATE POLICY zonas_zona_policy ON sime_zonas
  FOR ALL USING (sime_zona_visivel(id)) WITH CHECK (sime_zona_visivel(id));

DROP POLICY IF EXISTS secoes_zona_policy ON sime_secoes;
CREATE POLICY secoes_zona_policy ON sime_secoes
  FOR ALL USING (sime_zona_visivel(zona_id)) WITH CHECK (sime_zona_visivel(zona_id));

DROP POLICY IF EXISTS rotas_zona_policy ON sime_rotas;
CREATE POLICY rotas_zona_policy ON sime_rotas
  FOR ALL USING (sime_zona_visivel(zona_id)) WITH CHECK (sime_zona_visivel(zona_id));

DROP POLICY IF EXISTS eleicoes_zona_policy ON sime_eleicoes;
CREATE POLICY eleicoes_zona_policy ON sime_eleicoes
  FOR ALL USING (sime_zona_visivel(zona_id)) WITH CHECK (sime_zona_visivel(zona_id));

DROP POLICY IF EXISTS empresas_zona_policy ON sime_empresas;
CREATE POLICY empresas_zona_policy ON sime_empresas
  FOR ALL USING (sime_zona_visivel(zona_id)) WITH CHECK (sime_zona_visivel(zona_id));

DROP POLICY IF EXISTS usuarios_zona_policy ON sime_usuarios;
CREATE POLICY usuarios_zona_policy ON sime_usuarios
  FOR ALL USING (sime_zona_visivel(zona_id)) WITH CHECK (sime_zona_visivel(zona_id));

DROP POLICY IF EXISTS atores_zona_policy ON sime_atores;
CREATE POLICY atores_zona_policy ON sime_atores
  FOR ALL USING (sime_zona_visivel(zona_id)) WITH CHECK (sime_zona_visivel(zona_id));

-- ── Tabelas ligadas à zona via eleicao_id → sime_eleicoes ──
DROP POLICY IF EXISTS tokens_zona_policy ON sime_tokens;
CREATE POLICY tokens_zona_policy ON sime_tokens
  FOR ALL USING     (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE sime_zona_visivel(zona_id)))
          WITH CHECK (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE sime_zona_visivel(zona_id)));

DROP POLICY IF EXISTS mesa_zona_policy ON sime_mesa_estado;
CREATE POLICY mesa_zona_policy ON sime_mesa_estado
  FOR ALL USING     (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE sime_zona_visivel(zona_id)))
          WITH CHECK (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE sime_zona_visivel(zona_id)));

DROP POLICY IF EXISTS midias_zona_policy ON sime_midias;
CREATE POLICY midias_zona_policy ON sime_midias
  FOR ALL USING     (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE sime_zona_visivel(zona_id)))
          WITH CHECK (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE sime_zona_visivel(zona_id)));

ALTER TABLE sime_rotas_estado ENABLE ROW LEVEL SECURITY;
ALTER TABLE sime_rotas_urnas  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rotas_estado_zona_policy ON sime_rotas_estado;
CREATE POLICY rotas_estado_zona_policy ON sime_rotas_estado
  FOR ALL USING     (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE sime_zona_visivel(zona_id)))
          WITH CHECK (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE sime_zona_visivel(zona_id)));

-- sime_rotas_urnas não tem eleicao_id direto — sobe até sime_rotas_estado pra
-- checar a zona (mesmo raciocínio de sime_tokens/sime_mesa_estado, um nível a mais).
DROP POLICY IF EXISTS rotas_urnas_zona_policy ON sime_rotas_urnas;
CREATE POLICY rotas_urnas_zona_policy ON sime_rotas_urnas
  FOR ALL USING (rota_estado_id IN (
    SELECT re.id FROM sime_rotas_estado re
    JOIN sime_eleicoes e ON e.id = re.eleicao_id
    WHERE sime_zona_visivel(e.zona_id)
  ))
  WITH CHECK (rota_estado_id IN (
    SELECT re.id FROM sime_rotas_estado re
    JOIN sime_eleicoes e ON e.id = re.eleicao_id
    WHERE sime_zona_visivel(e.zona_id)
  ));

-- ── Logs: append-only (INSERT livre p/ autenticados; SELECT por zona; nunca UPDATE/DELETE) ──
DROP POLICY IF EXISTS logs_insert_policy ON sime_logs;
CREATE POLICY logs_insert_policy ON sime_logs FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS logs_select_policy ON sime_logs;
CREATE POLICY logs_select_policy ON sime_logs FOR SELECT
  USING (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE sime_zona_visivel(zona_id)));

-- ------------------------------------------------------------
-- 9. DADOS INICIAIS (seed) — 7ª Zona Piauí
-- ------------------------------------------------------------

-- Zona
INSERT INTO sime_zonas(numero, municipio) VALUES (7, 'Campo Maior') ON CONFLICT DO NOTHING;

-- (Inserção das 174 seções e 12 rotas via script de seed separado)
