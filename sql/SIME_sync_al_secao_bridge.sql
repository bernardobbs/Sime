-- sime_sync_atores_from_raw() — resolve secao_id pra apoio logístico (AL)
--
-- Achado real em 22/08/2026, investigando por que o Dashboard mostrava
-- "Vazio: 63" pros dois grupos de apoio logístico (Coordenador de
-- Acessibilidade e Auxiliar de Eleição) mesmo com 69 + 30 pessoas
-- cadastradas e várias já confirmadas: TODOS os registros AL (100%, os
-- 99 da 7ª Zona) têm secao_id NULL em sime_atores — o join original só
-- tenta secao_local_trabalho (número de seção), e o arquivo do TRE NUNCA
-- preenche esse campo pra tipo_registro='AL', só pra 'MRV'. Sem secao_id,
-- o drilldown por local/município não tem como saber onde essa pessoa
-- atua, mesmo ela existindo e tendo confirmacao de verdade.
--
-- Corrigido com uma ponte que NÃO adivinha nada: tanto MRV quanto AL
-- trazem numero_local_votacao_local_trabalho (código do LOCAL de
-- votação — não da seção) já preenchido. Um mesário (MRV) do mesmo
-- local+município sempre tem secao_local_trabalho preenchido — usa o
-- número de seção de QUALQUER mesário daquele mesmo local como ponte
-- pra achar o secao_id. Verificado antes de aplicar: todas as seções de
-- um mesmo numero_local_votacao_local_trabalho compartilham o mesmo
-- sime_secoes.local_nome (ex.: numero_local 1325 em Campo Maior → 7
-- seções, todas "G.E. Treze de Março") — então isso é seguro mesmo
-- resolvendo pra uma seção "diferente" da real: o que importa pro AL é
-- só local_nome/município, nunca uma seção específica (a vaga de AL é
-- por local inteiro, não por cargo de mesa).
--
-- Cobertura medida na 7ª Zona antes de aplicar: 64 dos 99 registros AL
-- têm numero_local_votacao_local_trabalho preenchido e resolvem via
-- ponte (100% dos que têm o número). Os outros 35 simplesmente não têm
-- esse código no arquivo de origem — continuam sem secao_id, como
-- antes, porque não tem em cima do quê resolver sem adivinhar.
--
-- Depois de aplicar esta migração, rodar de novo:
--   select * from sime_sync_atores_from_raw(7, 'PI');
-- pra corrigir os 99 registros AL já carregados (mesmo padrão de sempre
-- — recarregar staging já existente conserta dado antigo, sem precisar
-- reenviar arquivo).

CREATE OR REPLACE FUNCTION public.sime_sync_atores_from_raw(p_zona_numero integer, p_uf text DEFAULT 'PI'::text)
 RETURNS TABLE(atualizados integer, inativados integer)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  -- Ponte AL -> nº de seção, via numero_local_votacao_local_trabalho
  -- (ver comentário no topo do arquivo). Só usa MRV como fonte da ponte
  -- (é o único tipo que sempre traz secao_local_trabalho preenchido).
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
      f.inscricao,
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
$function$;
