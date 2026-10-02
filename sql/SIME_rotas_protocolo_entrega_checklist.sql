-- Protocolo de Entrega/Recolhimento de UE + Check List de Veículos,
-- movidos pra DENTRO do módulo 🗺️ Rotas (02/10/2026, pedido direto: "inclua
-- o relatório no sime, para imprimir junto com as rotas").
--
-- Até aqui esses dois documentos eram gerados FORA do app (script Python
-- avulso, PDF entregue direto ao cartório via relatorios/, gitignorado —
-- nome/CNH/placa real) porque dados como CNH/marca/modelo/ano/cor do
-- veículo nunca existiram no schema — só motorista (via
-- sime_rotas.responsavel_ator_id) e placa (sql/SIME_rotas_motoristas_urnas.sql,
-- 28/09/2026). Rodar um script Python fora do app pra cada atualização de
-- rota não escalava (o cartório não tem como gerar sozinho, e qualquer
-- correção de seção exigia eu regerar manualmente) — por isso virou feature
-- de verdade em sime_rotas_modulo.js (rtHtmlProtocoloEntrega/
-- rtHtmlChecklistVeiculo), lendo direto do banco como qualquer outra tela.
--
-- CNH é propriedade da PESSOA (sime_atores), não da rota — fica com o
-- motorista mesmo que a rota dele mude. Marca/modelo/ano/cor são
-- propriedade do VEÍCULO atribuído a ESSA rota (mesmo padrão já usado por
-- `placa`) — pode mudar numa eleição futura sem mexer no cadastro do
-- motorista.

alter table sime_rotas add column if not exists veiculo_descricao text;
comment on column sime_rotas.veiculo_descricao is 'Marca/Modelo do veículo cedido pra essa rota (texto livre, ex.: "GM/Classic Life") — alimenta o Protocolo de Entrega/Recolhimento de UE e o Check List de Veículos impressos pelo módulo de Rotas.';

alter table sime_rotas add column if not exists veiculo_ano text;
comment on column sime_rotas.veiculo_ano is 'Ano de fabricação/modelo do veículo (texto livre, ex.: "2008 / 2008").';

alter table sime_rotas add column if not exists veiculo_cor text;
comment on column sime_rotas.veiculo_cor is 'Cor do veículo (texto livre).';

alter table sime_atores add column if not exists cnh_numero text;
comment on column sime_atores.cnh_numero is 'Número da CNH do ator (texto livre, nunca validado) — usado no Check List de Veículos impresso pelo módulo de Rotas quando o ator é responsável por uma rota.';

alter table sime_atores add column if not exists cnh_categoria text;
comment on column sime_atores.cnh_categoria is 'Categoria da CNH (ex.: AB, D, AD).';

-- Backfill das 12 rotas de distribuição de urna da 7ª Zona (UR1-UR12) com
-- os mesmos dados já usados no PDF avulso que este CLAUDE.md documentava
-- como "Rota 01..12" (fonte: planilha/CRLV da empresa contratada,
-- confirmada contra os nomes reais já em sime_atores — JAKNALDO/MANOEL,
-- não JARNALDO/MANUEL, que era um typo só do script Python avulso, nunca
-- do banco). Não é idempotente, não reaplica sozinho (UPDATE por código de
-- rota já existente).
with dados(rota, veiculo, ano, cor, cnh, cnh_cat) as (
  values
    ('UR1', 'GM/Classic Life', '2008 / 2008', 'Prata', '0237167878', 'D'),
    ('UR2', 'GM/Celta 4P Life', '2007 / 2007', 'Prata', '04623634980', 'AB'),
    ('UR3', 'Ford/Ka SE 1.0 HA', '2015 / 2015', 'Laranja', '00027222778', 'AB'),
    ('UR4', 'Fiat/Siena Attractiv 1.4', '2017 / 2017', 'Vermelha', '03974942537', 'AD'),
    ('UR5', 'VW/Gol 1.0', '2010 / 2011', 'Prata', '06011000001', 'AB'),
    ('UR6', 'VW/Gol 1.0 GIV', '2010 / 2011', 'Preta', '07771667607', 'D'),
    ('UR7', 'VW/Novo Voyage 1.0', '2012 / 2013', 'Prata', '02720002746', 'D'),
    ('UR8', 'Ford/Ecosport SE 1.5', '2018 / 2019', 'Vermelha', '2973251041', 'AB'),
    ('UR9', 'Fiat/Toro Freedom AT', '2017 / 2018', 'Branca', '02431835304', 'AB'),
    ('UR10', 'Toyota/Etios SD X', '2016 / 2016', 'Cinza', '02418852060', 'AD'),
    -- UR11: sem CRLV disponível na planilha-fonte — ano/cor ficam NULL de
    -- propósito (nunca um valor inventado; confirma-se na própria vistoria).
    ('UR11', 'VW/Novo Voyage 1.0', null, null, '01310201347', 'AB'),
    ('UR12', 'Fiat/Siena Attractiv 1.4', '2013 / 2013', 'Prata', '02489439150', 'AD')
)
update sime_rotas r
set veiculo_descricao = d.veiculo, veiculo_ano = d.ano, veiculo_cor = d.cor
from dados d
where r.codigo = d.rota and r.zona_id = (select id from sime_zonas where numero = 7);

with dados(rota, cnh, cnh_cat) as (
  values
    ('UR1', '0237167878', 'D'), ('UR2', '04623634980', 'AB'), ('UR3', '00027222778', 'AB'),
    ('UR4', '03974942537', 'AD'), ('UR5', '06011000001', 'AB'), ('UR6', '07771667607', 'D'),
    ('UR7', '02720002746', 'D'), ('UR8', '2973251041', 'AB'), ('UR9', '02431835304', 'AB'),
    ('UR10', '02418852060', 'AD'), ('UR11', '01310201347', 'AB'), ('UR12', '02489439150', 'AD')
)
update sime_atores a
set cnh_numero = d.cnh, cnh_categoria = d.cnh_cat
from dados d
join sime_rotas r on r.codigo = d.rota and r.zona_id = (select id from sime_zonas where numero = 7)
where a.id = r.responsavel_ator_id;

insert into sime_logs (acao, modulo, payload, ts) values (
  'rota_veiculo_cnh_populados_lote',
  'rotas',
  '{"origem":"protocolo_entrega_integrar_sime_02-10-2026","rotas":["UR1","UR2","UR3","UR4","UR5","UR6","UR7","UR8","UR9","UR10","UR11","UR12"]}'::jsonb,
  now()
);
