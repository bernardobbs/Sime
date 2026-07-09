// modules/sime_realtime.js
// Assinatura Realtime pra sime_mesa_estado — usado pelas TVs pra refletir
// mudanças de qualquer seção quase instantaneamente, sem esperar o próximo
// ciclo de polling local. Módulo separado de sime_dados.js porque é um
// padrão diferente (push/callback via canal, não pull com cache).

// onChange(row, eventType) — row é a linha completa de sime_mesa_estado após
// a mudança (INSERT/UPDATE); eventType é 'INSERT'|'UPDATE'|'DELETE'.
export function subscribeMesaEstado(client, onChange) {
  return client
    .channel('sime_mesa_estado_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sime_mesa_estado' }, (payload) => {
      onChange(payload.new, payload.eventType);
    })
    .subscribe();
}

export function unsubscribe(client, channel) {
  if (channel) client.removeChannel(channel);
}
