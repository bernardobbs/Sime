-- Consolidação de mesários/apoio duplicados por formatação inconsistente do
-- título de eleitor (27/08/2026, achado ao investigar "HEMANUELA já está
-- dispensada no ELO mas ainda consta no SIME").
--
-- Causa raiz: sime_sync_atores_from_raw() casa "é a mesma pessoa?" comparando
-- inscricao_eleitoral como STRING EXATA. Diferentes exportações do TRE/planilha
-- trazem o mesmo título ora com zero à esquerda ("080172290760"), ora sem
-- ("80172290760") — Excel costuma comer o zero quando trata a coluna como
-- número. Cada vez que o formato mudava entre uma sincronização e outra, o
-- UPSERT não reconhecia a pessoa (string diferente) e CRIAVA uma linha nova,
-- e o passo de inativação marcava ativo=false na linha do formato antigo —
-- sem apagar nada, mas escondendo confirmação/observação/flag que só
-- existiam nela.
--
-- Auditoria em produção antes de aplicar (7ª Zona): 709 pares (1.418 linhas),
-- todos com exatamente 2 formatos do mesmo título — nunca 3+, nunca duas
-- pessoas DIFERENTES coincidindo (nome bate em 100% da amostra checada).
-- Composição dos pares:
--   - 351 pares: as duas linhas 'pendente' — só duplicata de formato, sem
--     informação divergente.
--   - 329 pares: só a linha ativa tem status além de pendente — já correto,
--     só precisa consolidar o título.
--   - 16 pares: só a linha INATIVA tinha confirmação/status real, escondida.
--   - 13 pares: as duas linhas ativas ao mesmo tempo (a pessoa aparecia
--     duas vezes na tela) — nenhuma tinha observação/flag divergente entre
--     si nesses 13 casos.
--   - 0 pares com confirmações DIFERENTES e conflitantes nos dois lados
--     (nunca precisou decidir "qual está certo" — só "qual tem mais dado").
-- Além disso: 96 sime_logs e 1 sime_campanhas_confirmacao presos no id da
-- linha que ia ficar órfã (perdedora) — reatribuídos pro id vencedor, senão
-- o histórico de contato dessas pessoas sumiria do modal mesmo depois do
-- merge.
--
-- Regra de escolha do "vencedor" (a linha que fica ativa e recebe os dados):
--   1. confirmacao <> 'pendente' vence sobre 'pendente' (mais informação);
--   2. empate (mesmo status nos dois lados) → quem já estava ativo=true
--      vence; empate total → desempate estável por id (não importa, sem
--      diferença de dado entre as duas nesses casos, conferido acima).
-- A perdedora NUNCA é apagada — fica ativo=false, inscricao_eleitoral vira
-- NULL (libera o índice único pro título normalizado da vencedora) e ganha
-- uma nota em observacao apontando pra vencedora, pra auditoria futura.
--
-- Rodado via SQL Editor (mcp Supabase execute_sql) em 27/08/2026 — não é uma
-- migração de schema (sem DDL), documentado aqui como as varreduras de
-- normalização de telefone (ver SIME_telefones_normalizacao.sql), não
-- reaplica sozinho.

begin;

create temporary table tmp_pares_duplicados as
with dup as (
  select lpad(inscricao_eleitoral, 12, '0') as titulo_normalizado, funcao, zona_id
  from sime_atores
  where inscricao_eleitoral is not null
  group by 1, 2, 3
  having count(distinct inscricao_eleitoral) > 1
),
linhas as (
  select a.*, d.titulo_normalizado
  from sime_atores a
  join dup d
    on lpad(a.inscricao_eleitoral, 12, '0') = d.titulo_normalizado
   and a.funcao = d.funcao
   and a.zona_id = d.zona_id
),
ranqueado as (
  select *,
    row_number() over (
      partition by titulo_normalizado, funcao, zona_id
      order by (confirmacao <> 'pendente') desc, ativo desc, id
    ) as rn
  from linhas
)
select
  w.id as winner_id, l.id as loser_id, w.titulo_normalizado,
  l.observacao as loser_observacao, l.precisa_substituir as loser_precisa_substituir,
  l.substituto_nome as loser_substituto_nome, l.substituto_telefone as loser_substituto_telefone,
  l.telefone_alternativo as loser_telefone_alternativo, l.telefone_whatsapp as loser_telefone_whatsapp,
  l.codigo_rastreio as loser_codigo_rastreio, l.meio_contato as loser_meio_contato,
  l.status_contato_alternativo as loser_status_contato_alternativo,
  l.tem_relato_terceiro_pendente as loser_tem_relato_terceiro_pendente,
  l.confirmacao as loser_confirmacao, l.data_confirmacao as loser_data_confirmacao
from ranqueado w
join ranqueado l
  on w.titulo_normalizado = l.titulo_normalizado
 and w.funcao = l.funcao and w.zona_id = l.zona_id
 and w.rn = 1 and l.rn = 2;

-- 1) Migra pra vencedora qualquer dado que só existia na perdedora, e
--    normaliza o título (12 dígitos, zero à esquerda).
update sime_atores w
set
  observacao = case when p.loser_observacao is not null
    then coalesce(w.observacao || E'\n', '') || '[mesclado de duplicata por título em 27/08/2026] ' || p.loser_observacao
    else w.observacao end,
  precisa_substituir = w.precisa_substituir or p.loser_precisa_substituir,
  substituto_nome = coalesce(w.substituto_nome, p.loser_substituto_nome),
  substituto_telefone = coalesce(w.substituto_telefone, p.loser_substituto_telefone),
  telefone_alternativo = coalesce(w.telefone_alternativo, p.loser_telefone_alternativo),
  telefone_whatsapp = coalesce(nullif(w.telefone_whatsapp, ''), p.loser_telefone_whatsapp),
  codigo_rastreio = coalesce(w.codigo_rastreio, p.loser_codigo_rastreio),
  meio_contato = case when w.meio_contato is null or w.meio_contato = 'whatsapp'
    then coalesce(p.loser_meio_contato, w.meio_contato) else w.meio_contato end,
  status_contato_alternativo = coalesce(w.status_contato_alternativo, p.loser_status_contato_alternativo),
  tem_relato_terceiro_pendente = w.tem_relato_terceiro_pendente or p.loser_tem_relato_terceiro_pendente,
  confirmacao = case when w.confirmacao = 'pendente' and p.loser_confirmacao <> 'pendente'
    then p.loser_confirmacao else w.confirmacao end,
  data_confirmacao = case when w.confirmacao = 'pendente' and p.loser_confirmacao <> 'pendente'
    then p.loser_data_confirmacao else w.data_confirmacao end,
  inscricao_eleitoral = p.titulo_normalizado,
  ativo = true
from tmp_pares_duplicados p
where w.id = p.winner_id;

-- 2) Reatribui histórico (campanhas + logs) preso no id da perdedora.
update sime_campanhas_confirmacao c
set ator_id = p.winner_id
from tmp_pares_duplicados p
where c.ator_id = p.loser_id;

update sime_logs l
set payload = jsonb_set(l.payload, '{ator_id}', to_jsonb(p.winner_id::text))
from tmp_pares_duplicados p
where l.payload ->> 'ator_id' = p.loser_id::text;

-- 3) Aposenta a perdedora — nunca apaga, só sai do caminho (ativo=false,
--    título liberado pro índice único da vencedora, nota de auditoria).
update sime_atores l
set
  ativo = false,
  inscricao_eleitoral = null,
  observacao = coalesce(l.observacao || E'\n', '')
    || '[mesclado em 27/08/2026 na duplicata ' || p.winner_id || ' — este registro ficou órfão por formatação inconsistente do título de eleitor entre importações]'
from tmp_pares_duplicados p
where l.id = p.loser_id;

commit;
