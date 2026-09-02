-- WhatsApp/exclusão por NÚMERO, não por pessoa (01/09/2026)
-- ══════════════════════════════════════════════════════════════════════════
-- Pedido direto, ao ver o cartãozinho de telefone no modal de "Contatar
-- mesários": "o marcar sem whatsapp deve vir junto ao numero tipo um x no
-- canto para excluir o numero caso não seja numero da pessoa e do outro
-- lado, sem whatsapp".
--
-- `sem_whatsapp_manual` (criado horas antes, no mesmo dia, ver
-- sql/SIME_atores_sem_whatsapp_manual.sql) era uma flag da PESSOA — mas uma
-- pessoa pode ter vários telefones na lista (principal, os do TRE, o
-- cadastrado à mão), e cada um pode ter uma situação diferente (um é
-- WhatsApp, outro não, outro nem é mais o número certo). Substituído antes
-- de ganhar uso real (só 1 registro em produção — MARIA DO SOCORRO OLIVEIRA
-- DE SOUSA — migrado abaixo) por duas listas por NÚMERO:
--
-- - `telefones_sem_whatsapp` — dígitos (sem "55", mesmo formato de
--   telSemPais()) dos números que o cartório confirmou, por fora, que não
--   têm WhatsApp — mesmo em formato de celular. Complementa (não substitui)
--   o sinal automático telFormatoFixo() (sime_ui_utils.js), que continua
--   calculado na hora, não gravado.
-- - `telefones_ignorados` — dígitos dos números que o cartório marcou como
--   "não é o número desta pessoa" (ex.: erro de digitação na planilha do
--   TRE, número de outra pessoa). Pro telefone_whatsapp/telefone_alternativo
--   (colunas próprias do SIME) o "excluir" já limpa o campo direto — esta
--   lista só é necessária pros números que vêm de sime_mesarios_raw
--   (staging do TRE, só leitura): não dá pra apagar de lá, então só some da
--   lista desta pessoa daqui em diante.
-- ══════════════════════════════════════════════════════════════════════════

alter table sime_atores add column if not exists telefones_sem_whatsapp jsonb not null default '[]'::jsonb;
alter table sime_atores add column if not exists telefones_ignorados jsonb not null default '[]'::jsonb;
comment on column sime_atores.telefones_sem_whatsapp is 'Dígitos (sem "55") dos telefones desta pessoa que o cartório confirmou não terem WhatsApp — flag manual por número, nunca escrita por sync ou automação.';
comment on column sime_atores.telefones_ignorados is 'Dígitos (sem "55") de telefones vindos do TRE (sime_mesarios_raw, só leitura) que o cartório marcou como não sendo desta pessoa — some da lista de telefones dela, sem tocar no staging.';

-- Migra o único registro real em produção (sem_whatsapp_manual=true) pro
-- novo formato antes de derrubar a coluna antiga.
update sime_atores
set telefones_sem_whatsapp = jsonb_build_array(
      case when left(telefone_whatsapp, 2) = '55' then substring(telefone_whatsapp from 3) else telefone_whatsapp end
    )
where sem_whatsapp_manual = true
  and telefone_whatsapp is not null and telefone_whatsapp <> '';

alter table sime_atores drop column if exists sem_whatsapp_manual;
