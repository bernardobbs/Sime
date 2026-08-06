-- ============================================================
-- SIME — SQL: sime_campanhas_confirmacao (fila de disparo do Hermes)
--
-- Esta tabela já existia em produção (criada fora deste repositório, direto
-- no Supabase) mas nunca tinha sido documentada aqui — puro esquecimento de
-- schema. O contrato é o mesmo descrito no handoff do Hermes Agent
-- (hermes/ não fica neste repo; ver conversa/uploads da sessão que
-- documentou isso): o Hermes é o CONSUMIDOR desta fila, o SIME é quem
-- POPULA.
--
--   status             — Hermes lê 'pendente'; escreve 'enviado' ou 'erro'
--   telefone_whatsapp   — Hermes converte pra JID e envia
--   mensagem_enviada    — corpo da mensagem; se vazio, Hermes marca erro
--   tentativas          — Hermes incrementa; desiste em 3
--   ts_enviado/erro_msg/whatsapp_existe — Hermes escreve
--
-- Ao inserir por aqui: `mensagem_enviada` precisa vir preenchida e
-- `status='pendente'` — sem isso o item vira 'erro' no primeiro ciclo do
-- Hermes. Rate limit do Hermes: 5 msgs/min — um disparo de zona inteira
-- (~500 pessoas) leva ~100min, não é instantâneo. O envio de fato só
-- acontece com DISPATCH_ATIVO=true no .env do Hermes (Raspberry Pi, fora
-- deste repo) — populada a fila, o disparo em si é decisão de quem opera
-- o Hermes, não deste painel.
-- ============================================================

CREATE TABLE IF NOT EXISTS sime_campanhas_confirmacao (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ator_id             UUID REFERENCES sime_atores(id),
  telefone_whatsapp   VARCHAR(20) NOT NULL,
  whatsapp_existe     BOOLEAN,
  whatsapp_existe_ts  TIMESTAMPTZ,
  status              TEXT DEFAULT 'pendente',
  mensagem_enviada    TEXT,
  ts_enviado          TIMESTAMPTZ,
  tentativas          INTEGER DEFAULT 0,
  erro_msg            TEXT,
  resposta_recebida   TEXT,
  ts_respondido       TIMESTAMPTZ,
  decisao_detectada   TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- zona_id: coluna nova, adicionada por este arquivo — não fazia parte do
-- schema original (que não tinha nenhuma forma de escopo por zona; sem
-- isso o painel de disparo em massa não teria como aplicar RLS por zona).
-- Nullable, então não quebra o Hermes (ele não lê nem escreve esta coluna).
ALTER TABLE sime_campanhas_confirmacao ADD COLUMN IF NOT EXISTS zona_id UUID REFERENCES sime_zonas(id);
CREATE INDEX IF NOT EXISTS idx_campanhas_zona   ON sime_campanhas_confirmacao(zona_id);
CREATE INDEX IF NOT EXISTS idx_campanhas_status ON sime_campanhas_confirmacao(status);

-- imagem_url: campanha de convocação manda a mensagem + uma imagem (ex.:
-- passo a passo de como confirmar no site do TRE). Nullable — campanhas de
-- texto puro (alerta anti-golpe, mensagem livre) continuam sem imagem.
-- URL pública (Supabase Storage ou qualquer host de imagem); o Hermes só
-- baixa e reenvia, não faz upload nem hospeda nada.
ALTER TABLE sime_campanhas_confirmacao ADD COLUMN IF NOT EXISTS imagem_url TEXT;

ALTER TABLE sime_campanhas_confirmacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campanhas_zona_policy ON sime_campanhas_confirmacao;
CREATE POLICY campanhas_zona_policy ON sime_campanhas_confirmacao
  FOR ALL USING (sime_zona_visivel(zona_id)) WITH CHECK (sime_zona_visivel(zona_id));
