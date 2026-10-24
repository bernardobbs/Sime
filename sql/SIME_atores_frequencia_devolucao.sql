-- Frequência (comparecimento) + devolução do auxílio alimentação
-- (05/10/2026, pedido direto: "quero agora uma forma de controlar, em
-- cada seção a frequencia para marcar quais devem devolver o valor e
-- controlar se se ja foi devolvido"). Até aqui o Controle de Pagamento
-- (`sql/SIME_atores_auxilio_pago.sql`) só sabia "pago"/"não pago" — nada
-- registrava se a pessoa de fato COMPARECEU no dia de trabalho. Quem
-- recebeu o auxílio mas faltou precisa devolver o valor; faltava onde
-- marcar isso e onde controlar se já foi devolvido.
--
-- `auxilio_alimentacao_frequencia` — 'presente'/'faltou', NULL = ainda não
-- marcado (nunca um default que fingisse saber antes de alguém dizer).
-- "Deve devolver" é sempre DERIVADO (frequencia='faltou' AND
-- auxilio_alimentacao_pago=true AND NOT auxilio_alimentacao_devolvido) —
-- nunca guardado como flag própria, pra nunca divergir do pagamento/
-- frequência reais.
-- `auxilio_alimentacao_devolvido`/`_devolvido_em` — controle de quem já
-- devolveu de fato, independente de frequência/pagamento mudarem depois.
--
-- Idempotente (pode rodar de novo sem duplicar nada).

ALTER TABLE sime_atores ADD COLUMN IF NOT EXISTS auxilio_alimentacao_frequencia TEXT
  CHECK (auxilio_alimentacao_frequencia IN ('presente', 'faltou'));
ALTER TABLE sime_atores ADD COLUMN IF NOT EXISTS auxilio_alimentacao_devolvido BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sime_atores ADD COLUMN IF NOT EXISTS auxilio_alimentacao_devolvido_em TIMESTAMPTZ;
