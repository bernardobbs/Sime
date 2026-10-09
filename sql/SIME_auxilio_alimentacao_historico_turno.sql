-- Arquivar auxílio alimentação do turno atual e ativar o próximo turno
-- (09/10/2026, pedido direto, a partir de uma pergunta sobre o recibo do 2º
-- turno: "essa é a nova inspiração para o recibo para o 2º turno" — o
-- formato do recibo já funciona sozinho pro 2º turno (raEleicaoTexto() já
-- lê turno/data_d de sime_eleicoes), mas os campos de pagamento/frequência/
-- devolução (auxilio_alimentacao_pago/_frequencia/_devolvido/...) são
-- ÚNICOS por pessoa em sime_atores — sem coluna de turno/eleição. Ativar o
-- 2º turno sem mexer em mais nada faria todo mundo continuar aparecendo
-- como "já pago"/"faltou" do 1º turno dentro do controle do 2º turno.
--
-- Perguntado diretamente ao dono do projeto como tratar isso (3 opções:
-- zerar com histórico, rastrear por turno no schema, ou só o recibo por
-- enquanto) — escolhida a recomendada: "Zerar pra todos ao ativar o 2º
-- turno" — arquiva um snapshot do estado do turno que está terminando
-- (pra manter o 1º turno auditável, mesmos R$44mil+ já reconciliados na
-- planilha de conferência) e zera os campos em sime_atores/
-- sime_veiculos_disposicao, pra o controle do 2º turno começar limpo.
--
-- Idempotente (CREATE TABLE/POLICY IF NOT EXISTS, CREATE OR REPLACE
-- FUNCTION — pode rodar de novo sem duplicar nada).

-- ── Tabela de histórico — snapshot do estado ANTES de zerar ──
-- Unificada (pessoa + veículo) com `origem` discriminando, em vez de duas
-- tabelas separadas — mesmo conjunto de colunas de pagamento serve pros
-- dois, e um relatório futuro "o que foi pago no 1º turno" nunca precisa
-- fazer UNION de duas tabelas.
create table if not exists sime_auxilio_alimentacao_historico (
  id                    uuid primary key default uuid_generate_v4(),
  zona_id               uuid not null references sime_zonas(id),
  eleicao_id            uuid references sime_eleicoes(id),  -- a eleição sendo arquivada (de origem)
  origem                text not null check (origem in ('ator', 'veiculo')),
  ator_id               uuid references sime_atores(id),              -- null quando origem='veiculo'
  veiculo_id            uuid references sime_veiculos_disposicao(id), -- null quando origem='ator'
  nome                  text,       -- nome_completo (ator) ou motorista_nome (veículo), como estava na hora
  funcao                text,       -- só ator
  funcao_mesa           text,       -- só ator
  inscricao_eleitoral   text,       -- só ator
  secao_id              uuid,       -- só ator
  pago                  boolean,
  valor_pago            numeric,
  pago_em               timestamptz,
  documento             text,
  frequencia            text,       -- só ator
  devolvido             boolean,    -- só ator
  devolvido_em          timestamptz,
  devolucao_documento   text,
  recibo_ausente        boolean,    -- só ator
  isento                boolean,    -- só ator
  isento_motivo         text,       -- só ator
  arquivado_em          timestamptz not null default now(),
  arquivado_por         text
);

create index if not exists idx_auxilio_hist_zona on sime_auxilio_alimentacao_historico(zona_id);
create index if not exists idx_auxilio_hist_eleicao on sime_auxilio_alimentacao_historico(eleicao_id);
create index if not exists idx_auxilio_hist_ator on sime_auxilio_alimentacao_historico(ator_id);

alter table sime_auxilio_alimentacao_historico enable row level security;
drop policy if exists auxilio_hist_zona_policy on sime_auxilio_alimentacao_historico;
create policy auxilio_hist_zona_policy on sime_auxilio_alimentacao_historico
  for all using (sime_zona_visivel(zona_id)) with check (sime_zona_visivel(zona_id));

comment on table sime_auxilio_alimentacao_historico is
  'Snapshot do estado de pagamento/frequência/devolução do auxílio alimentação, tirado logo ANTES de sime_arquivar_auxilio_alimentacao_e_ativar_turno() zerar os campos em sime_atores/sime_veiculos_disposicao pra começar o próximo turno. Nunca editado depois de gravado — é o registro histórico do turno anterior.';

-- ── RPC: arquiva o turno atual (p_eleicao_id_atual) e ativa o próximo
-- (p_eleicao_id_novo) ──
-- SECURITY DEFINER (mesmo padrão de sime_sync_atores_from_raw/
-- sime_ocorrencia_resolver — ação administrativa sensível, não um simples
-- CRUD de linha). Os dois ids são sempre passados explicitamente pelo
-- chamador (nunca adivinhados "turno+1" aqui dentro) — a tela já valida
-- que p_eleicao_id_novo existe, pertence à mesma zona, está `ativa=false`
-- e tem turno diferente do atual antes de chamar isto; a função repete a
-- validação mínima (mesma zona, nunca arquiva/ativa cruzando zona) como
-- última linha de defesa.
create or replace function sime_arquivar_auxilio_alimentacao_e_ativar_turno(
  p_zona_id uuid,
  p_eleicao_id_atual uuid,
  p_eleicao_id_novo uuid,
  p_autor text default 'Cartório'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qtd_atores int := 0;
  v_qtd_veiculos int := 0;
begin
  if not exists (select 1 from sime_eleicoes where id = p_eleicao_id_atual and zona_id = p_zona_id) then
    raise exception 'Eleição atual não pertence a esta zona';
  end if;
  if not exists (select 1 from sime_eleicoes where id = p_eleicao_id_novo and zona_id = p_zona_id) then
    raise exception 'Eleição nova não pertence a esta zona';
  end if;

  -- Snapshot — pessoas (mesmo universo de sime_recibo_alimentacao.js:
  -- mesario/coord_acessibilidade/auxiliar_eleicao/junta_eleitoral, SEM
  -- filtro de ativo — arquiva o estado de todo mundo, mesmo quem já saiu
  -- do cadastro ativo, pra não perder o registro de quem foi pago/faltou).
  insert into sime_auxilio_alimentacao_historico (
    zona_id, eleicao_id, origem, ator_id, nome, funcao, funcao_mesa,
    inscricao_eleitoral, secao_id, pago, valor_pago, pago_em, documento,
    frequencia, devolvido, devolvido_em, devolucao_documento,
    recibo_ausente, isento, isento_motivo, arquivado_por
  )
  select p_zona_id, p_eleicao_id_atual, 'ator', a.id, a.nome_completo, a.funcao, a.funcao_mesa,
         a.inscricao_eleitoral, a.secao_id, a.auxilio_alimentacao_pago, a.auxilio_alimentacao_valor_pago,
         a.auxilio_alimentacao_pago_em, a.auxilio_alimentacao_documento, a.auxilio_alimentacao_frequencia,
         a.auxilio_alimentacao_devolvido, a.auxilio_alimentacao_devolvido_em, a.auxilio_alimentacao_devolucao_documento,
         a.auxilio_alimentacao_recibo_ausente, a.auxilio_alimentacao_isento, a.auxilio_alimentacao_isento_motivo, p_autor
  from sime_atores a
  where a.zona_id = p_zona_id
    and a.funcao in ('mesario', 'coord_acessibilidade', 'auxiliar_eleicao', 'junta_eleitoral');
  get diagnostics v_qtd_atores = row_count;

  -- Snapshot — motoristas de repartições (sime_veiculos_disposicao), mesmo
  -- raciocínio: sem filtro de ativo.
  insert into sime_auxilio_alimentacao_historico (
    zona_id, eleicao_id, origem, veiculo_id, nome, pago, valor_pago, pago_em, arquivado_por
  )
  select p_zona_id, p_eleicao_id_atual, 'veiculo', v.id, v.motorista_nome,
         v.auxilio_alimentacao_pago, v.auxilio_alimentacao_valor_pago, v.auxilio_alimentacao_pago_em, p_autor
  from sime_veiculos_disposicao v
  where v.zona_id = p_zona_id;
  get diagnostics v_qtd_veiculos = row_count;

  -- Zera pra todo mundo da zona (mesmo universo do snapshot acima).
  update sime_atores set
    auxilio_alimentacao_pago = false,
    auxilio_alimentacao_valor_pago = null,
    auxilio_alimentacao_pago_em = null,
    auxilio_alimentacao_documento = null,
    auxilio_alimentacao_frequencia = null,
    auxilio_alimentacao_devolvido = false,
    auxilio_alimentacao_devolvido_em = null,
    auxilio_alimentacao_devolucao_documento = null,
    auxilio_alimentacao_recibo_ausente = false,
    auxilio_alimentacao_isento = false,
    auxilio_alimentacao_isento_motivo = null
  where zona_id = p_zona_id
    and funcao in ('mesario', 'coord_acessibilidade', 'auxiliar_eleicao', 'junta_eleitoral');

  update sime_veiculos_disposicao set
    auxilio_alimentacao_pago = false,
    auxilio_alimentacao_valor_pago = null,
    auxilio_alimentacao_pago_em = null
  where zona_id = p_zona_id;

  -- Troca a eleição ativa — a mesma transação que arquivou/zerou, nunca
  -- separado (uma falha no meio nunca deixa a zona sem eleição ativa
  -- nenhuma, nem com duas ativas ao mesmo tempo).
  update sime_eleicoes set ativa = false where id = p_eleicao_id_atual;
  update sime_eleicoes set ativa = true where id = p_eleicao_id_novo;

  return jsonb_build_object('atores_arquivados', v_qtd_atores, 'veiculos_arquivados', v_qtd_veiculos);
end;
$$;

grant execute on function sime_arquivar_auxilio_alimentacao_e_ativar_turno(uuid, uuid, uuid, text) to authenticated;
