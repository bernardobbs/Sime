-- ════════════════════════════════════════════════════════════
-- SIME — Auxiliar de Eleição: locais predeterminados + alerta de urna
-- ════════════════════════════════════════════════════════════
-- Pedido direto: "os auxiliares deverão ficar responsaveis por alguns
-- locais de votação predeterminados, então o problema com urnas devem cair
-- na pagina deles e nos whatsapp, somente daquelas urnas predeterminadas".
--
-- Três decisões confirmadas via AskUserQuestion antes de escrever isto:
--   1. Acesso: login próprio (e-mail/senha) — mesmo padrão admin-escopado
--      já usado por Coord. de Motoristas/Coord. de Acessibilidade/Coletor
--      de Mídias em SIME_admin.html, não QR+PIN de campo.
--   2. Um auxiliar pode cobrir VÁRIOS locais de votação ao mesmo tempo —
--      por isso tabela de junção própria, não um campo único como o
--      `local_id`/`local` que Coord. de Acessibilidade já usa (esse é
--      1-pra-1; aqui precisa ser N-pra-N).
--   3. Alerta de WhatsApp: imediato ao auxiliar designado, ALÉM da
--      escalada de sempre (10min→Gestor de Problemas, 30min→Chefe de
--      Cartório) — não em vez dela.
--
-- Deliberadamente DESACOPLADO de sime_atores.funcao='auxiliar_eleicao' (o
-- registro do roster do TRE, usado pra convocação/confirmação em
-- SIME_convocacao.html) — são dois cadastros paralelos, mesmo padrão já
-- usado por sime_voluntarios: o roster do TRE nunca traz local de trabalho
-- pra essa função (documentado no CLAUDE.md, "Auxiliar de Eleição virou
-- contagem por PESSOA"), então não há como amarrar a designação de local a
-- ele sem inventar vínculo. A pessoa que loga como auxiliar_eleicao aqui é
-- uma conta de equipe (sime_usuarios), atribuída manualmente pelo cartório.
--
-- Idempotente: pode ser aplicado mais de uma vez.

-- ------------------------------------------------------------
-- 1. PERFIL NOVO
-- ------------------------------------------------------------
ALTER TABLE sime_usuarios DROP CONSTRAINT IF EXISTS sime_usuarios_perfil_check;
ALTER TABLE sime_usuarios ADD CONSTRAINT sime_usuarios_perfil_check CHECK (perfil IN (
  'coordenador','monitor','gestor_prob','gestor_dist','observador',
  'coord_motoristas','coord_acessibilidade','coletor_midias','auxiliar_eleicao','super_admin'));

-- ------------------------------------------------------------
-- 2. LOCAIS ATRIBUÍDOS (N-pra-N)
-- ------------------------------------------------------------
-- sime_secoes não tem tabela própria de "locais" — o agrupamento em todo o
-- sistema é por local_nome+municipio (mesmo padrão de sime_resumo_secoes.js,
-- sime_rotas_modulo.js etc.), então a atribuição segue o mesmo par.
CREATE TABLE IF NOT EXISTS sime_auxiliar_locais (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id  UUID NOT NULL REFERENCES sime_usuarios(id) ON DELETE CASCADE,
  zona_id     UUID NOT NULL REFERENCES sime_zonas(id) ON DELETE CASCADE,
  local_nome  TEXT NOT NULL,
  municipio   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(usuario_id, local_nome, municipio)
);
CREATE INDEX IF NOT EXISTS idx_aux_locais_usuario ON sime_auxiliar_locais(usuario_id);
-- É por este índice que o alerta de pânico de urna resolve "quem avisar"
-- a partir do local da seção — precisa ser rápido, roda dentro do trigger
-- de sime_mesa_estado.
CREATE INDEX IF NOT EXISTS idx_aux_locais_local ON sime_auxiliar_locais(zona_id, local_nome, municipio);

ALTER TABLE sime_auxiliar_locais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aux_locais_zona_policy ON sime_auxiliar_locais;
CREATE POLICY aux_locais_zona_policy ON sime_auxiliar_locais
  FOR ALL USING (sime_zona_visivel(zona_id)) WITH CHECK (sime_zona_visivel(zona_id));

-- ------------------------------------------------------------
-- 3. ALERTA IMEDIATO NA ABERTURA DE PÂNICO DE URNA
-- ------------------------------------------------------------
-- Resolve quem avisar (nome+telefone, já prontos — não uma role genérica
-- como o escalonamento de sime_escalonar_ocorrencias() faz) e enfileira em
-- sime_notificacoes, mesma fila que o Hermes já drena via
-- /api/hermes-notificacoes. Função própria (não inline no trigger) pra
-- poder ser chamada num BEGIN/EXCEPTION isolado — uma falha aqui nunca pode
-- desfazer a abertura da ocorrência que já aconteceu na mesma transação.
CREATE OR REPLACE FUNCTION sime_notificar_auxiliares_urna(p_secao_id UUID, p_zona_id UUID)
RETURNS VOID AS $$
DECLARE
  v_secao RECORD;
  v_destinatarios JSONB;
BEGIN
  SELECT numero, local_nome, municipio INTO v_secao FROM sime_secoes WHERE id = p_secao_id;
  IF v_secao.local_nome IS NULL THEN RETURN; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'nome', u.nome, 'telefone', u.telefone_whatsapp, 'funcao', 'auxiliar_eleicao'
         )), '[]'::jsonb)
    INTO v_destinatarios
  FROM sime_auxiliar_locais al
  JOIN sime_usuarios u ON u.id = al.usuario_id
  WHERE al.zona_id = p_zona_id
    AND al.local_nome = v_secao.local_nome
    AND al.municipio  = v_secao.municipio
    -- Filtra pelo perfil ATUAL, não só pela existência da atribuição — se
    -- alguém deixou de ser auxiliar_eleicao (perfil trocado depois) mas a
    -- linha de atribuição ainda não foi limpa, não deve continuar recebendo
    -- alerta de urna.
    AND u.perfil = 'auxiliar_eleicao'
    AND u.ativo AND u.telefone_whatsapp IS NOT NULL AND u.telefone_whatsapp <> '';

  -- Local sem auxiliar designado, ou designado sem telefone cadastrado —
  -- nada pra enfileirar. Não é erro: nem todo local tem um auxiliar ainda.
  IF jsonb_array_length(v_destinatarios) = 0 THEN RETURN; END IF;

  INSERT INTO sime_notificacoes(evento, secao_id, destinatarios, mensagem, status)
  VALUES (
    'panico_urna_auxiliar', p_secao_id, v_destinatarios,
    jsonb_build_object(
      'secao', LPAD(v_secao.numero::text, 4, '0'),
      'local', v_secao.local_nome,
      'municipio', v_secao.municipio,
      'destinatarios', v_destinatarios
    )::text,
    'pendente'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Substitui por inteiro sime_sync_ocorrencias() (definida em
-- sql/SIME_ocorrencias.sql) — Postgres não permite patch parcial de função,
-- então o corpo inteiro é copiado aqui, com um bloco novo dentro do "urna".
-- Único comportamento novo: a chamada a sime_notificar_auxiliares_urna(),
-- guardada pra só disparar na TRANSIÇÃO pra panico_urna=true (não em toda
-- outra escrita na mesma seção enquanto o pânico segue ativo — o trigger é
-- AFTER INSERT OR UPDATE sem filtro de coluna, então sem esse guard
-- qualquer `fila`/`votacao` gravado durante o pânico reenfileiraria o
-- mesmo alerta a cada clique).
CREATE OR REPLACE FUNCTION sime_sync_ocorrencias() RETURNS TRIGGER AS $$
DECLARE
  v_zona UUID;
  v_now  TIMESTAMPTZ := NOW();
BEGIN
  SELECT zona_id INTO v_zona FROM sime_secoes WHERE id = NEW.secao_id;
  IF v_zona IS NULL THEN RETURN NEW; END IF;

  -- energia
  IF NEW.panico_energia AND NOT COALESCE(NEW.panico_energia_resolvido,false) THEN
    INSERT INTO sime_ocorrencias(zona_id, eleicao_id, secao_id, tipo, origem, aberta_em)
    VALUES (v_zona, NEW.eleicao_id, NEW.secao_id, 'energia', COALESCE(NEW.updated_by_origem,'campo'), v_now)
    ON CONFLICT (secao_id, tipo) WHERE status IN ('aberta','assumida') DO NOTHING;
  ELSIF COALESCE(NEW.panico_energia_resolvido,false) THEN
    UPDATE sime_ocorrencias SET status='resolvida', resolvida_em=v_now,
           resolucao=COALESCE(resolucao,'Resolvido no aparelho do campo')
     WHERE secao_id=NEW.secao_id AND tipo='energia' AND status IN ('aberta','assumida');
  END IF;

  -- urna
  IF NEW.panico_urna AND NOT COALESCE(NEW.panico_urna_resolvido,false) THEN
    INSERT INTO sime_ocorrencias(zona_id, eleicao_id, secao_id, tipo, origem, aberta_em)
    VALUES (v_zona, NEW.eleicao_id, NEW.secao_id, 'urna', COALESCE(NEW.updated_by_origem,'campo'), v_now)
    ON CONFLICT (secao_id, tipo) WHERE status IN ('aberta','assumida') DO NOTHING;

    IF TG_OP = 'INSERT' OR OLD.panico_urna IS DISTINCT FROM true THEN
      BEGIN
        PERFORM sime_notificar_auxiliares_urna(NEW.secao_id, v_zona);
      EXCEPTION WHEN OTHERS THEN
        NULL; -- best-effort — nunca desfaz a abertura da ocorrência acima
      END;
    END IF;
  ELSIF COALESCE(NEW.panico_urna_resolvido,false) THEN
    UPDATE sime_ocorrencias SET status='resolvida', resolvida_em=v_now,
           resolucao=COALESCE(resolucao,'Resolvido no aparelho do campo')
     WHERE secao_id=NEW.secao_id AND tipo='urna' AND status IN ('aberta','assumida');
  END IF;

  -- sos (genérico: conflito de fiscais, conflito entre eleitores, fila etc.)
  IF COALESCE(NEW.panico_sos,false) AND NOT COALESCE(NEW.panico_sos_resolvido,false) THEN
    INSERT INTO sime_ocorrencias(zona_id, eleicao_id, secao_id, tipo, origem, aberta_em)
    VALUES (v_zona, NEW.eleicao_id, NEW.secao_id, 'sos', COALESCE(NEW.updated_by_origem,'campo'), v_now)
    ON CONFLICT (secao_id, tipo) WHERE status IN ('aberta','assumida') DO NOTHING;
  ELSIF COALESCE(NEW.panico_sos_resolvido,false) THEN
    UPDATE sime_ocorrencias SET status='resolvida', resolvida_em=v_now,
           resolucao=COALESCE(resolucao,'Resolvido no aparelho do campo')
     WHERE secao_id=NEW.secao_id AND tipo='sos' AND status IN ('aberta','assumida');
  END IF;

  -- instalação (véspera)
  IF COALESCE(NEW.problema_instalacao,false) AND NOT COALESCE(NEW.problema_instalacao_resolvido,false) THEN
    INSERT INTO sime_ocorrencias(zona_id, eleicao_id, secao_id, tipo, origem, aberta_em)
    VALUES (v_zona, NEW.eleicao_id, NEW.secao_id, 'instalacao', COALESCE(NEW.updated_by_origem,'campo'), v_now)
    ON CONFLICT (secao_id, tipo) WHERE status IN ('aberta','assumida') DO NOTHING;
  ELSIF COALESCE(NEW.problema_instalacao_resolvido,false) THEN
    UPDATE sime_ocorrencias SET status='resolvida', resolvida_em=v_now,
           resolucao=COALESCE(resolucao,'Resolvido no aparelho do campo')
     WHERE secao_id=NEW.secao_id AND tipo='instalacao' AND status IN ('aberta','assumida');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
