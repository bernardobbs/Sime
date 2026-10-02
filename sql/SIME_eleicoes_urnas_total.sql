-- Total de urnas configurável (22/09/2026)
--
-- Pedido direto, mandado como dado solto: "serão preparadas 147 urnas de
-- seções, 27 contingências, 174 urnas ao todo". Esclarecido via
-- AskUserQuestion (a única opção que fazia sentido com "guardados
-- separadamente"): ajustar a fonte do "Total" mostrado nas telas de
-- carga/lacre (TV Preparação, Coordenador de Preparação) pra refletir esses
-- 174 (147+27), em vez de continuar derivando de `sime_secoes.length`.
--
-- Até aqui o "Total" dessas duas telas era literalmente a contagem de
-- seções da zona (`SECOES.length`/`getSecoes().length`) — 176 na 7ª Zona
-- depois da Seção 263 (Penitenciária, ver seção própria no CLAUDE.md). Esse
-- número nunca foi "quantas urnas serão preparadas" de verdade — é só
-- quantas seções existem. O cartório trouxe o número operacional real:
-- 147 urnas de seção + 27 de contingência.
--
-- Guardado em `sime_eleicoes` (não uma constante no front), mesmo padrão já
-- usado por `valor_auxilio_alimentacao`/`minutos_por_eleitor_fila`: dois
-- números NULLable, sem default — sem valor configurado, o Total continua
-- exatamente como sempre foi (derivado de `SECOES.length`), nunca um número
-- inventado. Dois campos separados (não um `urnas_total` só) porque o
-- pedido foi explícito nos dois números — o cartório pode querer ver cada
-- um separadamente no futuro, e um total só perderia essa distinção.
ALTER TABLE sime_eleicoes ADD COLUMN IF NOT EXISTS urnas_secoes INTEGER;
ALTER TABLE sime_eleicoes ADD COLUMN IF NOT EXISTS urnas_contingencia INTEGER;

-- Aplicado só na eleição ATIVA da 7ª Zona (prioridade do projeto, ver
-- "PENDÊNCIAS" no CLAUDE.md — a 94ª segue zerada, fora do foco atual).
-- Rodar de novo se a eleição ativa mudar de linha (2º turno) ou os números
-- forem revisados pelo cartório.
UPDATE sime_eleicoes
SET urnas_secoes = 147, urnas_contingencia = 27
WHERE zona_id = (SELECT id FROM sime_zonas WHERE numero = 7)
  AND ativa = true;
