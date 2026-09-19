-- Correção + evolução do módulo de Rotas (04/09/2026, mesmo dia do módulo).
--
-- 1) CORREÇÃO: as 42 rotas do MaxLog (7ª+94ª) são de RECOLHIMENTO DE MÍDIA,
-- não de distribuição/recolhimento de urna — confirmado com o dono do
-- projeto revertendo a interpretação anterior (que tinha virado
-- `sql/SIME_rotas_modulo.sql`, aplicada ainda hoje, mesma sessão). Não
-- existe hoje NENHUMA rota de distribuição/recolhimento de urna cadastrada
-- — nascem do zero quando houver dado real, e são cadastros SEPARADOS: o
-- dono do projeto esclareceu que recolhimento de urna é a rota de
-- distribuição percorrida ao contrário, em outro dia, não a mesma linha —
-- por isso 'recolhimento_urna' saiu da lista de tipos "legados" que
-- escrevem em sime_secoes.rota_id (só 'distribuicao' continua).
UPDATE sime_rotas SET tipos = ARRAY['recolhimento_midia'];

-- 2) Estrutura de itinerário mais rica — toda rota tem ponto de partida,
-- pontos intermediários (já são as seções + parada em sime_rota_secoes),
-- destino, horário de saída e previsão de chegada.
ALTER TABLE sime_rotas ADD COLUMN IF NOT EXISTS ponto_partida TEXT;
ALTER TABLE sime_rotas ADD COLUMN IF NOT EXISTS destino TEXT;
ALTER TABLE sime_rotas ADD COLUMN IF NOT EXISTS horario_saida TIME;
ALTER TABLE sime_rotas ADD COLUMN IF NOT EXISTS horario_chegada_previsto TIME;

-- 3) Pessoa responsável pela rota (motorista/coordenador) — sempre opcional,
-- qualquer ator ativo da zona (não restrito por função).
ALTER TABLE sime_rotas ADD COLUMN IF NOT EXISTS responsavel_ator_id UUID REFERENCES sime_atores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_rotas_responsavel ON sime_rotas(responsavel_ator_id);

-- 4) Georreferência por LOCAL de votação (não por seção — sime_secoes não
-- tem tabela de "locais" própria; o valor repete entre as seções do mesmo
-- prédio, igual local_nome/municipio já fazem).
ALTER TABLE sime_secoes ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE sime_secoes ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- 5) sime_secoes.rota_id/parada apontavam pras rotas de mídia (item 1
-- acima) — Motorista/Conferente/TV Distribuição leem esses campos como se
-- fossem a rota de DISTRIBUIÇÃO, então mostravam dado errado (com
-- aparência de certo). Zero linhas em sime_rotas_estado/sime_rotas_urnas
-- na hora desta migração — ninguém tinha usado essas telas pra valer
-- ainda, era o momento mais barato pra corrigir. Limpo em vez de deixado
-- errado: "sem rota" avisa que falta cadastrar; dado errado não avisa nada.
UPDATE sime_secoes SET rota_id = NULL, parada = NULL WHERE rota_id IS NOT NULL;

-- 6) Georreferência da 7ª Zona (61 dos 64 locais distintos) — importada de
-- um KML (Google Earth/GEL, "Locais de Votação", gerado 19/06/2026) colado
-- pelo cartório, casando por NOME (não pelo "código" do local do KML, que
-- NÃO é único — achado real, o mesmo código aparece em até 3 locais
-- diferentes no arquivo). Casamento por similaridade de texto com
-- expansão de abreviação (U.E./G.E./Esc./Mun./Sec./Col./Prof.../etc.) +
-- 3 siglas revisadas manualmente (CAIC/SAAE/FSESP, que sozinhas batiam
-- melhor com nomes errados por acaso — corrigidas por conter a sigla como
-- palavra inteira no nome do KML). Rodado uma vez via SQL Editor/MCP — ver
-- histórico do chat pro script de geração, não fica reaplicável aqui.
-- 3 locais SEM correspondência no KML (ficaram sem geo, não adivinhados):
-- "Creche Tia Medeiros", "Sec. Mun. de Educação", "U.E. Antônio Rodrigues"
-- (nenhum dos três aparece no arquivo, sob nenhuma variação de nome).
