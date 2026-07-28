-- ════════════════════════════════════════════════════════════
-- SIME — Painel de Problemas
-- ════════════════════════════════════════════════════════════
-- Promove o "problema" de leitura derivada a registro próprio.
--
-- Até aqui um problema era um booleano em sime_mesa_estado (panico_energia,
-- panico_urna, problema_instalacao) recalculado a cada 5s pelas telas. Um
-- booleano não tem dono, não tem histórico e não tem relógio — por isso não
-- havia onde escrever quem assumiu, nem como o escalonamento previsto no
-- CLAUDE.md (10 min → Gestor, 30 min → Chefe) sair do papel.
--
-- REGRA DE DIREÇÃO ÚNICA (a parte que evita duas verdades):
--   sime_mesa_estado  = o que o CAMPO vê
--   sime_ocorrencias  = o que o CARTÓRIO está fazendo a respeito
-- Abrir e fechar caminham juntos, sempre nessa ordem, nunca em paralelo.
--
-- Idempotente: pode ser aplicado mais de uma vez.

-- ------------------------------------------------------------
-- 1. CONTATOS EXTERNOS (Equatorial e quem mais entrar depois)
-- ------------------------------------------------------------
-- Genérica de propósito: no dia da eleição a lista de "quem eu ligo" nunca é
-- só a concessionária de energia. Telefone fixo entra com whatsapp=false e o
-- botão vira tel: em vez de wa.me.
CREATE TABLE IF NOT EXISTS sime_contatos_externos (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id    UUID NOT NULL REFERENCES sime_zonas(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL CHECK (tipo IN ('energia','telefonia','pm','bombeiros','prefeitura','tre','outro')),
  nome       TEXT NOT NULL,
  municipio  TEXT,                    -- NULL = vale para a zona inteira
  telefone   TEXT NOT NULL,
  whatsapp   BOOLEAN NOT NULL DEFAULT true,
  observacao TEXT,
  ativo      BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contatos_ext_zona ON sime_contatos_externos(zona_id, tipo) WHERE ativo;

-- ------------------------------------------------------------
-- 2. OCORRÊNCIAS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sime_ocorrencias (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zona_id       UUID NOT NULL REFERENCES sime_zonas(id),
  eleicao_id    UUID REFERENCES sime_eleicoes(id),
  secao_id      UUID REFERENCES sime_secoes(id),

  -- O tipo decide QUEM o painel oferece para contato. É a peça central da
  -- tela: faltou luz → Equatorial; urna com defeito → auxiliar de eleição
  -- (contratado do TRE que faz manutenção de urna); mesa incompleta →
  -- mesário; acessibilidade → coordenador do local.
  tipo          TEXT NOT NULL CHECK (tipo IN (
                  'energia','urna','mesa_incompleta','votacao_atrasada',
                  'instalacao','acessibilidade','outro')),
  origem        TEXT NOT NULL DEFAULT 'admin',
  descricao     TEXT,

  status        TEXT NOT NULL DEFAULT 'aberta'
                CHECK (status IN ('aberta','assumida','resolvida','cancelada')),

  -- Quem está com ela AGORA. Quem assume cuida até o fim; delegar troca o
  -- responsável e registra o porquê no histórico.
  responsavel_id UUID REFERENCES sime_usuarios(id),

  aberta_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assumida_em   TIMESTAMPTZ,
  resolvida_em  TIMESTAMPTZ,
  resolvida_por UUID REFERENCES sime_usuarios(id),
  resolucao     TEXT,

  -- 0 nenhum · 1 gestor de problemas · 2 chefe de cartório. NUNCA o juiz.
  nivel_escalonamento SMALLINT NOT NULL DEFAULT 0,
  escalonada_em TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ocor_zona_status ON sime_ocorrencias(zona_id, status);
CREATE INDEX IF NOT EXISTS idx_ocor_responsavel ON sime_ocorrencias(responsavel_id) WHERE status = 'assumida';
CREATE INDEX IF NOT EXISTS idx_ocor_secao ON sime_ocorrencias(secao_id);

-- Uma ocorrência ABERTA por seção+tipo. Impede que o gatilho abra uma nova a
-- cada re-render enquanto o pânico segue ativo. O índice parcial é o que faz
-- o ON CONFLICT do gatilho funcionar sem bloquear o histórico de resolvidas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ocor_aberta_unica
  ON sime_ocorrencias(secao_id, tipo) WHERE status IN ('aberta','assumida');

-- ------------------------------------------------------------
-- 3. HISTÓRICO (append-only, mesmo espírito de sime_logs)
-- ------------------------------------------------------------
-- É o que permite responder depois "por que essa seção levou 40 minutos".
CREATE TABLE IF NOT EXISTS sime_ocorrencia_eventos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ocorrencia_id UUID NOT NULL REFERENCES sime_ocorrencias(id) ON DELETE CASCADE,
  acao          TEXT NOT NULL,   -- abriu | assumiu | delegou | contatou | resolveu | escalou | reabriu
  autor_id      UUID REFERENCES sime_usuarios(id),
  detalhe       TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ocor_ev ON sime_ocorrencia_eventos(ocorrencia_id, criado_em);

-- ------------------------------------------------------------
-- 4. ABERTURA/FECHAMENTO AUTOMÁTICOS A PARTIR DO CAMPO
-- ------------------------------------------------------------
-- O campo continua sendo a fonte do fato. Quando o mesário aciona o pânico,
-- a ocorrência nasce; quando ele mesmo resolve no aparelho, ela fecha.
-- Resolver pelo cartório faz o caminho inverso (RPC abaixo), nunca os dois
-- ao mesmo tempo.
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
  ELSIF COALESCE(NEW.panico_urna_resolvido,false) THEN
    UPDATE sime_ocorrencias SET status='resolvida', resolvida_em=v_now,
           resolucao=COALESCE(resolucao,'Resolvido no aparelho do campo')
     WHERE secao_id=NEW.secao_id AND tipo='urna' AND status IN ('aberta','assumida');
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

DROP TRIGGER IF EXISTS trg_sime_sync_ocorrencias ON sime_mesa_estado;
CREATE TRIGGER trg_sime_sync_ocorrencias
  AFTER INSERT OR UPDATE ON sime_mesa_estado
  FOR EACH ROW EXECUTE FUNCTION sime_sync_ocorrencias();

-- ------------------------------------------------------------
-- 5. RPCs DA TELA
-- ------------------------------------------------------------
-- Resolve o sime_usuarios do JWT atual (mesmo padrão de sime_user_zona()).
CREATE OR REPLACE FUNCTION sime_usuario_atual() RETURNS UUID AS $$
  SELECT id FROM sime_usuarios WHERE auth_user_id = auth.uid() AND ativo LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Assumir. Quem assume cuida até o fim — por isso assumir uma ocorrência que
-- já tem dono NÃO troca o responsável em silêncio: exige delegar.
CREATE OR REPLACE FUNCTION sime_ocorrencia_assumir(p_id UUID)
RETURNS sime_ocorrencias AS $$
DECLARE v_row sime_ocorrencias; v_eu UUID := sime_usuario_atual();
BEGIN
  UPDATE sime_ocorrencias
     SET status='assumida', responsavel_id=v_eu, assumida_em=NOW()
   WHERE id=p_id AND status='aberta'
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Ocorrência já tem responsável ou não está aberta';
  END IF;

  INSERT INTO sime_ocorrencia_eventos(ocorrencia_id, acao, autor_id)
  VALUES (p_id, 'assumiu', v_eu);
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Delegar — a saída de quem assumiu e não consegue resolver. Exige motivo:
-- sem ele o histórico não explica por que a ocorrência trocou de mãos.
CREATE OR REPLACE FUNCTION sime_ocorrencia_delegar(p_id UUID, p_para UUID, p_motivo TEXT)
RETURNS sime_ocorrencias AS $$
DECLARE v_row sime_ocorrencias; v_eu UUID := sime_usuario_atual();
BEGIN
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Informe o motivo da delegação';
  END IF;

  UPDATE sime_ocorrencias
     SET responsavel_id=p_para, status='assumida', assumida_em=NOW()
   WHERE id=p_id AND status IN ('aberta','assumida')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Ocorrência não está aberta';
  END IF;

  INSERT INTO sime_ocorrencia_eventos(ocorrencia_id, acao, autor_id, detalhe)
  VALUES (p_id, 'delegou', v_eu,
          (SELECT nome FROM sime_usuarios WHERE id=p_para) || ' — ' || p_motivo);
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Resolver pelo cartório. Fecha a ocorrência E baixa o pânico na seção, na
-- mesma transação — é isso que faz a resolução chegar ao aparelho do mesário
-- pelo Realtime, em vez de deixar a tela dele vermelha.
CREATE OR REPLACE FUNCTION sime_ocorrencia_resolver(p_id UUID, p_resolucao TEXT)
RETURNS sime_ocorrencias AS $$
DECLARE v_row sime_ocorrencias; v_eu UUID := sime_usuario_atual();
BEGIN
  UPDATE sime_ocorrencias
     SET status='resolvida', resolvida_em=NOW(), resolvida_por=v_eu,
         resolucao=NULLIF(btrim(COALESCE(p_resolucao,'')),'')
   WHERE id=p_id AND status IN ('aberta','assumida')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Ocorrência não está aberta';
  END IF;

  -- Espelha no campo. Só os campos do tipo em questão — os demais ficam NULL
  -- e o sime_acao_mesa mantém o que já estava lá.
  IF v_row.secao_id IS NOT NULL AND v_row.eleicao_id IS NOT NULL THEN
    IF v_row.tipo = 'energia' THEN
      PERFORM sime_acao_mesa(p_secao_id => v_row.secao_id, p_eleicao_id => v_row.eleicao_id,
        p_panico_energia => false, p_panico_energia_resolvido => true, p_origem => 'cartorio');
    ELSIF v_row.tipo = 'urna' THEN
      PERFORM sime_acao_mesa(p_secao_id => v_row.secao_id, p_eleicao_id => v_row.eleicao_id,
        p_panico_urna => false, p_panico_urna_resolvido => true, p_origem => 'cartorio');
    ELSIF v_row.tipo = 'instalacao' THEN
      PERFORM sime_acao_mesa(p_secao_id => v_row.secao_id, p_eleicao_id => v_row.eleicao_id,
        p_problema_instalacao => false, p_problema_instalacao_resolvido => true, p_origem => 'cartorio');
    END IF;
  END IF;

  INSERT INTO sime_ocorrencia_eventos(ocorrencia_id, acao, autor_id, detalhe)
  VALUES (p_id, 'resolveu', v_eu, v_row.resolucao);
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Abrir manualmente (o cartório soube por telefone). p_tipo decide o contato
-- que a tela vai oferecer.
CREATE OR REPLACE FUNCTION sime_ocorrencia_abrir(
  p_secao_id UUID, p_eleicao_id UUID, p_tipo TEXT, p_descricao TEXT DEFAULT NULL)
RETURNS sime_ocorrencias AS $$
DECLARE v_row sime_ocorrencias; v_eu UUID := sime_usuario_atual(); v_zona UUID;
BEGIN
  SELECT zona_id INTO v_zona FROM sime_secoes WHERE id = p_secao_id;
  INSERT INTO sime_ocorrencias(zona_id, eleicao_id, secao_id, tipo, origem, descricao)
  VALUES (v_zona, p_eleicao_id, p_secao_id, p_tipo, 'admin', p_descricao)
  RETURNING * INTO v_row;

  INSERT INTO sime_ocorrencia_eventos(ocorrencia_id, acao, autor_id, detalhe)
  VALUES (v_row.id, 'abriu', v_eu, p_descricao);
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Registrar que alguém foi contatado — o histórico precisa disso para que
-- "ninguém atendeu" seja um fato, e não memória de quem estava de plantão.
CREATE OR REPLACE FUNCTION sime_ocorrencia_contatou(p_id UUID, p_quem TEXT)
RETURNS VOID AS $$
  INSERT INTO sime_ocorrencia_eventos(ocorrencia_id, acao, autor_id, detalhe)
  VALUES (p_id, 'contatou', sime_usuario_atual(), p_quem);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- 6. ESCALONAMENTO
-- ------------------------------------------------------------
-- Regra do CLAUDE.md, inalterada: 10 min → Gestor de Problemas;
-- 30 min → Chefe de Cartório; NUNCA o juiz eleitoral.
--
-- O relógio conta de aberta_em, não de assumida_em: senão a forma mais fácil
-- de não ser escalado passaria a ser clicar em "Assumir" e esquecer.
CREATE OR REPLACE FUNCTION sime_escalonar_ocorrencias() RETURNS INTEGER AS $$
DECLARE v_n INTEGER := 0; r RECORD; v_alvo SMALLINT;
BEGIN
  FOR r IN SELECT * FROM sime_ocorrencias WHERE status IN ('aberta','assumida') LOOP
    v_alvo := CASE
      WHEN NOW() - r.aberta_em >= INTERVAL '30 minutes' THEN 2
      WHEN NOW() - r.aberta_em >= INTERVAL '10 minutes' THEN 1
      ELSE 0 END;

    IF v_alvo > r.nivel_escalonamento THEN
      UPDATE sime_ocorrencias
         SET nivel_escalonamento = v_alvo, escalonada_em = NOW()
       WHERE id = r.id;

      INSERT INTO sime_ocorrencia_eventos(ocorrencia_id, acao, detalhe)
      VALUES (r.id, 'escalou',
              CASE v_alvo WHEN 1 THEN 'Gestor de Problemas' ELSE 'Chefe de Cartório' END);

      -- Enfileira pro Hermes drenar (mesma fila do gatilho de pânico).
      --
      -- Best-effort de propósito: o nível de escalonamento é o que pinta a
      -- tela de vermelho, e ele não pode depender do WhatsApp sair. Sem este
      -- bloco, uma falha aqui (fila ausente, coluna mudada) desfazia o UPDATE
      -- acima e a ocorrência ficava eternamente no nível 0 — silenciosa
      -- justamente no caso em que mais se precisa dela.
      BEGIN
        INSERT INTO sime_notificacoes(evento, secao_id, destinatarios, mensagem, status)
        VALUES ('escalonamento', r.secao_id, '[]'::jsonb,
                json_build_object('ocorrencia_id', r.id, 'tipo', r.tipo, 'nivel', v_alvo)::text,
                'pendente');
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO sime_ocorrencia_eventos(ocorrencia_id, acao, detalhe)
        VALUES (r.id, 'escalou', 'Fila de notificação indisponível — escalonamento registrado assim mesmo');
      END;
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- 7. RLS
-- ------------------------------------------------------------
ALTER TABLE sime_ocorrencias          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sime_ocorrencia_eventos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sime_contatos_externos    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ocorrencias_zona_policy ON sime_ocorrencias;
CREATE POLICY ocorrencias_zona_policy ON sime_ocorrencias
  FOR ALL USING (sime_zona_visivel(zona_id)) WITH CHECK (sime_zona_visivel(zona_id));

DROP POLICY IF EXISTS ocorrencia_eventos_policy ON sime_ocorrencia_eventos;
CREATE POLICY ocorrencia_eventos_policy ON sime_ocorrencia_eventos
  FOR ALL USING (ocorrencia_id IN (SELECT id FROM sime_ocorrencias WHERE sime_zona_visivel(zona_id)))
  WITH CHECK (ocorrencia_id IN (SELECT id FROM sime_ocorrencias WHERE sime_zona_visivel(zona_id)));

DROP POLICY IF EXISTS contatos_externos_policy ON sime_contatos_externos;
CREATE POLICY contatos_externos_policy ON sime_contatos_externos
  FOR ALL USING (sime_zona_visivel(zona_id)) WITH CHECK (sime_zona_visivel(zona_id));

-- Realtime: a tela de problemas reflete o que outra pessoa da equipe fez sem
-- precisar de F5 — é o que impede duas pessoas de ligarem pra mesma seção.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sime_ocorrencias;
EXCEPTION WHEN duplicate_object THEN NULL;  -- já publicada: reaplicar é no-op
END $$;
