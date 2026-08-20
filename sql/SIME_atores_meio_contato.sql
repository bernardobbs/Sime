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

-- sime_atores.confirmacao ganha um valor novo. A coluna TEM CHECK constraint
-- (sime_atores_confirmacao_chk) — corrigido em 20/08/2026 porque o valor
-- 'contato_incorreto' introduzido por este arquivo nunca tinha sido
-- adicionado à constraint, então tanto este fluxo quanto o "Atualizar
-- contatos" (Ciente=2, sime_mesarios_sync.js) quebravam em produção com
-- violação de constraint sempre que tentavam gravar esse valor:
alter table sime_atores drop constraint if exists sime_atores_confirmacao_chk;
alter table sime_atores add constraint sime_atores_confirmacao_chk
  check (confirmacao = any (array['pendente','confirmado','recusou','substituido','contato_incorreto']));
--
--   pendente (default) | confirmado | recusou | substituido — gravados pelo
--   Hermes via resposta de WhatsApp (api/hermes-mesarios.js).
--
--   contato_incorreto — o cartório grava manualmente em
--   SIME_convocacao.html → aba "Contatar mesários", ao ler um recado de
--   quem respondeu 'recusou' dizendo que não é a pessoa procurada. O Hermes
--   hoje não distingue "não sou eu" de "sou eu mas não vou atuar" — os dois
--   caem em 'recusou' — decisão deliberada de 20/08/2026: separar isso
--   automaticamente exigiria o Hermes (repositório separado) classificar a
--   frase e chamar uma ação nova; por ora fica como reclassificação manual
--   (ou automática via Ciente=2 no upload de "Atualizar contatos").
comment on column sime_atores.confirmacao is
  'pendente (default) | confirmado | recusou | substituido — gravados pelo Hermes (api/hermes-mesarios.js) via resposta de WhatsApp.
   contato_incorreto — o cartório grava, manualmente ou via upload de "Atualizar contatos" (Ciente=2), ao saber que o contato não é a pessoa procurada (o Hermes hoje não distingue os dois casos automaticamente).';

-- Código de rastreio (Correios) — só texto livre pra montar o link público
-- de rastreamento (rastreamento.correios.com.br). Não há integração via API:
-- a API oficial dos Correios exige contrato de Cartão de Postagem (pago),
-- incompatível com o custo R$ 0,00/mês do projeto e com o volume avulso de
-- cartas de um cartório. O cartório confere no site e marca o status em
-- status_contato_alternativo manualmente. Editável clicando no nome do
-- mesário em SIME_convocacao.html → "Contatar mesários".
alter table sime_atores
  add column if not exists codigo_rastreio text;
