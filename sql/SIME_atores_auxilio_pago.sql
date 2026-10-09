-- Controle de pagamento do auxílio alimentação (25/09/2026, pedido direto:
-- "essas pessoas já receberam o pix" + "criar um controle de pagamento no
-- SIME"). Até aqui, `modules/sime_recibo_alimentacao.js` só gerava o
-- DOCUMENTO impresso (Inscrição/Nome/Função/Assinatura) — deliberadamente
-- sem status por pessoa, a confirmação de entrega era a própria assinatura
-- no papel (ver CLAUDE.md). Pedido explícito de status real por pessoa,
-- guardado no mesmo `sime_atores` de sempre (mesário/coordenador de
-- acessibilidade/auxiliar de eleição/junta eleitoral).
--
-- Idempotente (pode rodar de novo sem duplicar nada).

ALTER TABLE sime_atores ADD COLUMN IF NOT EXISTS auxilio_alimentacao_pago BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sime_atores ADD COLUMN IF NOT EXISTS auxilio_alimentacao_valor_pago NUMERIC;
ALTER TABLE sime_atores ADD COLUMN IF NOT EXISTS auxilio_alimentacao_pago_em TIMESTAMPTZ;
