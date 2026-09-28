-- Motoristas das 12 rotas de urna (distribuição UR1-UR12 + recolhimento
-- RU1-RU12) + coluna sime_rotas.placa
--
-- Pedido direto (28/09/2026), mesma sessão de "🚙 Veículos à Disposição":
-- "esses são os contatos por rota" — tabela colada com ROTA (1-12),
-- MOTORISTA, TELEFONE, PLACA. Diferente de sime_veiculos_disposicao (frota
-- de plantão cedida por órgãos, sem rota fixa) — isto preenche o campo
-- `responsavel_ator_id` que sime_rotas JÁ tinha desde 04-08/09/2026 (ver
-- "🗺️ MÓDULO ROTAS" no CLAUDE.md) mas que nunca tinha sido usado: as 24
-- rotas de urna da 7ª Zona estavam todas com responsavel_ator_id NULL.
--
-- `sime_rotas.placa` é nova — a única coisa que faltava pra guardar o
-- veículo de cada rota junto do responsável (rtCarregar/ficha impressa já
-- mostravam nome+telefone do responsável; a placa não tinha onde morar).
--
-- Mesmo motorista/placa em UR{n} e RU{n} — é o mesmo veículo fazendo o
-- trajeto de ida (distribuição) e volta (recolhimento, em outro dia, ver
-- "recolhimento de urna é a distribuição percorrida ao contrário" no
-- CLAUDE.md), não duas pessoas diferentes por padrão.
--
-- Os 12 motoristas viraram sime_atores (funcao='motorista', já existia no
-- enum sime_ator_funcao) — nenhum nome batia com ator já cadastrado na
-- zona (conferido antes de inserir). 2 dos 12 vieram sem telefone na
-- planilha original (Luciano Sousa Silva, rota 6; Antonio Willibaldo
-- Machado, rota 11) — ficou NULL, nunca inventado.
alter table sime_rotas add column if not exists placa text;

with dados(rota, motorista, telefone, placa) as (
  values
    (1,'FRANCISCO CARLOS COSTA LIMA','995061293','NHX1905'),
    (2,'TERCIO LIMA E SILVA','981624227','LVR2311'),
    (3,'Mª DO ROSARIO LEITE DOS SANTOS','994111031','PIH1F54'),
    (4,'NORBERTO MENDES','988421693','PSU1A07'),
    (5,'RENNA LAYSE DE SOUSA','981578110','NIS2E16'),
    (6,'LUCIANO SOUSA SILVA',null,'NIW6833'),
    (7,'JOSÉ SAMPAIO DE CASTRO FILHO','995949292','OEI3D28'),
    (8,'MANOEL JOSE WANDERSON','994153172','PIY3930'),
    (9,'JAKNALDO ANDRADE SOARES','994553713','PIR0E64'),
    (10,'JULIO DE SOUSA SANTOS','981477746','PIQ3C72'),
    (11,'ANTONIO WILLIBALDO MACHADO',null,'ODX5I41'),
    (12,'RAIMUNDO NONATO RODRIGUES','981707496','OUD0427')
),
novos_atores as (
  insert into sime_atores (zona_id, nome_completo, telefone_whatsapp, funcao, ativo, observacao)
  select (select id from sime_zonas where numero=7), d.motorista,
         case when d.telefone is null then null else sime_normalizar_telefone_whatsapp(d.telefone) end,
         'motorista', true,
         'Motorista de rota de urna (distribuição/recolhimento) — cadastrado a partir da lista de contatos por rota, 28/09/2026.'
  from dados d
  returning id, nome_completo
)
update sime_rotas r
set responsavel_ator_id = na.id,
    placa = d.placa
from dados d
join novos_atores na on na.nome_completo = d.motorista
where r.zona_id = (select id from sime_zonas where numero=7)
  and r.codigo in ('UR'||d.rota, 'RU'||d.rota);

-- Nota: UR13 (a 13ª rota de distribuição, sem RU correspondente) ficou de
-- fora de propósito — a lista colada só tinha 12 linhas, "ROTA 1" a
-- "ROTA 12"; não há motorista/placa informado pra ela ainda.
