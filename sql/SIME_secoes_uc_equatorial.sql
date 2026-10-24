-- UC (Unidade Consumidora) da Equatorial por LOCAL de votação — pedido
-- direto, lista de 23 locais da 7ª Zona com UC já identificada (13/09/2026).
-- Mesmo padrão de latitude/longitude (sql/SIME_rotas_modulo.sql): repetida
-- entre as seções do mesmo prédio, não é campo por seção.
--
-- Texto livre, nunca validado por regex — o formato varia demais entre
-- unidades (só dígitos, "A"+dígitos, "D"+dígitos, "A-"/"D-" com hífen, até
-- com espaço — "A 816430") — mesmo critério de sime_atores.codigo_rastreio.
--
-- Serve o Painel de Problemas: contato de "energia" (Equatorial) passa a
-- mostrar a UC do local junto do telefone, e a mensagem de WhatsApp
-- pré-pronta também inclui — evita o cartório procurar o número no meio de
-- uma ligação de urgência.

alter table sime_secoes add column if not exists uc_equatorial text;

-- Aplicação dos 23 valores (rodado uma vez via SQL Editor/MCP — não é
-- migração que reaplica sozinha; documentado aqui pra histórico). Casa por
-- local_nome+municipio (a UC é do prédio, nunca da seção isolada), nunca
-- pelo código "Local NNNN" do TSE, que o SIME não guarda.
with dados(local_nome, municipio, uc) as (values
  ('Assoc. Moradores Tangará',        'Campo Maior',       '15010458541'),
  ('U.E. Manoel Rodrigues Melo',      'Sigefredo Pacheco',  'A1248239'),
  ('Creche Mamãe Lima M. Oliveira',   'Jatobá do Piauí',    '37030019173'),
  ('Esc. Reassentamento Corredores',  'Campo Maior',        'D-94342'),
  ('Esc. Mun. A.M. Castelo Branco',   'Jatobá do Piauí',    '12031610360'),
  ('G.E. de Tanques',                 'Jatobá do Piauí',    'A2030715'),
  ('G.E. Manoel Francisco',           'Sigefredo Pacheco',  'D203235'),
  ('G.E. Monsenhor Mateus',           'Sigefredo Pacheco',  'D76872'),
  ('G.E. Manoel Pereira dos Reis',    'Sigefredo Pacheco',  'A2201407'),
  ('U.E. Ivon Pacheco',               'Sigefredo Pacheco',  'A2088740'),
  ('Igreja da Morada Nova',           'Jatobá do Piauí',    'A1693778'),
  ('U.E. José Cândido Gaioso',        'Jatobá do Piauí',    '15050913152'),
  ('Salão Comunitário',               'Jatobá do Piauí',    '15050965845'),
  ('Salão Com. Corredores',           'Campo Maior',        'A-641994'),
  ('Salão Com. Santo Antônio',        'Campo Maior',        '270644'),
  ('U.E. Antonio Carmelo Barbosa',    'Sigefredo Pacheco',  'A2112621'),
  ('U.E. Antonio Cícero Oliveira',    'Sigefredo Pacheco',  '15050299730'),
  ('U.E. Dr. Jerônimo S. Silva',      'Sigefredo Pacheco',  'D139567'),
  ('U.E. José Gomes de Oliveira',     'Campo Maior',        '17070095289'),
  ('U.E. Jovino Josino Oliveira',     'Sigefredo Pacheco',  'A1483332'),
  ('U.E. Miguel Rocha',               'Sigefredo Pacheco',  'A806698'),
  ('U.E. Oscar Gil C. Branco',        'Jatobá do Piauí',    '35110011782'),
  ('U.E. Rafael Nogueira Passos',     'Jatobá do Piauí',    'A 816430')
)
update sime_secoes s
set uc_equatorial = d.uc
from dados d
join sime_zonas z on z.numero = 7
where s.zona_id = z.id and s.local_nome = d.local_nome and s.municipio = d.municipio;
