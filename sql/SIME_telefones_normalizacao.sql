-- sime_atores.telefone_whatsapp — normalização pro padrão "55" + DDD + número
--
-- Aplicado em 21/08/2026, a pedido do cartório ("como normalizamos todos os
-- telefones para ser padrão WhatsApp?"), depois de descobrir — investigando o
-- bug de "Salvar reescrevia o telefone sem o 55" (ver comentário em
-- cmSalvarModal(), modules/sime_contatar_mesarios.js) — que ~32% dos 723
-- atores ativos com telefone (232 registros) NÃO estavam no formato "55" +
-- DDD + número que o resto do sistema assume (Ciente/colar-lista já gravam
-- assim, cmSalvarModal também desde o fix de 21/08).
--
-- Levantamento por quantidade de dígitos (antes do fix):
--   13 dígitos — 461 já corretos ("55"+DDD+9)
--   11 dígitos —  86 só faltava o "55" (DDD+9, celular completo)          → seguro
--   12 dígitos —  20 — dois formatos misturados nesse balde:
--                      14 com "0" extra na frente (erro de digitação —
--                         "0"+DDD+9 em vez de DDD+9) → tira o 0, soma 55
--                       5 já "55"+DDD+8 — 3 são fixo (não mexe) e 2 são
--                         celular formato antigo (falta o dígito 9)      → soma o 9
--                       1 é "000000000000" (placeholder de "sem telefone",
--                         não é um número — não mexe, nunca vira um número
--                         inventado)
--   10 dígitos —   9 — DDD + 8 dígitos, sem 55; todos com o subscriber
--                      começando 6-9 (celular formato antigo)             → soma dígito 9 + 55
--    9 dígitos —  85 — já celular completo (começa com 9), só falta DDD   → assume DDD 86 (zonas do SIME são só no Piauí, DDD único)
--    8 dígitos —  33 — sem DDD; 3 começam 3/5 (fixo, sem dígito 9) e 30
--                      começam 6-9 (celular formato antigo)               → assume DDD 86 (+ dígito 9 se celular)
--   14 dígitos —   1 — um dígito a mais depois do "55" (mesmo artefato já
--                      documentado no parser de "colar lista" — provável
--                      cópia/formatação da planilha de origem). NÃO
--                      corrigido automaticamente — teria que adivinhar QUAL
--                      dígito é o duplicado, e um número errado é pior que
--                      um número feio. Fica para revisão manual do cartório.
--
-- Regra pra "começa com 6-9 = celular formato antigo, precisa do dígito 9":
-- número de celular brasileiro ganhou o 9º dígito bem antes de 2016 pra
-- linhas que já começavam 6/7/8/9 (fixo começa 2-5 e nunca ganhou o 9).
-- Verificado nos 723 registros: nenhuma exceção a essa regra nem à regra de
-- "todo 13 dígitos começa com 55" nem "todo 11 dígitos tem o dígito 9 na
-- 3ª posição" — as três premissas foram checadas por COUNT antes de aplicar.
--
-- O SQL abaixo foi rodado via SQL Editor (execute_sql, service_role) — não é
-- uma migração que rode de novo sozinha (idempotente por natureza: a
-- cláusula "novo IS DISTINCT FROM telefone_whatsapp" já não pega mais nada
-- depois de aplicado uma vez). Documentado aqui pra auditoria, não pra
-- reaplicar.

with base as (
  select id, telefone_whatsapp,
    regexp_replace(telefone_whatsapp, '\D', '', 'g') as d
  from sime_atores
  where ativo = true and telefone_whatsapp is not null and telefone_whatsapp <> ''
),
base2 as ( select *, length(d) as len from base ),
calc as (
  select id, telefone_whatsapp, d, len,
    case
      -- placeholder de "sem telefone" — nunca vira um número inventado
      when d = '000000000000' then telefone_whatsapp
      -- já no padrão
      when len = 13 and left(d,2) = '55' then telefone_whatsapp
      -- DDD + 9 dígitos (celular completo), só falta o 55
      when len = 11 then '55' || d
      -- DDD + 8 dígitos, sem 55 — soma o dígito 9 se for celular (começa 6-9)
      when len = 10 then
        case when substring(d from 3 for 1) in ('6','7','8','9')
          then '55' || substring(d from 1 for 2) || '9' || substring(d from 3 for 8)
          else '55' || d end
      -- 9 dígitos já celular completo (começa 9), só falta DDD — assume 86
      when len = 9 and left(d,1) = '9' then '5586' || d
      -- 8 dígitos sem DDD — assume 86, soma dígito 9 se for celular
      when len = 8 then
        case when left(d,1) in ('6','7','8','9')
          then '55869' || d
          else '5586' || d end
      -- "0" extra na frente de um DDD+9 já completo (erro de digitação)
      when len = 12 and left(d,1) = '0' then '55' || substring(d from 2)
      -- "55"+DDD+8 já com o país — soma dígito 9 se for celular, senão é fixo (não mexe)
      when len = 12 and left(d,2) = '55' then
        case when substring(d from 5 for 1) in ('6','7','8','9')
          then substring(d from 1 for 4) || '9' || substring(d from 5 for 8)
          else d end
      else telefone_whatsapp -- 14 dígitos (dígito a mais) ou outro caso não previsto: não mexe
    end as novo
  from base2
)
update sime_atores a
set telefone_whatsapp = c.novo
from calc c
where a.id = c.id and c.novo is distinct from c.telefone_whatsapp
returning a.id;

-- Resultado real (21/08/2026): 229 registros atualizados. Sobraram 7 com
-- menos de 13 dígitos (esperado, não são bug):
--   6 fixos válidos no formato "55"+DDD+8 (12 dígitos — fixo não ganha o 9)
--   1 "000000000000" — pendência do cartório: confirmar se a pessoa
--     (MARIA DE FATIMA GOMES EDUVIRGES) tem telefone de verdade, ou limpar
--     o campo (NULL) se realmente não tem.
-- E 1 com 14 dígitos (ANA KAROLIINE DA SILVA ALVES, "55869994881793") —
-- dígito a mais, não corrigido automaticamente; revisão manual do cartório
-- pra confirmar qual dígito sobra antes de editar.

-- ── Segunda varredura (21/08/2026, mesmo dia) ──────────────────────────
-- Pedido de novo pelo cartório ("procure na base e normalize todos os
-- contatos para whatsapp"). Achado: o cartório estava usando o site ao
-- vivo enquanto os 3 caminhos de importação (Atualizar contatos, colar
-- lista, roster do TRE) ainda não normalizavam na escrita — esse uso real,
-- na janela entre a varredura acima e o fix dos 3 caminhos ficar no ar
-- (ver CLAUDE.md, "Todo import normaliza telefone pro padrão WhatsApp
-- agora"), gravou 237 números novos fora do padrão. Como o upsert do
-- roster (sime_sync_atores_from_raw) só preenche telefone_whatsapp quando
-- o campo está vazio (nunca sobrescreve), um número ruim gravado uma vez
-- fica permanentemente errado até uma varredura manual como esta — não é
-- bug, é a mesma troca deliberada de "nunca desfazer correção manual".
--
-- Reaproveita a função sime_normalizar_telefone_whatsapp() (criada nesse
-- meio-tempo pro roster/JS) em vez de reescrever o CASE acima — mesma
-- heurística, já testada. Idempotente por natureza (mesma cláusula
-- IS DISTINCT FROM):
--
--   update sime_atores a
--   set telefone_whatsapp = sime_normalizar_telefone_whatsapp(a.telefone_whatsapp)
--   where a.ativo = true and a.telefone_whatsapp is not null and a.telefone_whatsapp <> ''
--     and sime_normalizar_telefone_whatsapp(a.telefone_whatsapp) is distinct from a.telefone_whatsapp
--   returning a.id;
--
-- Resultado real: 237 registros atualizados. Rodada a checagem de novo
-- logo em seguida (mesma query, sem o UPDATE) — 0 candidatos restantes,
-- confirma que não sobrou nada pra essa varredura. Sobraram os mesmos 8
-- casos que exigem revisão humana, não são bug: 6 fixos válidos "55"+DDD+8
-- (mais 3 que apareceram desde a primeira varredura — SAMARA DA CUNHA
-- OLIVEIRA, JULIANO JOSÉ DA SILVA VIEIRA CARDOSO, ANDRÉA DE SOUSA ARAÚJO —
-- todos fixos de verdade, subscriber começando 3, corretamente preservados
-- sem o dígito 9), o placeholder da MARIA DE FATIMA e o caso de 14 dígitos
-- da ANA KAROLIINE (os dois já citados acima, ainda pendentes).
