-- sime_logs — backfill de eleicao_id em registros gravados sem ele
--
-- Bug real corrigido em 21/08/2026, achado investigando "Registrar
-- tentativa" em SIME_convocacao.html: a tela mostrava "✓ Tentativa
-- registrada" (o insert de fato sucedia — a policy de INSERT em sime_logs é
-- `WITH CHECK (true)`), mas a lista "Tentativas de contato" nunca mostrava
-- nada, e "Atualizações"/"📜 Histórico" (sime_historico_sync.js) também
-- ficavam sempre vazios pra quem gravava por essas telas.
--
-- Causa raiz: window.log() em SIME_convocacao.html e log() em
-- SIME_atores.html nunca preenchiam a coluna eleicao_id no insert. A policy
-- de SELECT de sime_logs é:
--   USING (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE sime_zona_visivel(zona_id)))
-- `NULL IN (...)` nunca é verdadeiro — então TODO registro gravado com
-- eleicao_id nulo por essas duas páginas ficava permanentemente invisível
-- na releitura pra qualquer usuário autenticado (só um service_role, que
-- ignora RLS, conseguiria ver). Confirmado em produção em 21/08/2026: 6
-- `mesario_tentativa_contato`, 8 `mesario_editar_telefone`, 2
-- `mesarios_sync_csv`, 1 `mesario_observacao_adicionada` e 1
-- `mesario_confirmado_manual`, todos com eleicao_id null.
--
-- O código já foi corrigido (as duas páginas agora resolvem a eleição ativa
-- da zona do usuário e preenchem eleicao_id no insert). Este arquivo só
-- conserta o que já tinha sido gravado antes do fix — não é preventivo,
-- é backfill de dado real represado.

-- 1) Logs cujo payload tem ator_id direto (mesario_editar_telefone,
--    mesario_editar_rastreio, mesario_meio_contato, mesario_status_contato_alt,
--    mesario_contato_incorreto, mesario_precisa_substituir,
--    mesario_confirmado_manual, mesario_observacao_adicionada,
--    mesario_tentativa_contato) — acha a zona pelo próprio ator e usa a
--    eleição ativa dessa zona.
update sime_logs l
set eleicao_id = e.id
from sime_atores a
join sime_eleicoes e on e.zona_id = a.zona_id and e.ativa = true
where l.eleicao_id is null
  and l.payload ? 'ator_id'
  and a.id = (l.payload->>'ator_id')::uuid;

-- 2) mesarios_sync_csv (sime_mesarios_sync.js) — não tem ator_id, tem
--    payload.zona (número da zona, texto) e payload.uf.
update sime_logs l
set eleicao_id = e.id
from sime_zonas z
join sime_eleicoes e on e.zona_id = z.id and e.ativa = true
where l.eleicao_id is null
  and l.acao = 'mesarios_sync_csv'
  and z.numero::text = l.payload->>'zona';

-- Conferência pós-backfill: deve devolver 0 linhas pras ações acima (pode
-- sobrar eleicao_id nulo em ações de OUTROS módulos que já preenchiam
-- corretamente ou não precisam — este arquivo só mexe nas ações listadas).
-- select acao, count(*) from sime_logs
--   where eleicao_id is null
--     and acao in ('mesario_tentativa_contato','mesarios_sync_csv',
--                  'mesario_observacao_adicionada','mesario_editar_telefone',
--                  'mesario_editar_rastreio','mesario_meio_contato',
--                  'mesario_status_contato_alt','mesario_contato_incorreto',
--                  'mesario_precisa_substituir','mesario_confirmado_manual')
--   group by 1;
