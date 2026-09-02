-- Dispensa manual sobrevive a resync do roster (01/09/2026)
-- ══════════════════════════════════════
-- Bug real grave, achado investigando "PAULO JOSE MACEDO BRITO FOI
-- DISPENSADO, TODOS DISPENSADOS A FUNÇÃO DEVE ESTAR VAZIA" (pedido direto).
--
-- A varredura "Situação=DISPENSADO" do ELO (31/08/2026, já documentada no
-- CLAUDE.md) tinha marcado 39 pessoas da 7ª Zona como ativo=false, com nota
-- em `observacao`. Investigando o caso do PAULO, achado que ele (e mais 55
-- pessoas, TODAS as dispensadas naquela varredura) estavam de volta a
-- ativo=true — a dispensa tinha sido silenciosamente desfeita.
--
-- Causa raiz: `sime_sync_atores_from_raw()` faz UPSERT por
-- (inscricao_eleitoral, funcao) e o `DO UPDATE SET ... ativo = true` é
-- INCONDICIONAL — toda vez que a pessoa continua aparecendo na exportação
-- de 81 colunas do TRE (que, como já documentado alhures, NUNCA traz uma
-- coluna de "situação/dispensada"), o próximo "🔄 Sincronizar" reativa ela
-- de novo, mesmo que o cartório tenha dispensado manualmente por fora do
-- pipeline (SQL Editor, varredura do relatório do ELO). O sync não tinha
-- como saber que aquele ativo=false era deliberado, não um "esqueceu de
-- reativar".
--
-- Corrigido com uma flag própria — mesmo espírito de `precisa_substituir`
-- (flag manual, independente do que o sync calcula, nunca sobrescrita por
-- ele): `dispensado_manual`. Uma vez marcada, `sime_sync_atores_from_raw()`
-- NUNCA mais reativa a pessoa sozinho, não importa quantas vezes ela
-- continue aparecendo no roster do TRE. Os demais campos (nome, telefone,
-- seção, etc.) continuam sendo atualizados normalmente pelo sync — só o
-- `ativo` fica travado em false.
-- ══════════════════════════════════════

alter table sime_atores add column if not exists dispensado_manual boolean not null default false;
comment on column sime_atores.dispensado_manual is 'Dispensa manual (ex.: Situação=DISPENSADO no ELO) que deve sobreviver a resyncs do roster — sime_sync_atores_from_raw() nunca reativa quem tem essa flag, mesmo que a pessoa ainda apareça na exportação do TRE (que não carrega essa informação).';

create or replace function sime_sync_atores_from_raw(p_zona_numero integer, p_uf text default 'PI'::text)
 returns table(atualizados integer, inativados integer)
 language plpgsql
 set search_path to 'public'
as $function$
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
  ponte_al AS (
    SELECT DISTINCT ON (numero_local_votacao_local_trabalho, lower(nome_municipio_local_trabalho))
      numero_local_votacao_local_trabalho,
      lower(nome_municipio_local_trabalho) AS municipio_lower,
      secao_local_trabalho
    FROM sime_mesarios_raw
    WHERE zona_eleitoral_trabalho = p_zona_numero::text
      AND uf_trabalho = p_uf
      AND tipo_registro = 'MRV'
      AND secao_local_trabalho IS NOT NULL AND secao_local_trabalho <> ''
      AND numero_local_votacao_local_trabalho IS NOT NULL AND numero_local_votacao_local_trabalho <> ''
    ORDER BY numero_local_votacao_local_trabalho, lower(nome_municipio_local_trabalho), secao_local_trabalho
  ),
  upsert AS (
    INSERT INTO sime_atores (
      zona_id, eleicao_id, nome_completo, telefone_whatsapp, secao_id,
      funcao, funcao_mesa, inscricao_eleitoral, fonte_contato, ativo
    )
    SELECT
      v_zona_id, v_eleicao_id, f.nome_civil,
      sime_normalizar_telefone_whatsapp(
        COALESCE(
          NULLIF(regexp_replace(f.telefone_pessoal_mesario, '\D', '', 'g'), ''),
          NULLIF(regexp_replace(f.telefone_1_eleitor, '\D', '', 'g'), ''),
          NULLIF(regexp_replace(f.telefone_2_eleitor, '\D', '', 'g'), ''),
          NULLIF(regexp_replace(f.telefone_contato_eleitor, '\D', '', 'g'), '')
        )
      ),
      s.id,
      f.funcao_calc,
      CASE WHEN f.tipo_registro = 'MRV' THEN f.descricao_funcao_eleitoral ELSE NULL END,
      lpad(NULLIF(f.inscricao, ''), 12, '0'),
      'sistema_2026',
      true
    FROM fonte f
    LEFT JOIN ponte_al p
      ON f.tipo_registro = 'AL'
      AND p.numero_local_votacao_local_trabalho = f.numero_local_votacao_local_trabalho
      AND p.municipio_lower = lower(f.nome_municipio_local_trabalho)
    LEFT JOIN sime_secoes s
      ON s.zona_id = v_zona_id
      AND s.numero = NULLIF(
            CASE WHEN f.tipo_registro = 'MRV' THEN f.secao_local_trabalho ELSE p.secao_local_trabalho END,
            ''
          )::int
      AND lower(s.municipio) = lower(f.nome_municipio_local_trabalho)
    WHERE f.rn = 1
    ON CONFLICT (inscricao_eleitoral, funcao) WHERE inscricao_eleitoral IS NOT NULL
    DO UPDATE SET
      nome_completo     = EXCLUDED.nome_completo,
      telefone_whatsapp = COALESCE(NULLIF(sime_atores.telefone_whatsapp, ''), EXCLUDED.telefone_whatsapp),
      secao_id          = EXCLUDED.secao_id,
      funcao_mesa       = EXCLUDED.funcao_mesa,
      zona_id           = EXCLUDED.zona_id,
      eleicao_id        = EXCLUDED.eleicao_id,
      -- 01/09/2026: dispensa manual nunca é desfeita por um resync, mesmo
      -- que a pessoa continue no roster do TRE (ver comentário no topo do
      -- arquivo desta migração).
      ativo             = CASE WHEN sime_atores.dispensado_manual THEN false ELSE true END
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
        WHERE lpad(NULLIF(r.inscricao, ''), 12, '0') = a.inscricao_eleitoral
          AND r.zona_eleitoral_trabalho = p_zona_numero::text
          AND r.uf_trabalho = p_uf
          AND r.tipo_registro IN ('MRV', 'AL')
      )
    RETURNING a.id
  )
  SELECT count(*) INTO v_inativados FROM inativados;

  RETURN QUERY SELECT v_atualizados, v_inativados;
END;
$function$;

-- Restaura os casos que já tinham sido dispensados manualmente (varredura
-- Situação=DISPENSADO, 31/08/2026, e o caso do PAULO JOSE MACEDO BRITO,
-- reconferido em 01/09/2026) e foram silenciosamente reativados por um
-- resync do roster antes desta correção — casa por observação já registrada
-- como "Dispensado ... Marcado ativo=false" e ainda ativo=true agora.
update sime_atores
set ativo = false, dispensado_manual = true
where ativo = true
  and observacao ~* 'Dispensado.*Marcado ativo=false';
