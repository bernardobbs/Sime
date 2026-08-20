-- sime_atores — contato alternativo (Carta Registrada / Oficial de Justiça)
--
-- Pedido do cartório em 20/08/2026: pra mesário que não responde por
-- WhatsApp, marcar qual outro meio usar e acompanhar o andamento. Carta/
-- Oficial de Justiça usam o endereço já disponível no processo do TRE (fora
-- do SIME) — aqui só marca QUAL meio e o status do envio, não guarda
-- endereço.
alter table sime_atores
  add column if not exists meio_contato text not null default 'whatsapp'
    check (meio_contato in ('whatsapp','carta_registrada','oficial_justica')),
  add column if not exists status_contato_alternativo text
    check (status_contato_alternativo is null or status_contato_alternativo in ('a_enviar','enviado','entregue','devolvido'));

-- sime_atores.confirmacao ganha um valor novo, só de uso manual (não é
-- CHECK constraint — a coluna já era texto livre, gravado por
-- api/hermes-mesarios.js sem lista fechada):
--
--   pendente (default) | confirmado | recusou | substituido — gravados pelo
--   Hermes via resposta de WhatsApp (api/hermes-mesarios.js).
--
--   contato_incorreto — só o cartório grava, manualmente, em
--   SIME_convocacao.html → aba "Contatar mesários", ao ler um recado de
--   quem respondeu 'recusou' dizendo que não é a pessoa procurada. O Hermes
--   hoje não distingue "não sou eu" de "sou eu mas não vou atuar" — os dois
--   caem em 'recusou' — decisão deliberada de 20/08/2026: separar isso
--   automaticamente exigiria o Hermes (repositório separado) classificar a
--   frase e chamar uma ação nova; por ora fica como reclassificação manual.
comment on column sime_atores.confirmacao is
  'pendente (default) | confirmado | recusou | substituido — gravados pelo Hermes (api/hermes-mesarios.js) via resposta de WhatsApp.
   contato_incorreto — só o cartório grava, manualmente, na tela SIME_convocacao.html, ao ler um recado de quem respondeu "recusou" dizendo que não é a pessoa procurada (o Hermes hoje não distingue os dois casos automaticamente).';
