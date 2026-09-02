-- sime_turmas / sime_turma_pessoas — turmas de treinamento de mesários
--
-- Pedido direto (02/09/2026): o cartório colou o conteúdo da tela de "turmas
-- de treinamento" do ELO (identificação da turma + instrutores + mesários
-- alunos) e avisou "irei enviar 16 turmas". Até aqui o SIME não tinha onde
-- guardar isso: o roster (sime_atores) sabe quem foi convocado e como
-- contactar, mas não sabia NADA sobre treinamento — quem tem turma, quando,
-- onde, e quem faltou.
--
-- Igual ao resto do módulo de convocação: o ELO continua sendo o sistema
-- oficial (é lá que a turma é criada e que a carta/Título Net mostram as
-- instruções). Aqui é só a visão OPERACIONAL do cartório — conferir se todo
-- mundo tem turma, avisar por WhatsApp, e marcar presença no dia.
create table if not exists sime_turmas (
  id                  uuid primary key default uuid_generate_v4(),
  zona_id             uuid not null references sime_zonas(id),
  numero              text not null,            -- '001' — como vem do ELO, com zeros à esquerda
  nome                text,                     -- 'TURMA 1'
  uf                  text,
  modalidade          text,                     -- 'Presencial' | 'Virtual' (texto livre — o ELO decide o vocabulário)
  tipo_funcao         text,                     -- 'MRV' | 'AL' (mesmo vocabulário de sime_mesarios_raw.tipo_registro)
  funcao              text,                     -- 'Coordenador de Acessibilidade' etc.; '-' vira null
  local_treinamento   text,
  endereco_treinamento text,
  data_treinamento    date,
  hora_inicio         time,
  hora_fim            time,
  instrucoes          text,
  mostrar_titulo_net  boolean,
  mostrar_carta       boolean,
  observacao          text,
  ativo               boolean not null default true,   -- soft-delete, mesmo padrão do resto do SIME
  created_by          uuid references sime_usuarios(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Número de turma é único DENTRO da zona (o ELO numera por zona, não
-- globalmente) — é isso que faz recolar a mesma turma virar atualização, não
-- duplicata.
create unique index if not exists idx_turmas_zona_numero on sime_turmas(zona_id, numero);
create index if not exists idx_turmas_zona on sime_turmas(zona_id);
create index if not exists idx_turmas_data on sime_turmas(data_treinamento);

-- Instrutor e aluno na MESMA tabela, separados por `papel` — as duas listas
-- do ELO têm exatamente as mesmas duas colunas (inscrição + nome), e a mesma
-- pessoa pode ser instrutora de uma turma e aluna de outra.
create table if not exists sime_turma_pessoas (
  id           uuid primary key default uuid_generate_v4(),
  turma_id     uuid not null references sime_turmas(id) on delete cascade,
  papel        text not null check (papel in ('instrutor', 'aluno')),
  -- Sempre normalizada pra 12 dígitos (lpad), mesma convenção de
  -- sime_atores.inscricao_eleitoral — é por ela que a turma casa com o
  -- roster. Ver o bug de zero à esquerda documentado no CLAUDE.md: aqui o
  -- zero é obrigatório desde o começo, justamente pra não repetir aquilo.
  inscricao    text not null,
  nome         text not null,
  -- Resolvido por título de eleitor quando a pessoa existe no roster; fica
  -- null pra quem foi treinado mas não está (ou ainda não está) em
  -- sime_atores — nunca adivinha por nome.
  ator_id      uuid references sime_atores(id),
  presenca     text not null default 'pendente'
               check (presenca in ('pendente', 'presente', 'ausente', 'justificado')),
  observacao   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- A mesma pessoa não entra duas vezes na mesma turma com o mesmo papel —
-- é o que deixa recolar a turma inteira ser idempotente (upsert por
-- turma+papel+inscrição), preservando a presença já marcada.
create unique index if not exists idx_turma_pessoas_unica
  on sime_turma_pessoas(turma_id, papel, inscricao);
create index if not exists idx_turma_pessoas_turma on sime_turma_pessoas(turma_id);
create index if not exists idx_turma_pessoas_inscricao on sime_turma_pessoas(inscricao);
create index if not exists idx_turma_pessoas_ator on sime_turma_pessoas(ator_id);

alter table sime_turmas enable row level security;
drop policy if exists turmas_zona_policy on sime_turmas;
create policy turmas_zona_policy on sime_turmas
  for all using (sime_zona_visivel(zona_id)) with check (sime_zona_visivel(zona_id));

-- sime_turma_pessoas não tem zona_id próprio de propósito (a turma já tem) —
-- a policy herda a visibilidade pela turma, mesmo padrão de
-- sime_ocorrencia_eventos.
alter table sime_turma_pessoas enable row level security;
drop policy if exists turma_pessoas_zona_policy on sime_turma_pessoas;
create policy turma_pessoas_zona_policy on sime_turma_pessoas
  for all using (exists (select 1 from sime_turmas t where t.id = turma_id and sime_zona_visivel(t.zona_id)))
  with check (exists (select 1 from sime_turmas t where t.id = turma_id and sime_zona_visivel(t.zona_id)));

comment on table sime_turmas is
  'Turmas de treinamento vindas do ELO (colar/importar pela aba 🎓 Treinamento de SIME_convocacao.html). O ELO continua sendo o sistema oficial — aqui é a visão operacional do cartório (quem ficou sem turma, quem faltou).';
comment on column sime_turma_pessoas.presenca is
  'pendente (default — treinamento ainda não aconteceu ou ninguém conferiu) | presente | ausente | justificado. Marcado à mão pelo cartório; o ELO não exporta isso.';
