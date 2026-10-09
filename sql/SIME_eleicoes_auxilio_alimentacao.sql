-- Recibo de Auxílio Alimentação (18/09/2026) — valor e forma de pagamento,
-- editáveis pelo cartório na própria aba "🍽️ Auxílio Alimentação" de
-- SIME_convocacao.html (mesmo padrão de minutos_por_eleitor_fila em
-- SIME_admin.html: default sensível, nunca cravado como fato imutável).
-- Referência real (ELO, "Controle de Entrega de Auxílio Alimentação"):
-- "Forma de Auxílio: DINHEIRO Valor: R$ 65,00" — os defaults abaixo
-- reproduzem esse valor real já visto em produção, não um chute.
ALTER TABLE sime_eleicoes ADD COLUMN IF NOT EXISTS valor_auxilio_alimentacao NUMERIC(10,2) NOT NULL DEFAULT 65.00;
ALTER TABLE sime_eleicoes ADD COLUMN IF NOT EXISTS forma_auxilio_alimentacao TEXT NOT NULL DEFAULT 'DINHEIRO';
