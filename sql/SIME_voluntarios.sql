-- sime_voluntarios — cadastro de mesários voluntários
--
-- Pedido direto (28/08/2026): "quero uma pagina para cadastrar os mesários
-- voluntários. no cadastro deve ter cpf nome telefone e selecionar a função
-- que quer trabalhar (mesário, apoio logistico, coordenador de
-- acessibilidade, todas) e o local que quer trabalhar (cidade, e local de
-- votação ou todos). para quando tiver que preencher alguma vaga ir
-- selecionando os voluntários a medida que foram sendo cadastrados."
--
-- Diferente de sime_atores: aqui não é o roster OFICIAL do TRE (convocação
-- formal, com título de eleitor, seção designada) — é um cadastro PARALELO
-- de gente que se ofereceu como voluntária, pra o cartório ter de onde tirar
-- gente quando uma vaga precisar ser preenchida (ex.: quando alguém recusa
-- e fica "precisa substituir", ver SIME_atores_convocado_status.sql). Só a
-- equipe do cartório cadastra (mesmo padrão de acesso de
-- SIME_convocacao.html — sem trava de perfil, qualquer um logado grava),
-- não é formulário público.
--
-- Escopo desta v1, deliberado: é um REGISTRO com status, não um automatismo
-- que cria sime_atores sozinho — converter um voluntário num mesário oficial
-- (com secao_id, funcao_mesa, inscrição, etc.) continua sendo decisão manual
-- do cartório pelas telas de sempre (SIME_atores.html/SIME_convocacao.html).
create table if not exists sime_voluntarios (
  id                  uuid primary key default uuid_generate_v4(),
  zona_id             uuid not null references sime_zonas(id),
  cpf                 text not null,          -- só dígitos (11), sem formatação
  nome                text not null,
  telefone_whatsapp   text,                    -- "55"+DDD+8/9, mesma convenção do resto do sistema
  -- Subconjunto de sime_atores.funcao (mesmo vocabulário, pra não precisar
  -- traduzir se um dia isso virar um sime_atores de verdade) — vazio = "quero
  -- trabalhar em qualquer função".
  funcoes             text[] not null default '{}'::text[],
  municipio           text,    -- null = qualquer município da zona
  local_votacao       text,    -- null = qualquer local; só faz sentido com município preenchido
  observacao          text,
  status              text not null default 'disponivel'
                      check (status in ('disponivel', 'convocado', 'indisponivel')),
  ator_id             uuid references sime_atores(id),  -- preenchido se um dia virar mesário de verdade
  ativo               boolean not null default true,     -- soft-delete (pediu pra sair da lista)
  created_by          uuid references sime_usuarios(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Mesma pessoa não devia se cadastrar duas vezes na mesma zona — CPF já
-- identifica univocamente. Não é global (cross-zona) de propósito: cada
-- zona tem seu próprio cadastro isolado, mesmo padrão de sime_atores.
create unique index if not exists idx_voluntarios_zona_cpf on sime_voluntarios(zona_id, cpf);
create index if not exists idx_voluntarios_zona on sime_voluntarios(zona_id);
create index if not exists idx_voluntarios_status on sime_voluntarios(status);

alter table sime_voluntarios enable row level security;
drop policy if exists voluntarios_zona_policy on sime_voluntarios;
create policy voluntarios_zona_policy on sime_voluntarios
  for all using (sime_zona_visivel(zona_id)) with check (sime_zona_visivel(zona_id));

comment on column sime_voluntarios.funcoes is
  'Subconjunto de {mesario, auxiliar_eleicao, coord_acessibilidade} — array vazio = qualquer função.';
comment on column sime_voluntarios.status is
  'disponivel (default) | convocado (o cartório já chamou esta pessoa pra preencher uma vaga) | indisponivel (não pode mais / desistiu).';
