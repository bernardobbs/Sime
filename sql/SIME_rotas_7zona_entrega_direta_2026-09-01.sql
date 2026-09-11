-- Rotas de ENTREGA DIRETA da 7ª Zona — os 17 locais de votação que o export
-- do MaxLog (31/08/2026) não cobriu.
--
-- Pedido direto do cartório em 01/09/2026, ao revisar a lista de locais
-- "sem rota" que sobrou de SIME_rotas_7zona_maxlog_2026-08-31.sql:
--   - Campo Maior (13 locais): "os presidentes levam para o cartório
--     eleitoral diretamente";
--   - U.E. Tertuliano Pereira e U.E. João Félix de Andrade (Jatobá):
--     "os presidentes levam ao ponto de transmissão da Creche Mamãe Lima";
--   - U.E. José Ribeiro da Luz e U.E. Dr. Jerônimo S. Silva (Sigefredo):
--     "os presidentes levam para o ponto de transmissão do Monsenhor Mateus".
--
-- Ou seja: NÃO são rotas de veículo do MaxLog — o trajeto é feito pelo
-- próprio presidente de mesa. Ficam registradas como rota mesmo assim
-- (decisão do cartório) pra que toda seção da zona tenha uma rota e esses
-- locais parem de aparecer como pendência nas telas de distribuição/mídias.
--
-- Formato escolhido pelo cartório: UMA ROTA POR LOCAL em Campo Maior
-- (021-033), em vez de uma rota única de entrega direta — dá pra acompanhar
-- local a local. Para os pontos de consolidação, DUAS ROTAS PRÓPRIAS de
-- entrega (034/035), separadas das rotas 019/020 que fazem o trecho de
-- veículo ponto→cartório: assim fica explícito qual trecho é do presidente
-- e qual é do veículo.
--
-- NÃO é idempotente (mesmo motivo do arquivo do MaxLog: `codigo` não é
-- UNIQUE em sime_rotas) — rodar de novo duplicaria as rotas 021-035.
--
-- ⚠️ U.E. Antônio Rodrigues (seção 146) ficou DELIBERADAMENTE DE FORA,
-- apesar de constar na lista que o cartório mandou. Investigado em
-- 01/09/2026: é registro fantasma em sime_secoes — eleitores nulo, zero
-- atores (nem inativos), zero linhas em sime_mesarios_raw (nem pela seção
-- nem pelo nome do local) e zero dependências em mesa_estado/midias/
-- carga_lacre/ocorrencias. Criar rota pra ela consolidaria dado ruim.
-- Pendente decisão do cartório: apagar a seção ou confirmar que existe.

begin;

with z as (
  select id from sime_zonas where numero = 7
), novas as (
  select * from (values
    ('021','Centro Ed. JA Mulata Lima','Campo Maior'),
    ('022','Clube dos Comerciários','Campo Maior'),
    ('023','Col. Est. Profª Raimundinho','Campo Maior'),
    ('024','Creche Tia Medeiros','Campo Maior'),
    ('025','EMATER','Campo Maior'),
    ('026','Esc. Mun. N.S. de Fátima','Campo Maior'),
    ('027','FSESP','Campo Maior'),
    ('028','G.E. Treze de Março','Campo Maior'),
    ('029','G.E. Valdivino Tito','Campo Maior'),
    ('030','Prefeitura Municipal','Campo Maior'),
    ('031','SAAE','Campo Maior'),
    ('032','Sec. Mun. de Educação','Campo Maior'),
    ('033','U.E. Vida Verde','Campo Maior')
  ) as t(codigo, local_nome, municipio)
), ins as (
  insert into sime_rotas (zona_id, codigo, nome, municipios, itinerario, ativo)
  select z.id, n.codigo, 'Rota ' || n.codigo, array[n.municipio],
         n.local_nome || ' → Sede da 7ª Zona (entrega direta pelo presidente de mesa)',
         true
  from novas n cross join z
  returning id, codigo
)
update sime_secoes s
   set rota_id = ins.id
  from ins
  join novas n on n.codigo = ins.codigo
 where s.zona_id = (select id from sime_zonas where numero = 7)
   and s.rota_id is null
   and s.municipio = n.municipio
   and s.local_nome = n.local_nome;

-- 034 — entrega direta no ponto de consolidação da Creche Mamãe Lima
-- (Jatobá do Piauí). Dali em diante o trecho até o cartório é da rota 019.
with z as (select id from sime_zonas where numero = 7),
ins as (
  insert into sime_rotas (zona_id, codigo, nome, municipios, itinerario, ativo)
  select z.id, '034', 'Rota 034', array['Jatobá do Piauí'],
         'U.E. Tertuliano Pereira / U.E. João Félix de Andrade → Creche Mamãe Lima M. Oliveira '
         || '(entrega direta pelo presidente de mesa; o trecho ponto → Sede é da rota 019)',
         true
  from z
  returning id
)
update sime_secoes s
   set rota_id = ins.id
  from ins
 where s.zona_id = (select id from sime_zonas where numero = 7)
   and s.rota_id is null
   and s.municipio = 'Jatobá do Piauí'
   and s.local_nome in ('U.E. Tertuliano Pereira', 'U.E. João Félix de Andrade');

-- 035 — entrega direta no ponto de consolidação do G.E. Monsenhor Mateus
-- (Sigefredo Pacheco). Dali em diante o trecho até o cartório é da rota 020.
with z as (select id from sime_zonas where numero = 7),
ins as (
  insert into sime_rotas (zona_id, codigo, nome, municipios, itinerario, ativo)
  select z.id, '035', 'Rota 035', array['Sigefredo Pacheco'],
         'U.E. José Ribeiro da Luz / U.E. Dr. Jerônimo S. Silva → G.E. Monsenhor Mateus '
         || '(entrega direta pelo presidente de mesa; o trecho ponto → Sede é da rota 020)',
         true
  from z
  returning id
)
update sime_secoes s
   set rota_id = ins.id
  from ins
 where s.zona_id = (select id from sime_zonas where numero = 7)
   and s.rota_id is null
   and s.municipio = 'Sigefredo Pacheco'
   and s.local_nome in ('U.E. José Ribeiro da Luz', 'U.E. Dr. Jerônimo S. Silva');

commit;
