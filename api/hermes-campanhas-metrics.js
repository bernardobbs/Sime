// api/hermes-campanhas-metrics.js
// Serverless read-only metrics for Hermes campaigns (zone-scoped).
// STRICTLY GET only.
// Auth: same pattern as api/hermes-campanhas.js — Authorization: Bearer <HERMES_SECRET_ZONA_*>

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function secretsPorZona() {
  const mapa = {};
  for (const [key, val] of Object.entries(process.env)) {
    const m = key.match(/^HERMES_SECRET_ZONA_(.+)$/);
    if (m && val) mapa[m[1]] = val;
  }
  return mapa;
}
function resolverZonaPorAuth(authHeader) {
  for (const [numeroZona, secret] of Object.entries(secretsPorZona())) {
    if (authHeader === `Bearer ${secret}`) return { numeroZona, secret };
  }
  return null;
}
async function buscarZonaId(numeroZona) {
  const { data } = await supabase
    .from('sime_zonas')
    .select('id')
    .eq('numero', parseInt(numeroZona))
    .maybeSingle();
  return data?.id || null;
}

export default async function handler(req, res) {
  // Only GET allowed
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = req.headers['authorization'] || '';
  const zona = resolverZonaPorAuth(auth);
  if (!zona) return res.status(401).json({ error: 'Não autorizado' });

  const zonaId = await buscarZonaId(zona.numeroZona);
  if (!zonaId) return res.status(400).json({ error: 'Zona não encontrada' });

  try {
    // Fetch statuses (lightweight: only the status column), then aggregate in JS.
    const { data: statusRows, error: sErr } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('status')
      .eq('zona_id', zonaId);
    if (sErr) return res.status(500).json({ error: sErr.message });

    const contagem = {};
    for (const r of statusRows || []) contagem[r.status] = (contagem[r.status] || 0) + 1;
    const total = Object.values(contagem).reduce((a, b) => a + b, 0);

    const processed = (contagem['finalizado'] || 0)
      + (contagem['telefone_incorreto'] || 0)
      + (contagem['sem_resposta'] || 0)
      + (contagem['erro'] || 0);

    const percent = total ? Math.round((processed * 10000) / total) / 100 : 0;

    // last_activity: best-effort from sime_logs (module 'hermes_campanhas').
    // Present only as "última atividade registrada".
    let lastActivity = null;
    try {
      const { data: la, error: laErr } = await supabase
        .from('sime_logs')
        .select('ts')
        .eq('modulo', 'hermes_campanhas')
        .filter("payload->>zona", 'eq', String(zona.numeroZona))
        .order('ts', { ascending: false })
        .limit(1);
      if (!laErr && (la || []).length) lastActivity = la[0].ts;
    } catch (e) { /* swallow */ }

    // recent items: most recent first (created_at DESC). Limit conservative to 100.
    const { data: recentes, error: rErr } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('id, ator_id, telefone_whatsapp, status, tentativas, created_at, ts_enviado, ts_respondido, mensagem_enviada, mensagem_convocacao')
      .eq('zona_id', zonaId)
      .order('created_at', { ascending: false }) // most recent first
      .limit(100);
    if (rErr) return res.status(500).json({ error: rErr.message });

    // NOTE about campaign naming: sime_campanhas_confirmacao does not include an explicit "campaign name"
    // field in the observed schema. We therefore expose the row id as the campaign identifier.
    // If you have a separate table with campaign metadata (name, description), we can join/enrich in a follow-up.

    return res.status(200).json({
      ok: true,
      zona: zona.numeroZona,
      total,
      contagem,
      processed_count: processed,
      percent_processed: percent,
      last_activity: lastActivity, // presented as 'última atividade registrada' (do not infer online/offline)
      recentes: recentes || [],
      note: 'campaign_name_not_available_in_table; using row id(s) and created_at as identifier/date'
    });
  } catch (e) {
    console.error('metrics error', e && e.message);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
