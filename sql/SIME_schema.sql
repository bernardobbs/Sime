-- ============================================================
-- SIME — Schema SQL Completo para Supabase (PostgreSQL)
-- Inclui: módulos base + Mídias + Atores + Logs
-- ============================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- busca fuzzy

-- ------------------------------------------------------------
-- TABELAS BASE (já documentadas na arquitetura)
-- ------------------------------------------------------------

-- Zonas eleitorais
CREATE TABLE IF NOT EXISTS sime_zonas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero      INTEGER NOT NULL,
  municipio   TEXT NOT NULL,
  estado      CHAR(2) NOT NULL DEFAULT 'PI',
  ativo       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seções eleitorais
CREATE TABLE IF NOT EXISTS sime_secoes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id     UUID REFERENCES sime_zonas(id),
  numero      INTEGER NOT NULL,
  local_nome  TEXT NOT NULL,
  municipio   TEXT NOT NULL,
  eleitores   INTEGER,
  ativo       BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX idx_secoes_zona ON sime_secoes(zona_id);
CREATE INDEX idx_secoes_numero ON sime_secoes(numero);

-- Rotas de distribuição
CREATE TABLE IF NOT EXISTS sime_rotas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id     UUID REFERENCES sime_zonas(id),
  codigo      VARCHAR(3) NOT NULL, -- '001' a '012'
  nome        TEXT NOT NULL,
  municipios  TEXT[],
  ativo       BOOLEAN NOT NULL DEFAULT true
);

-- Empresas contratadas (motoristas terceirizados)
CREATE TABLE IF NOT EXISTS sime_empresas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id     UUID REFERENCES sime_zonas(id),
  nome        TEXT NOT NULL,
  rotas       UUID[],  -- rotas atribuídas à empresa (sime_rotas.id)
  ativo       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_empresas_zona ON sime_empresas(zona_id);

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

-- Usuários administrativos
CREATE TABLE IF NOT EXISTS sime_usuarios (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id     UUID REFERENCES sime_zonas(id),
  nome        TEXT NOT NULL,
  email       TEXT UNIQUE,
  perfil      TEXT NOT NULL CHECK(perfil IN (
                'coordenador','monitor','gestor_prob','gestor_dist','observador',
                'coord_motoristas','coord_acessibilidade','coletor_midias')),
  empresa_id  UUID REFERENCES sime_empresas(id),  -- Coord. de Motoristas (preposto): só vê rotas da empresa
  local_id    UUID,                               -- Coord. de Acessibilidade: só vê seções do local
  ativo       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migração para bancos já existentes (colunas + novos perfis)
ALTER TABLE sime_usuarios ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES sime_empresas(id);
ALTER TABLE sime_usuarios ADD COLUMN IF NOT EXISTS local_id UUID;
ALTER TABLE sime_usuarios DROP CONSTRAINT IF EXISTS sime_usuarios_perfil_check;
ALTER TABLE sime_usuarios ADD CONSTRAINT sime_usuarios_perfil_check CHECK (perfil IN (
  'coordenador','monitor','gestor_prob','gestor_dist','observador',
  'coord_motoristas','coord_acessibilidade','coletor_midias'));

-- Tokens de acesso para operadores de campo
CREATE TABLE IF NOT EXISTS sime_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eleicao_id  UUID REFERENCES sime_eleicoes(id),
  usuario_id  UUID REFERENCES sime_usuarios(id),
  token       VARCHAR(8) NOT NULL UNIQUE,
  pin         VARCHAR(4) NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'conferente', -- 'conferente' | 'coord_acessibilidade' | ...
  rotas       TEXT[],   -- escopo por rota (conferente/motorista)
  local_id    UUID,     -- escopo por local (coord_acessibilidade)
  local_nome  TEXT,     -- nome do local (exibição no módulo de campo)
  expira_em   TIMESTAMPTZ,
  usado_em    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migração para bancos já existentes
ALTER TABLE sime_tokens ADD COLUMN IF NOT EXISTS tipo       TEXT NOT NULL DEFAULT 'conferente';
ALTER TABLE sime_tokens ADD COLUMN IF NOT EXISTS local_id   UUID;
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
  UNIQUE(eleicao_id, secao_id)
);
CREATE INDEX idx_mesa_eleicao ON sime_mesa_estado(eleicao_id);
CREATE INDEX idx_mesa_secao ON sime_mesa_estado(secao_id);

-- ------------------------------------------------------------
-- NOVO: MÓDULO DE MÍDIAS
-- ------------------------------------------------------------

CREATE TYPE sime_midia_status AS ENUM (
  'aguardando_encerramento',
  'pronta_para_coleta',
  'em_coleta_rota',
  'coleta_dedicada',
  'coletada',
  'entregue_transmissao'
);

CREATE TYPE sime_tipo_coleta AS ENUM (
  'rota',
  'dedicada',
  'mesario_entrega'
);

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
  responsavel_coleta  UUID REFERENCES sime_usuarios(id),
  tipo_coleta         sime_tipo_coleta,
  observacao          TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by          UUID,
  UNIQUE(eleicao_id, secao_id)
);

CREATE INDEX idx_midias_eleicao   ON sime_midias(eleicao_id);
CREATE INDEX idx_midias_secao     ON sime_midias(secao_id);
CREATE INDEX idx_midias_rota      ON sime_midias(rota_id);
CREATE INDEX idx_midias_status    ON sime_midias(status);

-- Trigger: atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION update_midia_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_midias_updated_at
  BEFORE UPDATE ON sime_midias
  FOR EACH ROW EXECUTE FUNCTION update_midia_updated_at();

-- ------------------------------------------------------------
-- NOVO: MÓDULO DE ATORES
-- ------------------------------------------------------------

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

-- Migração do enum para bancos já existentes:
--   ALTER TYPE ... ADD VALUE deve rodar fora de bloco transacional.
ALTER TYPE sime_ator_funcao ADD VALUE IF NOT EXISTS 'auxiliar_eleicao';
ALTER TYPE sime_ator_funcao ADD VALUE IF NOT EXISTS 'coord_acessibilidade';
ALTER TYPE sime_ator_funcao ADD VALUE IF NOT EXISTS 'coord_motoristas';
ALTER TYPE sime_ator_funcao ADD VALUE IF NOT EXISTS 'coletor_midias';
ALTER TYPE sime_ator_funcao ADD VALUE IF NOT EXISTS 'preposto';

CREATE TABLE IF NOT EXISTS sime_atores (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id           UUID REFERENCES sime_zonas(id),
  eleicao_id        UUID REFERENCES sime_eleicoes(id),
  nome_completo     TEXT NOT NULL,
  telefone_whatsapp VARCHAR(20) NOT NULL,
  secao_id          UUID REFERENCES sime_secoes(id),
  local_id          UUID,
  funcao            sime_ator_funcao NOT NULL,
  ativo             BOOLEAN NOT NULL DEFAULT true,
  observacao        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID REFERENCES sime_usuarios(id)
);

CREATE INDEX idx_atores_zona     ON sime_atores(zona_id);
CREATE INDEX idx_atores_eleicao  ON sime_atores(eleicao_id);
CREATE INDEX idx_atores_secao    ON sime_atores(secao_id);
CREATE INDEX idx_atores_funcao   ON sime_atores(funcao);
-- Busca fuzzy por nome
CREATE INDEX idx_atores_nome_trgm ON sime_atores USING gin(nome_completo gin_trgm_ops);

-- Garantir telefone único por seção + função + eleição (evitar duplicidade na importação)
CREATE UNIQUE INDEX idx_atores_unique 
  ON sime_atores(eleicao_id, secao_id, telefone_whatsapp, funcao)
  WHERE ativo = true;

-- ------------------------------------------------------------
-- NOVO: LOGS DE AUDITORIA
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

CREATE INDEX idx_logs_acao      ON sime_logs(acao);
CREATE INDEX idx_logs_modulo    ON sime_logs(modulo);
CREATE INDEX idx_logs_secao     ON sime_logs(secao_id);
CREATE INDEX idx_logs_eleicao   ON sime_logs(eleicao_id);
CREATE INDEX idx_logs_ts        ON sime_logs(ts DESC);
-- Logs são append-only: nunca UPDATE nem DELETE

-- Particionamento por mês (recomendado para produção)
-- CREATE TABLE sime_logs_2026_10 PARTITION OF sime_logs
--   FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

-- ------------------------------------------------------------
-- VIEWS ÚTEIS
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
-- RPC: server timestamp (para nunca usar horário do device)
-- ------------------------------------------------------------

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

-- ------------------------------------------------------------
-- RLS (Row Level Security) — produção
-- Filosofia #8: "RLS sempre ativo — usuário só lê/escreve dados da sua zona".
--
-- Escopo: protege o acesso AUTENTICADO (admins do cartório via Supabase Auth).
-- O acesso de campo (mesário/motorista/etc. via QR Code + PIN, sem auth.uid())
-- é feito por Edge Function/API com service_role, que ignora RLS por design.
-- ------------------------------------------------------------

-- Helper: zona do usuário autenticado.
-- SECURITY DEFINER + search_path fixo evita recursão de RLS quando as próprias
-- políticas consultam sime_usuarios (que também tem RLS habilitado).
CREATE OR REPLACE FUNCTION sime_user_zona()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT zona_id FROM sime_usuarios WHERE id = auth.uid();
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
  FOR ALL USING (id = sime_user_zona()) WITH CHECK (id = sime_user_zona());

DROP POLICY IF EXISTS secoes_zona_policy ON sime_secoes;
CREATE POLICY secoes_zona_policy ON sime_secoes
  FOR ALL USING (zona_id = sime_user_zona()) WITH CHECK (zona_id = sime_user_zona());

DROP POLICY IF EXISTS rotas_zona_policy ON sime_rotas;
CREATE POLICY rotas_zona_policy ON sime_rotas
  FOR ALL USING (zona_id = sime_user_zona()) WITH CHECK (zona_id = sime_user_zona());

DROP POLICY IF EXISTS eleicoes_zona_policy ON sime_eleicoes;
CREATE POLICY eleicoes_zona_policy ON sime_eleicoes
  FOR ALL USING (zona_id = sime_user_zona()) WITH CHECK (zona_id = sime_user_zona());

DROP POLICY IF EXISTS empresas_zona_policy ON sime_empresas;
CREATE POLICY empresas_zona_policy ON sime_empresas
  FOR ALL USING (zona_id = sime_user_zona()) WITH CHECK (zona_id = sime_user_zona());

DROP POLICY IF EXISTS usuarios_zona_policy ON sime_usuarios;
CREATE POLICY usuarios_zona_policy ON sime_usuarios
  FOR ALL USING (zona_id = sime_user_zona()) WITH CHECK (zona_id = sime_user_zona());

DROP POLICY IF EXISTS atores_zona_policy ON sime_atores;
CREATE POLICY atores_zona_policy ON sime_atores
  FOR ALL USING (zona_id = sime_user_zona()) WITH CHECK (zona_id = sime_user_zona());

-- ── Tabelas ligadas à zona via eleicao_id → sime_eleicoes ──
DROP POLICY IF EXISTS tokens_zona_policy ON sime_tokens;
CREATE POLICY tokens_zona_policy ON sime_tokens
  FOR ALL USING     (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE zona_id = sime_user_zona()))
          WITH CHECK (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE zona_id = sime_user_zona()));

DROP POLICY IF EXISTS mesa_zona_policy ON sime_mesa_estado;
CREATE POLICY mesa_zona_policy ON sime_mesa_estado
  FOR ALL USING     (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE zona_id = sime_user_zona()))
          WITH CHECK (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE zona_id = sime_user_zona()));

DROP POLICY IF EXISTS midias_zona_policy ON sime_midias;
CREATE POLICY midias_zona_policy ON sime_midias
  FOR ALL USING     (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE zona_id = sime_user_zona()))
          WITH CHECK (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE zona_id = sime_user_zona()));

-- ── Logs: append-only (INSERT livre p/ autenticados; SELECT por zona; nunca UPDATE/DELETE) ──
DROP POLICY IF EXISTS logs_insert_policy ON sime_logs;
CREATE POLICY logs_insert_policy ON sime_logs FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS logs_select_policy ON sime_logs;
CREATE POLICY logs_select_policy ON sime_logs FOR SELECT
  USING (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE zona_id = sime_user_zona()));

-- ------------------------------------------------------------
-- DADOS INICIAIS (seed) — 7ª Zona Piauí
-- ------------------------------------------------------------

-- Zona
INSERT INTO sime_zonas(numero, municipio) VALUES (7, 'Campo Maior') ON CONFLICT DO NOTHING;

-- (Inserção das 174 seções e 12 rotas via script de seed separado)
