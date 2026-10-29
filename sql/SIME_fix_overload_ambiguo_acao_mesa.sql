-- Bug real, achado em 11/09/2026, reportado pelo cartório: "Quando cadastro
-- um problema [SIME_mesario.html, token Z556SUFF, Seção 1, 7ª Zona] com o
-- devido pin não aparece em problema".
--
-- Causa raiz: as migrações de "🟡 Sendo atendido" (sql/SIME_mesa_estado_
-- assumido.sql, 11/09/2026) e "Posição estimada dos veículos"
-- (sql/SIME_rotas_estado_posicao.sql, 08/09/2026) usaram CREATE OR REPLACE
-- FUNCTION adicionando parâmetros novos no FIM da assinatura de
-- sime_acao_mesa()/sime_rota_estado_upsert() — mas o Postgres só substitui
-- uma função existente quando a ASSINATURA (quantidade/tipo de parâmetros)
-- é idêntica. Como as duas ganharam parâmetros extras, cada CREATE OR
-- REPLACE criou uma SOBRECARGA nova, em vez de substituir a antiga —
-- deixando as duas versões (antiga e nova) coexistindo no banco desde então,
-- sem que nenhum teste local (mock de Supabase, sem PostgREST de verdade)
-- pudesse detectar isso.
--
-- Quando um chamador antigo (SIME_mesario.html, SIME_motorista.html,
-- SIME_instalador.html, SIME_acessibilidade.html) chama sime_acao_mesa()/
-- sime_rota_estado_upsert() só com os parâmetros de sempre (sem os novos,
-- que são opcionais nas DUAS versões), o PostgREST não consegue decidir
-- sozinho qual das duas sobrecargas usar — devolve
-- "PGRST203: Could not choose the best candidate function" — e a escrita
-- falha. Do lado do navegador isso cai no mesmo tratamento de qualquer
-- falha de rede (fila offline, badge 🟡, retry a cada 30s) — só que o erro
-- NUNCA se resolve sozinho (não é intermitência de rede, é ambiguidade
-- permanente), então a ação fica pra sempre na fila, tentando e falhando,
-- sem o operador perceber que não é "só demorando sincronizar".
--
-- Confirmado em produção: sime_mesa_estado da 7ª Zona estava com 0 linhas
-- (nenhum pânico jamais tinha sido gravado desde a migração de "Sendo
-- atendido"), apesar de o cartório reportar ter registrado um problema de
-- verdade.
--
-- Corrigido removendo as versões ANTIGAS (assinatura menor) das duas
-- funções — as versões novas já são um superset compatível (os parâmetros
-- extras são sempre DEFAULT NULL) e já tinham GRANT EXECUTE pra
-- anon/authenticated/service_role, então nenhum chamador precisou mudar.
--
-- Verificado ao vivo, na mesma sessão em que o bug foi corrigido: o
-- celular do próprio cartório (token Z556SUFF) tinha um pânico "energia"
-- preso na fila offline — assim que a ambiguidade foi removida, o retry
-- automático do navegador sincronizou sozinho (sem o cartório precisar
-- fazer nada) e a ocorrência apareceu em SIME_problemas.html, sendo
-- inclusive resolvida pelo próprio cartório logo em seguida, ainda durante
-- a investigação.
--
-- Lição pro futuro: ao ADICIONAR parâmetro a uma função já chamada pelo
-- frontend, sempre confirmar depois (via
-- `select proname, count(*) from pg_proc where proname='<nome>' group by
-- proname having count(*) > 1`) que não sobrou mais de uma sobrecarga —
-- CREATE OR REPLACE nunca avisa quando, na prática, cria uma função nova
-- em vez de substituir.

DROP FUNCTION IF EXISTS public.sime_acao_mesa(
  uuid, uuid, integer, integer, integer, integer, boolean, boolean, boolean,
  boolean, boolean, integer, boolean, boolean, boolean, boolean, boolean,
  boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean,
  boolean, text, text
);

DROP FUNCTION IF EXISTS public.sime_rota_estado_upsert(
  uuid, uuid, text, text, boolean, boolean, boolean, boolean
);
