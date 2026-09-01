-- Desempate por designação mais recente na sincronização de mesários (01/09/2026)
-- ══════════════════════════════════════════════════════════════════════════
-- Achado real, reportado direto: "FRANCYELLE OLIVEIRA RIBEIRO esta como 2º
-- mesário, e no elo como presidente, o que pode ter havido? no ultimo
-- arquivo atualizado ela consta como presidente".
--
-- Investigado: o arquivo de 81 colunas que o cartório sobe pro SIME NÃO traz
-- uma linha por pessoa — traz uma linha por EVENTO de designação. Quando uma
-- pessoa é remanejada de cargo (ex.: era 2º Mesário, foi promovida/realocada
-- pra Presidente), o arquivo às vezes carrega as DUAS linhas: a designação
-- antiga (campo `data_nomeacao` preenchido, `data_convocacao` nulo) e a nova
-- (campo `data_convocacao` preenchido, `data_nomeacao` nulo) — mesmo título
-- de eleitor, mesmo tipo_registro='MRV', `descricao_funcao_eleitoral`
-- diferente.
--
-- `sime_sync_atores_from_raw()` já sabia que podia haver mais de uma linha
-- pro mesmo (inscricao, funcao) num mesmo arquivo — por isso o ROW_NUMBER()
-- com `WHERE rn=1` — mas desempatava por `ORDER BY r.id`, o id do STAGING
-- (uuid gerado no INSERT), que não guarda nenhuma relação com qual das duas
-- designações é a mais recente. Na prática, um sorteio: das 13 pessoas da 7ª
-- Zona com esse conflito no arquivo de 01/09/2026, 3 ficaram com o cargo
-- ERRADO gravado em sime_atores (JOAO SERGIO BRITO DO NASCIMENTO, JEAN
-- RIBEIRO DE OLIVEIRA e FRANCYELLE OLIVEIRA RIBEIRO — as duas últimas
-- inclusive são o par que já tinha sido documentado antes trocando de cargo
-- na seção 225), enquanto outras 5 (com dispensado_manual=true) não foram
-- afetadas na prática por já estarem fora da lista ativa.
--
-- Confirmado nos 739 registros da 7ª Zona: `data_atribuicao` está sempre
-- preenchido, sempre em formato DD/MM/AAAA, nas duas linhas de qualquer
-- conflito — e em todos os 13 casos verificados, a linha com a MAIOR
-- `data_atribuicao` é sempre a que tem `data_convocacao` preenchida (a
-- designação nova/vigente), nunca a com `data_nomeacao` (a antiga). Por
-- isso o desempate passa a ser por `data_atribuicao` mais recente, caindo
-- em `r.id` só quando as duas linhas têm exatamente a mesma data (empate de
-- verdade, sem informação pra decidir por data).
-- ══════════════════════════════════════════════════════════════════════════

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
        ORDER BY to_date(NULLIF(r.data_atribuicao, ''), 'DD/MM/YYYY') DESC NULLS LAST, r.id
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

-- Re-sincroniza as duas zonas com o novo desempate (idempotente, pode rodar
-- de novo). Corrige na hora as 3 pessoas afetadas por este bug na 7ª Zona
-- sem precisar reenviar nenhum arquivo.
select * from sime_sync_atores_from_raw(7, 'PI');
select * from sime_sync_atores_from_raw(94, 'PI');
