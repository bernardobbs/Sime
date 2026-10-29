-- Rastreio de uso da busca pública de local de votação (/onde-votar,
-- 24/10/2026) — pergunta exploratória: "como podemos rastrear o uso do
-- https://sime-cyan.vercel.app/onde-votar", respondida com duas opções
-- (Vercel Web Analytics — só pageview, sem saber o que foi buscado; ou log
-- no próprio banco, dentro da RPC — dá volume real e o que não achou
-- nada). Escolhida a segunda.
--
-- `sime_buscar_local_votacao()` já é SECURITY DEFINER — o INSERT abaixo
-- roda como o dono da função (postgres), nunca precisando conceder INSERT
-- pro `anon` na tabela nova. Mesma regra manual já documentada em
-- sql/SIME_hardening_rpc_anon.sql ("toda função nova precisa de um REVOKE
-- EXECUTE... FROM anon, a menos que deliberadamente pública") — esta
-- continua deliberadamente pública (grant intacto, mesmo contrato), só
-- ganhou o efeito colateral de logar.
create table if not exists sime_busca_local_log (
  id             bigserial primary key,
  zona_id        uuid not null references sime_zonas(id),
  termo          text not null,       -- exatamente o que a pessoa digitou, nunca normalizado
  qtd_resultados integer not null,
  criado_em      timestamptz not null default now()
);

create index if not exists idx_busca_local_log_zona on sime_busca_local_log(zona_id);
create index if not exists idx_busca_local_log_criado on sime_busca_local_log(criado_em);

alter table sime_busca_local_log enable row level security;
drop policy if exists busca_local_log_select on sime_busca_local_log;
create policy busca_local_log_select on sime_busca_local_log
  for select using (sime_zona_visivel(zona_id));
-- nenhuma policy de INSERT/UPDATE/DELETE pra ninguém (nem authenticated) —
-- a única escrita válida é a da própria função, que roda como o dono da
-- tabela e por isso nunca depende de RLS nem de GRANT nenhum pra gravar.

comment on table sime_busca_local_log is
  'Log append-only de cada busca feita em /onde-votar (sime_buscar_local_votacao) — termo digitado + quantidade de resultados devolvidos, gravado de dentro da própria função. Só pra medir uso real (volume por dia, buscas sem resultado); nunca atualizado, nunca lido por nenhum fluxo operacional.';

-- Mesma assinatura, mesmo contrato de retorno de sempre (ver
-- sql/SIME_busca_local_votacao_publica.sql) — a única mudança é logar a
-- busca antes de devolver. GET DIAGNOSTICS ... ROW_COUNT depois de um
-- RETURN QUERY dá exatamente quantas linhas a própria consulta devolveu
-- (documentado no PL/pgSQL), então nunca precisa rodar a mesma consulta
-- duas vezes (uma pra contar, outra pra devolver) — risco real de as duas
-- cópias divergirem com o tempo.
create or replace function public.sime_buscar_local_votacao(p_termo text)
returns table(
  zona_numero integer,
  secao_numero integer,
  local_nome text,
  municipio text,
  endereco text,
  eleitores integer,
  latitude double precision,
  longitude double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_termo text := trim(coalesce(p_termo, ''));
  v_num integer;
  v_termo_norm text;
  v_zona_id uuid;
  v_qtd integer;
begin
  if v_termo = '' then
    return;
  end if;
  if v_termo ~ '^[0-9]+$' then
    v_num := v_termo::integer;
  end if;
  v_termo_norm := unaccent(lower(v_termo));

  select z.id into v_zona_id from sime_zonas z where z.numero = 7;

  return query
  with hits as (
    select distinct s.local_nome, s.municipio
    from sime_secoes s
    join sime_zonas z on z.id = s.zona_id
    where s.ativo = true
      and z.numero = 7
      and (
        case
          when v_num is not null then s.numero = v_num
          else (
            unaccent(lower(s.local_nome)) ilike '%' || v_termo_norm || '%'
            or unaccent(lower(s.municipio)) ilike '%' || v_termo_norm || '%'
          )
        end
      )
  )
  select z.numero, s.numero, s.local_nome, s.municipio, s.endereco, s.eleitores,
         s.latitude, s.longitude
  from sime_secoes s
  join sime_zonas z on z.id = s.zona_id
  join hits h on h.local_nome = s.local_nome and h.municipio = s.municipio
  where s.ativo = true
    and z.numero = 7
  order by
    case when v_num is not null and s.numero = v_num then 0 else 1 end,
    s.municipio, s.local_nome, s.numero
  limit 300;

  get diagnostics v_qtd = row_count;

  -- Melhor-esforço: uma falha de log (ex.: zona 7 sumiu, NOT NULL
  -- violado) nunca deve derrubar a busca em si — mesmo critério já usado
  -- em sime_sync_ocorrencias() pra notificação de auxiliar.
  begin
    insert into sime_busca_local_log (zona_id, termo, qtd_resultados)
    values (v_zona_id, v_termo, v_qtd);
  exception when others then
    null;
  end;

  return;
end;
$$;

grant execute on function public.sime_buscar_local_votacao(text) to anon, authenticated;
