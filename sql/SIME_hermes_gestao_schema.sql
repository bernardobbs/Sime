-- ============================================================
-- SIME — SQL: gestão do Hermes Agent (versão, heartbeat, atualização remota)
--
-- Ponto de partida da "Proposta de Evolução do Hermes Agent" (04/08/2026):
-- trazer o runtime do Raspberry Pi para dentro do repo, com heartbeat e
-- atualização controlada pelo SIME.
--
-- Decisão de design (revisada 04/08/2026): o Hermes fala com estas tabelas
-- só através de api/hermes-heartbeat.js, nunca com UPSERT direto usando
-- SUPABASE_SERVICE_KEY. Motivo: desde 03/08/2026 index.js não fala mais com
-- o Supabase direto (ver hermes/HERMES_RUNTIME.md, seção 3) — foi corrigido
-- depois de um bug real de escrita com coluna errada quando o Hermes escrevia
-- em sime_atores sem passar pelo endpoint. Este schema foi desenhado
-- originalmente para acesso direto (primeira versão deste comentário), antes
-- dessa correção ficar documentada; manter aqui o porquê da mudança, para não
-- reintroduzirem o mesmo erro.
--
-- O SIME nunca EMPURRA comando pro Hermes (mesmo problema de sempre: Pi atrás
-- de NAT, sem endereço público). Pedir atualização é: o admin marca
-- atualizar_agora=true numa linha de sime_componentes; o Hermes, no próprio
-- ciclo de heartbeat, vê o pedido e decide se atende.
-- ============================================================

-- ── sime_componentes: versão instalada x versão desejada, por zona ────────
CREATE TABLE IF NOT EXISTS sime_componentes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id           UUID NOT NULL REFERENCES sime_zonas(id) ON DELETE CASCADE,
  componente        TEXT NOT NULL DEFAULT 'hermes',
  versao_instalada  TEXT,             -- o que o Hermes reportou por último
  commit_instalado  TEXT,             -- hash curto do commit rodando
  versao_desejada   TEXT,             -- o que o admin quer (release/tag do GitHub)
  atualizar_agora   BOOLEAN NOT NULL DEFAULT false,  -- pedido pendente de atender
  solicitado_por    UUID REFERENCES sime_usuarios(id),
  solicitado_em     TIMESTAMPTZ,
  atualizado_em     TIMESTAMPTZ,      -- última vez que o Hermes de fato atualizou
  ultimo_resultado  TEXT,             -- 'ok' | 'erro' | null (nunca atualizou)
  ultimo_erro       TEXT,
  UNIQUE(zona_id, componente)
);

ALTER TABLE sime_componentes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS componentes_zona_policy ON sime_componentes;
CREATE POLICY componentes_zona_policy ON sime_componentes
  FOR ALL USING (sime_zona_visivel(zona_id)) WITH CHECK (sime_zona_visivel(zona_id));

-- ── sime_heartbeat: pulso de vida + telemetria, por zona ───────────────────
CREATE TABLE IF NOT EXISTS sime_heartbeat (
  zona_id               UUID NOT NULL REFERENCES sime_zonas(id) ON DELETE CASCADE,
  componente            TEXT NOT NULL DEFAULT 'hermes',
  ultimo_heartbeat      TIMESTAMPTZ NOT NULL,  -- sime_now() no momento do envio
  versao                TEXT,
  commit_hash           TEXT,
  uptime_s              INTEGER,
  mem_mb                INTEGER,
  cpu_pct               NUMERIC,
  temperatura_c         NUMERIC,
  disco_livre_mb        INTEGER,
  ip                    TEXT,
  node_version          TEXT,
  whatsapp_status       TEXT,   -- 'conectado' | 'desconectado' | 'pareando'
  telegram_status       TEXT,   -- 'conectado' | 'desconectado'
  ultima_sincronizacao  TIMESTAMPTZ,  -- última vez que confirmou/gravou algo no SIME
  detalhe               JSONB,  -- espaço livre pra métricas futuras sem migração nova
  PRIMARY KEY (zona_id, componente)
);

ALTER TABLE sime_heartbeat ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS heartbeat_zona_policy ON sime_heartbeat;
CREATE POLICY heartbeat_zona_policy ON sime_heartbeat
  FOR ALL USING (sime_zona_visivel(zona_id)) WITH CHECK (sime_zona_visivel(zona_id));

-- "Online" é derivado no cliente (ex.: ultimo_heartbeat < 5 min atrás), não
-- guardado aqui — evita um job/cron só pra marcar offline quem parou de bater.
