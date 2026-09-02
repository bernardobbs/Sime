-- Confirmação por NÚMERO no cartãozinho de telefone (01/09/2026)
-- ══════════════════════════════════════════════════════════════════════════
-- Pedido direto, na sequência do ✕ (excluir) e 📵 (sem WhatsApp) que cada
-- cartão de "Todos os telefones conhecidos" já ganhou: "alem de sem
-- whastapp poderia haver um botão para numero confirmado".
--
-- Diferente de sime_atores.confirmacao (que é sobre a PESSOA confirmar que
-- vai participar da eleição), isto é sobre o NÚMERO: o cartório ligou/
-- confirmou por fora que aquele telefone específico é mesmo da pessoa e
-- está funcionando — útil quando há vários candidatos na lista (principal,
-- os do TRE, o alternativo) e nem todos foram verificados. Mesmo espírito
-- de telefones_sem_whatsapp: array de dígitos (sem "55"), flag manual do
-- cartório, nunca escrita por sync ou automação. Não é mutuamente exclusivo
-- com telefones_sem_whatsapp — um número pode ser confirmado como sendo da
-- pessoa e, ao mesmo tempo, não ter WhatsApp (ex.: fixo confirmado por
-- ligação).
-- ══════════════════════════════════════════════════════════════════════════

alter table sime_atores add column if not exists telefones_confirmados jsonb not null default '[]'::jsonb;
comment on column sime_atores.telefones_confirmados is 'Dígitos (sem "55") dos telefones desta pessoa que o cartório confirmou (por fora) serem realmente dela — flag manual por número, nunca escrita por sync ou automação. Independente de telefones_sem_whatsapp.';
