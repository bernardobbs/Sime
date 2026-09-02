-- Atualização das rotas de recolhimento de mídia da 7ª Zona a partir do
-- MaxLog (Sistema de Logística das Eleições do TRE), export oficial de
-- 31/08/2026 — pedido direto: "essas rotas que enviei hoje são as
-- definitivas, as que existiam antes vamos desconsiderar".
--
-- Já aplicado em produção via SQL Editor/MCP em 31/08/2026 — documentado
-- aqui pra auditoria, igual SIME_telefones_normalizacao.sql. NÃO é
-- idempotente: os INSERT das rotas 013-020 duplicariam se rodado de novo
-- (sem ON CONFLICT, porque `codigo` não é UNIQUE em sime_rotas). Rodar de
-- novo só faz sentido se as rotas 013-020 forem apagadas antes.
--
-- Cobre 17 rotas / 42 locais de votação (das ~64 da zona). "Rota 4" tinha
-- duas versões no export (1º turno 04/10 e 2º turno 24/10, com paradas
-- totalmente diferentes) — sime_rotas não distingue por turno, então só a
-- versão de 1º turno foi usada aqui (decisão do cartório).
--
-- Rotas 001,002,003,004,006-012 já existiam (com outro conteúdo) — o
-- conteúdo é SUBSTITUÍDO pelo do MaxLog. Rotas 013-020 são novas (013-018
-- vêm direto do MaxLog; 019/020 são as duas rotas dos pontos de
-- consolidação, ver bloco abaixo).
-- Rota 005 não veio no export desta vez — fica intocada.
--
-- Efeito colateral necessário: seções de locais que estavam nas rotas
-- redefinidas (004,006,009,012) mas NÃO aparecem no export MaxLog viram
-- "sem rota" (rota_id=NULL) — deixá-las apontando pra uma rota que agora
-- significa outra coisa seria pior que marcar como pendente.
--
-- Creche Mamãe Lima M. Oliveira e G.E. Monsenhor Mateus são "ponto de
-- consolidação" de várias rotas ao mesmo tempo (011+012+013 e 014+015+016,
-- respectivamente) — pedido direto do cartório: as seções que ficam
-- FISICAMENTE nesses dois locais ganham rota PRÓPRIA (019 e 020), separada
-- das rotas que só passam por ali a caminho da sede.

begin;

-- 1) Rotas já existentes (001-004,006-012) — conteúdo substituído
update sime_rotas set nome='Rota 001', municipios=array['Sigefredo Pacheco'],
  itinerario='U.E. Miguel Rocha → G.E. Manoel Pereira dos Reis → U.E. Antônio Pereira Santos → G.E. Manoel Francisco'
where zona_id=(select id from sime_zonas where numero=7) and codigo='001';

update sime_rotas set nome='Rota 002', municipios=array['Jatobá do Piauí'],
  itinerario='G.E. de Tanques → Sede da 7ª Zona'
where zona_id=(select id from sime_zonas where numero=7) and codigo='002';

update sime_rotas set nome='Rota 003', municipios=array['Jatobá do Piauí'],
  itinerario='U.E. Rafael Nogueira Passos → Sede da 7ª Zona'
where zona_id=(select id from sime_zonas where numero=7) and codigo='003';

update sime_rotas set nome='Rota 004', municipios=array['Campo Maior'],
  itinerario='Esc. Reassentamento Corredores → Salão Com. Corredores → Sede da 7ª Zona'
where zona_id=(select id from sime_zonas where numero=7) and codigo='004';

update sime_rotas set nome='Rota 006', municipios=array['Campo Maior'],
  itinerario='G.E. Povoado Tapera → U.E. Linoca Gayoso → U.E. José Gonçalves Oliveira → Sede da 7ª Zona'
where zona_id=(select id from sime_zonas where numero=7) and codigo='006';

update sime_rotas set nome='Rota 007', municipios=array['Campo Maior / Jatobá'],
  itinerario='Posto Saúde da Varjota → Esc. Mun. Mano Castelo Branco → Igreja da Morada Nova → Escola Mun. da Montanha → U.E. Francisco F.P. Oliveira → Sede da 7ª Zona'
where zona_id=(select id from sime_zonas where numero=7) and codigo='007';

update sime_rotas set nome='Rota 008', municipios=array['Campo Maior'],
  itinerario='Salão Com. Santo Antônio → Sede da 7ª Zona'
where zona_id=(select id from sime_zonas where numero=7) and codigo='008';

update sime_rotas set nome='Rota 009', municipios=array['Campo Maior / Jatobá'],
  itinerario='G.E. Aguida M. Conceição → Creche Vovô José → U.E. Oscar Gil C. Branco → Esc. Mun. A.M. Castelo Branco → G.E. Anita Gaioso → U.E. José Cândido Gaioso → Sede da 7ª Zona'
where zona_id=(select id from sime_zonas where numero=7) and codigo='009';

update sime_rotas set nome='Rota 010', municipios=array['Sigefredo Pacheco'],
  itinerario='U.E. Ivon Pacheco → Sede da 7ª Zona'
where zona_id=(select id from sime_zonas where numero=7) and codigo='010';

update sime_rotas set nome='Rota 011', municipios=array['Jatobá do Piauí'],
  itinerario='Posto Saúde M. Sousa Dié → Salão Comunitário → Creche Mamãe Lima M. Oliveira (ponto de consolidação)'
where zona_id=(select id from sime_zonas where numero=7) and codigo='011';

update sime_rotas set nome='Rota 012', municipios=array['Jatobá do Piauí'],
  itinerario='G.E. Prof. Francisco Luis → Creche Mamãe Lima M. Oliveira (ponto de consolidação)'
where zona_id=(select id from sime_zonas where numero=7) and codigo='012';

-- 2) Rotas novas (013-020)
insert into sime_rotas (zona_id, codigo, nome, municipios, itinerario, ativo)
select (select id from sime_zonas where numero=7), '013', 'Rota 013', array['Jatobá do Piauí'],
  'Grupo Escolar → Creche Mamãe Lima M. Oliveira (ponto de consolidação)', true;

insert into sime_rotas (zona_id, codigo, nome, municipios, itinerario, ativo)
select (select id from sime_zonas where numero=7), '014', 'Rota 014', array['Jatobá / Sigefredo'],
  'Esc. Mun. A.F. Ribeiro Paz → U.E. da Paz Sousa → U.E. Antonio Cícero Oliveira → U.E. Antonio Carmelo Barbosa → U.E. Manoel Rodrigues Melo → G.E. Monsenhor Mateus (ponto de consolidação)', true;

insert into sime_rotas (zona_id, codigo, nome, municipios, itinerario, ativo)
select (select id from sime_zonas where numero=7), '015', 'Rota 015', array['Sigefredo Pacheco'],
  'Esc. Rural Sto. Antônio C.V. → G.E. Monsenhor Mateus (ponto de consolidação)', true;

insert into sime_rotas (zona_id, codigo, nome, municipios, itinerario, ativo)
select (select id from sime_zonas where numero=7), '016', 'Rota 016', array['Sigefredo Pacheco'],
  'U.E. Jovino Josino Oliveira → G.E. Monsenhor Mateus (ponto de consolidação)', true;

insert into sime_rotas (zona_id, codigo, nome, municipios, itinerario, ativo)
select (select id from sime_zonas where numero=7), '017', 'Rota 017', array['Campo Maior'],
  'G.E. Profª Maroquinha → Sede da 7ª Zona', true;

insert into sime_rotas (zona_id, codigo, nome, municipios, itinerario, ativo)
select (select id from sime_zonas where numero=7), '018', 'Rota 018', array['Campo Maior'],
  'U.E. José Gomes de Oliveira → Salão Com. ''Mario Cazuza'' → Sede da 7ª Zona', true;

-- Rotas dedicadas aos dois pontos de consolidação (pedido direto)
insert into sime_rotas (zona_id, codigo, nome, municipios, itinerario, ativo)
select (select id from sime_zonas where numero=7), '019', 'Rota 019', array['Jatobá do Piauí'],
  'Creche Mamãe Lima M. Oliveira → Sede da 7ª Zona (rota própria do local — recebe mídia das rotas 011/012/013 também)', true;

insert into sime_rotas (zona_id, codigo, nome, municipios, itinerario, ativo)
select (select id from sime_zonas where numero=7), '020', 'Rota 020', array['Sigefredo Pacheco'],
  'G.E. Monsenhor Mateus → Sede da 7ª Zona (rota própria do local — recebe mídia das rotas 014/015/016 também)', true;

-- 3) Reatribui rota_id de cada seção, casando por local_nome (42 locais do
-- export MaxLog) — todas as seções daquele local recebem a mesma rota.
with mapa(local_nome, codigo) as (
  values
    ('U.E. Miguel Rocha','001'), ('G.E. Manoel Pereira dos Reis','001'),
    ('U.E. Antônio Pereira Santos','001'), ('G.E. Manoel Francisco','001'),
    ('G.E. de Tanques','002'),
    ('U.E. Rafael Nogueira Passos','003'),
    ('Esc. Reassentamento Corredores','004'), ('Salão Com. Corredores','004'),
    ('G.E. Povoado Tapera','006'), ('U.E. Linoca Gayoso','006'), ('U.E. José Gonçalves Oliveira','006'),
    ('Posto Saúde da Varjota','007'), ('Esc. Mun. Mano Castelo Branco','007'),
    ('Igreja da Morada Nova','007'), ('Escola Mun. da Montanha','007'), ('U.E. Francisco F.P. Oliveira','007'),
    ('Salão Com. Santo Antônio','008'),
    ('G.E. Aguida M. Conceição','009'), ('Creche Vovô José','009'), ('U.E. Oscar Gil C. Branco','009'),
    ('Esc. Mun. A.M. Castelo Branco','009'), ('G.E. Anita Gaioso','009'), ('U.E. José Cândido Gaioso','009'),
    ('U.E. Ivon Pacheco','010'),
    ('Posto Saúde M. Sousa Dié','011'), ('Salão Comunitário','011'),
    ('G.E. Prof. Francisco Luis','012'),
    ('Grupo Escolar','013'),
    ('Esc. Mun. A.F. Ribeiro Paz','014'), ('U.E. da Paz Sousa','014'), ('U.E. Antonio Cícero Oliveira','014'),
    ('U.E. Antonio Carmelo Barbosa','014'), ('U.E. Manoel Rodrigues Melo','014'),
    ('Esc. Rural Sto. Antônio C.V.','015'),
    ('U.E. Jovino Josino Oliveira','016'),
    ('G.E. Profª Maroquinha','017'),
    ('U.E. José Gomes de Oliveira','018'), ('Salão Com. ''Mario Cazuza''','018'),
    ('Creche Mamãe Lima M. Oliveira','019'),  -- rota própria (pedido direto), não 011/012/013
    ('G.E. Monsenhor Mateus','020')           -- rota própria (pedido direto), não 014/015/016
)
update sime_secoes s
set rota_id = r.id
from mapa m
join sime_rotas r on r.codigo = m.codigo and r.zona_id = (select id from sime_zonas where numero=7)
where s.zona_id = (select id from sime_zonas where numero=7)
  and s.local_nome = m.local_nome;

-- 4) Órfãos: seções cujo local_nome NÃO está no export MaxLog, mas cuja
-- rota_id atual é uma das redefinidas (004,006,009,012) — ficam sem rota,
-- em vez de continuar apontando pra uma rota que agora significa outra
-- coisa.
update sime_secoes s
set rota_id = null
from sime_rotas r
where s.rota_id = r.id
  and r.zona_id = (select id from sime_zonas where numero=7)
  and r.codigo in ('004','006','009','012')
  and s.local_nome not in (
    'Esc. Reassentamento Corredores','Salão Com. Corredores',
    'G.E. Povoado Tapera','U.E. Linoca Gayoso','U.E. José Gonçalves Oliveira',
    'G.E. Aguida M. Conceição','Creche Vovô José','U.E. Oscar Gil C. Branco',
    'Esc. Mun. A.M. Castelo Branco','G.E. Anita Gaioso','U.E. José Cândido Gaioso',
    'G.E. Prof. Francisco Luis'
  );

commit;
