-- Contador de acesso à busca pública de local de votação (25/10/2026)
--
-- Pedido direto: "seria possivel acrescentar algum tipo de contador de
-- acesso no https://sime-cyan.vercel.app/onde-votar" — distinto de
-- sql/SIME_busca_local_votacao_log.sql (23/10/2026), que só registra
-- BUSCAS (quem digitou um termo e apertou buscar). Esta tabela registra
-- toda vez que a página em si é ABERTA, mesmo sem buscar nada — pra dar
-- dois números separados: "quantas vezes a página foi aberta" e "quantas
-- buscas foram feitas".
--
-- Mesmo padrão arquitetural de sime_busca_local_log: tabela append-only,
-- RPC SECURITY DEFINER, GRANT EXECUTE pra anon/authenticated (a página é
-- pública, sem login) — nunca abre a tabela em si pra anon via RLS.
create table if not exists sime_busca_local_visita_log (
  id        bigserial primary key,
  zona_id   uuid not null references sime_zonas(id),
  criado_em timestamptz not null default now()
);
create index if not exists idx_busca_local_visita_log_zona on sime_busca_local_visita_log(zona_id);
create index if not exists idx_busca_local_visita_log_criado on sime_busca_local_visita_log(criado_em);

alter table sime_busca_local_visita_log enable row level security;
drop policy if exists busca_local_visita_log_select on sime_busca_local_visita_log;
create policy busca_local_visita_log_select on sime_busca_local_visita_log
  for select using (sime_zona_visivel(zona_id));
-- (sem policy de insert/update/delete pra ninguém — só a função abaixo escreve)

create or replace function public.sime_registrar_visita_local_votacao()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_zona_id uuid;
begin
  select id into v_zona_id from sime_zonas where numero = 7;
  if v_zona_id is null then return; end if;
  insert into sime_busca_local_visita_log (zona_id) values (v_zona_id);
exception when others then
  -- nunca deixa uma falha de log quebrar o carregamento da página pública
  null;
end;
$$;

revoke execute on function public.sime_registrar_visita_local_votacao() from public;
grant execute on function public.sime_registrar_visita_local_votacao() to anon, authenticated;
