-- sime_mesarios_raw — RLS
--
-- A policy de SELECT já existia em produção (não documentada em nenhum .sql
-- do repo até agora — registrada aqui por completude, idempotente):
--   qualquer usuário autenticado lê o staging de QUALQUER zona. Aceitável:
--   é staging descartável de exportação do TRE, não tem dado mais sensível
--   que sime_atores em si (que já é zona-isolado), e as duas zonas hoje são
--   operadas pela mesma equipe.
drop policy if exists sime_mesarios_raw_select_authenticated on sime_mesarios_raw;
create policy sime_mesarios_raw_select_authenticated
on sime_mesarios_raw
for select
to authenticated
using (true);

-- Escrita (20/08/2026): antes só o SQL Editor com service_role conseguia
-- popular sime_mesarios_raw — o upload de CSV direto do navegador
-- (SIME_atores.html → "🔄 Sincronizar mesários") precisa de INSERT/DELETE
-- pela sessão da equipe. Mesmo padrão de secoes_zona_policy/usuarios_zona_policy:
-- RLS só isola por zona; permissão de feature (quem pode editar
-- equipe/seções/mesários) continua sendo checada no cliente, não aqui.
drop policy if exists mesarios_raw_write_zona on sime_mesarios_raw;
create policy mesarios_raw_write_zona
on sime_mesarios_raw
for all
to authenticated
using (
  zona_eleitoral_trabalho = (select numero::text from sime_zonas where id = sime_user_zona())
  or sime_is_super_admin()
)
with check (
  zona_eleitoral_trabalho = (select numero::text from sime_zonas where id = sime_user_zona())
  or sime_is_super_admin()
);
