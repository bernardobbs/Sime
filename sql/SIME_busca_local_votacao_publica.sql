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
--
-- Revisão de 23/10/2026, pedido direto: "quero que conste as seção
-- agregadas, e somente da 7ª zona" + "na consulta tem que entender que 001
-- e 01 e 1 é a mesma seção":
--   - Só a 7ª Zona (`z.numero = 7`) — a 94ª continua zerada/fora de foco
--     (ver CLAUDE.md "PENDÊNCIAS"), listá-la junto só confundiria quem usa
--     a busca pública.
--   - "001"/"01"/"1" já são a mesma seção (o `::integer` já descarta zero à
--     esquerda sozinho — confirmado, não precisou de normalização nova).
--   - Agregação por PRÉDIO: antes, buscar só pelo NÚMERO de uma seção
--     devolvia só aquela linha — quem procurava "85" via web não ficava
--     sabendo que o mesmo prédio (G.E. Monsenhor Mateus) tem mais 9 seções
--     (85-90,132,151,158,177). Agora, qualquer seção que bateu no critério
--     de busca puxa TODAS as seções ativas do mesmo (local_nome,município)
--     junto — mesmo critério de agrupamento por prédio já usado em todo o
--     resto do projeto (não existe tabela própria de "locais").
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
  with hits as (
    select distinct s.local_nome, s.municipio
    from sime_secoes s
    join sime_zonas z on z.id = s.zona_id
    where s.ativo = true
      and z.numero = 7
      and (
        (v_num is not null and s.numero = v_num)
        or unaccent(lower(s.local_nome)) ilike '%' || v_termo_norm || '%'
        or unaccent(lower(s.municipio)) ilike '%' || v_termo_norm || '%'
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
end;
$$;

grant execute on function public.sime_buscar_local_votacao(text) to anon, authenticated;
