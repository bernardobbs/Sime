-- sime_campanhas_confirmacao.avulso — furar o filtro de status da campanha
-- só pro botão "🧩 Rodar script conversacional" (modal de mesário, aba
-- Contatar mesários), pedido direto em 27/08/2026: "ao clicar ele deve
-- colocar o número na fila imediatamente" — testado contra um script recém
-- criado que nasceu 'rascunho' de propósito (esperando revisão do
-- cartório), o que fez o item entrar na fila mas o Hermes nunca pegar (ver
-- "controle total das campanhas", 21/08/2026: pendentes só entrega item
-- cuja campanha esteja 'ativa').
--
-- Decisão deliberada, com o trade-off explicado ao dono do projeto antes de
-- implementar: "Rodar script" é uma ação humana explícita e pontual (um
-- número por vez, clicado por alguém do cartório), diferente da fila de
-- disparo em massa que "controle total das campanhas" precisa conseguir
-- pausar por completo. Por isso este furo é ESCOPADO só a itens marcados
-- avulso=true (nunca ao Disparo em massa) e ainda respeita 'encerrada'
-- (status terminal, não reversível — nenhum envio deveria sair sob uma
-- campanha formalmente encerrada, nem avulso).
alter table sime_campanhas_confirmacao
  add column if not exists avulso boolean not null default false;
