-- ============================================================
-- SIME — SQL: telefone dos admins, base do escalonamento por papel
--
-- Pendência histórica (CLAUDE.md): a fila de notificações drenada pelo
-- Hermes manda pra todos os ADMIN_NUMBERS (lista estática no .env do Pi),
-- sem diferenciar por nível de escalonamento — faltava uma forma do SIME
-- dizer QUEM é o Gestor de Problemas e QUEM é o Chefe de Cartório de cada
-- zona, pra alguém no Hermes poder escolher.
--
-- sime_usuarios nunca teve telefone (só e-mail de login) — sem isso não tem
-- como resolver "o Gestor de Problemas desta zona" pra um número de WhatsApp.
-- ============================================================

ALTER TABLE sime_usuarios ADD COLUMN IF NOT EXISTS telefone_whatsapp TEXT;

-- Sem índice novo: a consulta do endpoint (zona_id + perfil + ativo) já é
-- coberta pelo padrão de leitura pequena por zona, mesmo volume de sime_atores.
