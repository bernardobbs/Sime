-- Busca pública (anon) de local de votação por número de seção, nome do
-- local ou município — pedido direto: "quero uma forma de os mesários
-- entrarem em um site e conseguir pesquisar o local de votação, por
-- exemplo, onde é a seção 001". Ver CLAUDE.md, "BUSCA PÚBLICA DE LOCAL DE
-- VOTAÇÃO", 23/10/2026.
--
-- SECURITY DEFINER, nunca expõe a tabela sime_secoes inteira via RLS pra
-- anon — só os campos seguros/públicos (seção, local, município, endereço,
-- eleitores, coordenada). Nunca retorna token_ue (coluna sensível não
-- documentada/não usada por nenhum módulo) nem qualquer outro campo interno.
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
begin
  if v_termo = '' then
    return;
  end if;
  if v_termo ~ '^[0-9]+$' then
    v_num := v_termo::integer;
  end if;
  v_termo_norm := unaccent(lower(v_termo));

  return query
  select z.numero, s.numero, s.local_nome, s.municipio, s.endereco, s.eleitores,
         s.latitude, s.longitude
  from sime_secoes s
  join sime_zonas z on z.id = s.zona_id
  where s.ativo = true
    and (
      (v_num is not null and s.numero = v_num)
      or unaccent(lower(s.local_nome)) ilike '%' || v_termo_norm || '%'
      or unaccent(lower(s.municipio)) ilike '%' || v_termo_norm || '%'
    )
  order by
    case when v_num is not null and s.numero = v_num then 0 else 1 end,
    z.numero, s.municipio, s.local_nome, s.numero
  limit 50;
end;
$$;

grant execute on function public.sime_buscar_local_votacao(text) to anon, authenticated;
