// modules/sime_hermes_api.js
// Cliente de métricas de campanha do Hermes pro painel (SIME_hermes_painel.html).
//
// Lê sime_campanhas_confirmacao/sime_logs DIRETO do Supabase com a sessão
// autenticada da equipe (anon key + RLS por zona via sime_zona_visivel) —
// mesmo padrão da aba "🤖 Hermes" em SIME_admin.html, que já lê
// sime_heartbeat/sime_componentes assim. Réplica client-side da mesma
// agregação de api/hermes-campanhas-metrics.js (mantido no repo, mas sem uso
// pelo navegador agora).
//
// Antes desta revisão (19/08/2026), este arquivo chamava
// /api/hermes-campanhas-metrics com um Bearer que o usuário colava via
// prompt() em localStorage — só que o valor esperado era o mesmo
// HERMES_SECRET_ZONA_<n> que autoriza toda escrita privilegiada do Hermes
// (pânico, confirmação de mesário, disparo em massa). Não havia credencial
// separada só de leitura, então usar o painel em produção exigia expor esse
// segredo no navegador. Removido — sem token nenhum a gerenciar aqui.
export async function getHermesMetrics(sb, zonaId, zonaNumero) {
  try {
    const { data: statusRows, error: sErr } = await sb
      .from('sime_campanhas_confirmacao')
      .select('status')
      .eq('zona_id', zonaId);
    if (sErr) return { ok: false, error: sErr.message };

    const contagem = {};
    for (const r of statusRows || []) contagem[r.status] = (contagem[r.status] || 0) + 1;
    const total = Object.values(contagem).reduce((a, b) => a + b, 0);

    const processed = (contagem['finalizado'] || 0)
      + (contagem['telefone_incorreto'] || 0)
      + (contagem['sem_resposta'] || 0)
      + (contagem['erro'] || 0);
    const percent = total ? Math.round((processed * 10000) / total) / 100 : 0;

    // Última atividade: melhor esforço a partir de sime_logs, igual ao
    // endpoint original — nunca bloqueia a tela se essa consulta falhar.
    let lastActivity = null;
    try {
      const { data: la } = await sb
        .from('sime_logs')
        .select('ts')
        .eq('modulo', 'hermes_campanhas')
        .filter('payload->>zona', 'eq', String(zonaNumero))
        .order('ts', { ascending: false })
        .limit(1);
      if ((la || []).length) lastActivity = la[0].ts;
    } catch (e) { /* melhor esforço — segue sem última atividade */ }

    const { data: recentes, error: rErr } = await sb
      .from('sime_campanhas_confirmacao')
      .select('id, ator_id, telefone_whatsapp, status, tentativas, created_at, ts_enviado, ts_respondido, mensagem_enviada, mensagem_convocacao')
      .eq('zona_id', zonaId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (rErr) return { ok: false, error: rErr.message };

    return {
      ok: true,
      zona: zonaNumero,
      total,
      contagem,
      processed_count: processed,
      percent_processed: percent,
      last_activity: lastActivity,
      recentes: recentes || [],
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
