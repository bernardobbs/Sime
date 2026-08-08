// modules/sime_realtime.js
// Assinatura Realtime pra sime_mesa_estado — usado pelas TVs pra refletir
// mudanças de qualquer seção quase instantaneamente, sem esperar o próximo
// ciclo de polling local. Módulo separado de sime_dados.js porque é um
// padrão diferente (push/callback via canal, não pull com cache).

// onChange(row, eventType) — row é a linha completa após a mudança
// (INSERT/UPDATE); eventType é 'INSERT'|'UPDATE'|'DELETE'.
function subscribeTable(client, table, onChange) {
  return client
    .channel(`sime_${table}_changes`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      onChange(payload.new, payload.eventType);
    })
    .subscribe();
}

export function subscribeMesaEstado(client, onChange) { return subscribeTable(client, 'sime_mesa_estado', onChange); }

// Variante filtrada por seção — usada pelos módulos de campo, que só têm uma
// seção em tela e não devem receber o tráfego das outras 174. Sem o filtro,
// cada celular de mesário receberia todo evento da zona no Dia D.
export function subscribeMesaEstadoSecao(client, secaoId, onChange) {
  return client
    .channel(`sime_mesa_estado_secao_${secaoId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'sime_mesa_estado',
      filter: `secao_id=eq.${secaoId}`,
    }, (payload) => onChange(payload.new, payload.eventType))
    .subscribe();
}
// Embarque de urnas (Conferente/TV Distribuição) — 2 tabelas, uma pro estado
// da rota (status/ts) e outra por urna individual; a TV Distribuição assina
// as duas porque um embarque completo muda ambas.
export function subscribeRotasEstado(client, onChange) { return subscribeTable(client, 'sime_rotas_estado', onChange); }
export function subscribeRotasUrnas(client, onChange) { return subscribeTable(client, 'sime_rotas_urnas', onChange); }

// Mídias eleitorais (aba Mídias do Admin) — mesmo padrão das demais: dado
// zona-scoped pela RLS, sem filtro de seção porque o Admin vê a zona toda.
export function subscribeMidias(client, onChange) { return subscribeTable(client, 'sime_midias', onChange); }

// Heartbeat do Hermes (aba Hermes do Admin) — o Hermes faz UPSERT direto
// nesta tabela a cada ciclo; sem isso o painel só atualizaria no refresh manual.
export function subscribeHeartbeat(client, onChange) { return subscribeTable(client, 'sime_heartbeat', onChange); }

// Variante para um CONJUNTO de seções — acessibilidade (as seções de um local),
// motorista e instalador (as da rota). O filtro `in` evita que o celular do
// operador receba os eventos das outras ~170 seções da zona no Dia D, que é o
// mesmo motivo do filtro por seção única acima.
//
// Sem seções conhecidas devolve null: assinar tudo "por precaução" seria trocar
// um filtro por um firehose justamente no aparelho mais fraco da operação.
export function subscribeMesaEstadoSecoes(client, secaoIds, onChange) {
  const ids = (secaoIds || []).filter(Boolean);
  if (!ids.length) return null;
  return client
    .channel(`sime_mesa_estado_secoes_${ids.length}_${ids[0]}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'sime_mesa_estado',
      filter: `secao_id=in.(${ids.join(',')})`,
    }, (payload) => onChange(payload.new, payload.eventType))
    .subscribe();
}

// Painel de problemas: a lista precisa refletir o que outra pessoa da equipe
// acabou de fazer (assumir, delegar, resolver) sem ninguém apertar F5 — é o
// que impede duas pessoas de ligarem para a mesma seção ao mesmo tempo.
export function subscribeOcorrencias(client, onChange) { return subscribeTable(client, 'sime_ocorrencias', onChange); }

export function unsubscribe(client, channel) {
  if (channel) client.removeChannel(channel);
}
