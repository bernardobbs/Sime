-- sime_veiculos_disposicao — veículos de órgãos públicos cedidos à Justiça
-- Eleitoral na véspera e no Dia D
--
-- Pedido direto (28/09/2026): "precisamos cadastrar os veiculos dos orgãos
-- publicos que ficarão a disposição da justiça eleitoral na vespera e dia
-- da eleição", com uma tabela colada (cidade, Qtd., Veículo, Placa,
-- Lotação, RENAVAM, Motorista, Fone).
--
-- Diferente de sime_rotas/sime_empresas (frota CONTRATADA especificamente
-- pra rodar rota de distribuição/recolhimento de urna, com motorista fixo
-- e vínculo a paradas) — isto é um cadastro mais simples, sem paradas nem
-- rota: um veículo emprestado por uma secretaria/prefeitura/câmara/autarquia
-- pra ficar de PLANTÃO/reserva no D-1 e no Dia D (reforço, imprevisto,
-- deslocamento avulso), não necessariamente rodando uma rota cadastrada.
-- Alguns vêm sem motorista designado ainda ("sem motorista" no documento
-- original) — nunca vira string, fica NULL mesmo (não é um nome).
create table if not exists sime_veiculos_disposicao (
  id                  uuid primary key default uuid_generate_v4(),
  zona_id             uuid not null references sime_zonas(id),
  municipio           text not null,
  quantidade          integer not null default 1,
  veiculo             text not null,      -- descrição livre (modelo/cor), como veio da fonte
  placa               text,
  lotacao             text,               -- órgão cedente (prefeitura, secretaria, câmara, autarquia...)
  renavam             text,
  motorista_nome      text,               -- null = ainda sem motorista designado
  motorista_telefone  text,               -- "55"+DDD+8/9, mesma convenção do resto do sistema
  observacao          text,
  ativo               boolean not null default true,  -- soft-delete, nunca apaga de verdade
  created_by          uuid references sime_usuarios(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_veiculos_disposicao_zona on sime_veiculos_disposicao(zona_id);
create index if not exists idx_veiculos_disposicao_municipio on sime_veiculos_disposicao(municipio);

alter table sime_veiculos_disposicao enable row level security;
drop policy if exists veiculos_disposicao_zona_policy on sime_veiculos_disposicao;
create policy veiculos_disposicao_zona_policy on sime_veiculos_disposicao
  for all using (sime_zona_visivel(zona_id)) with check (sime_zona_visivel(zona_id));

comment on column sime_veiculos_disposicao.lotacao is
  'Órgão que cedeu o veículo (prefeitura, secretaria, câmara, autarquia federal/estadual) — texto livre, como veio da fonte.';
comment on column sime_veiculos_disposicao.motorista_nome is
  'Null quando o órgão ainda não designou motorista ("sem motorista" na planilha de origem) — nunca grava esse texto, o campo fica vazio mesmo.';
