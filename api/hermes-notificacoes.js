// api/hermes-notificacoes.js
// Vercel Serverless Function
// Fila de notificações que o Hermes CONSULTA — o caminho SIME → Hermes.
//
// Por que puxar em vez de empurrar: o Hermes roda no PC do cartório, atrás do
// NAT do roteador. Ele não tem endereço público, então o Supabase/Vercel não
// consegue chamá-lo. Invertendo o sentido, quem inicia a conexão é sempre o
// Hermes — que é justamente o que passa por qualquer internet residencial, sem
// túnel, sem abrir porta e sem IP fixo.
//
// Custo: a notificação sai com até um ciclo de atraso (o intervalo que o Hermes
// escolher). Para um pânico que escala em 10 minutos, 30s não muda nada.
//
// Ações:
//   pendentes  → notificações ainda não enviadas da zona (mais antigas primeiro)
//   confirmar  → marca como 'enviado' (some da fila)
//   erro       → marca 'erro' + incrementa tentativas, para não travar a fila
//
// Mesma auth por zona de hermes-update.js / hermes-mesarios.js: cada instância
// Hermes tem seu HERMES_SECRET_ZONA_<numero> e só enxerga a fila da sua zona.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Quantas notificações devolver por ciclo. Limite existe para o Hermes não
// receber um lote gigante depois de ficar horas fora do ar.
const LIMITE_POR_CICLO = 50;

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
async function serverTs() {
  const { data } = await supabase.rpc('sime_now');
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const zona = resolverZonaPorAuth(req.headers['authorization'] || '');
  if (!zona) return res.status(401).json({ error: 'Não autorizado' });

  const zonaId = await buscarZonaId(zona.numeroZona);
  if (!zonaId) return res.status(400).json({ error: 'Zona não encontrada' });

  const { acao = 'pendentes', ids = [], erro_msg } = req.body || {};

  // ── PENDENTES ──
  // O filtro de zona sobe por secao_id → sime_secoes.zona_id. Notificação sem
  // seção (ex.: manual, sem alvo) fica de fora de propósito: não há como
  // atribuí-la a uma zona, e entregá-la a todas vazaria dado entre cartórios.
  if (acao === 'pendentes') {
    const { data: secoes } = await supabase
      .from('sime_secoes').select('id, numero, local_nome, municipio')
      .eq('zona_id', zonaId);
    if (!secoes?.length) return res.status(200).json({ ok: true, notificacoes: [] });

    const porId = Object.fromEntries(secoes.map((s) => [s.id, s]));
    const { data, error } = await supabase
      .from('sime_notificacoes')
      .select('id, evento, secao_id, mensagem, tentativas, created_at')
      .eq('status', 'pendente')
      .in('secao_id', Object.keys(porId))
      .order('created_at', { ascending: true })   // mais antigas primeiro
      .limit(LIMITE_POR_CICLO);
    if (error) return res.status(500).json({ error: error.message });

    const agora = Date.parse(await serverTs());
    const notificacoes = (data || []).map((n) => {
      const s = porId[n.secao_id] || {};
      let payload = null;
      try { payload = JSON.parse(n.mensagem); } catch (e) { /* mensagem livre */ }
      return {
        id: n.id,
        evento: n.evento,
        tentativas: n.tentativas,
        criado_em: n.created_at,
        // Idade em segundos: é com ela que o Hermes decide o escalonamento
        // (10 min → Gestor de Problemas, 30 min → Chefe de Cartório) sem
        // precisar de relógio próprio nem confiar no horário do PC.
        idade_s: Math.max(0, Math.round((agora - Date.parse(n.created_at)) / 1000)),
        secao: s.numero ? String(s.numero).padStart(4, '0') : null,
        local: s.local_nome || null,
        municipio: s.municipio || null,
        payload,
      };
    });
    return res.status(200).json({ ok: true, zona: zona.numeroZona, notificacoes });
  }

  // ── CONFIRMAR / ERRO ──
  if (acao === 'confirmar' || acao === 'erro') {
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'ids é obrigatório' });
    }
    // Confere que os ids são da zona que está chamando — sem isso, uma zona
    // poderia marcar como enviada a notificação de outra.
    const { data: secoes } = await supabase
      .from('sime_secoes').select('id').eq('zona_id', zonaId);
    const idsSecoes = (secoes || []).map((s) => s.id);
    const { data: alvo } = await supabase
      .from('sime_notificacoes').select('id')
      .in('id', ids).in('secao_id', idsSecoes);
    const idsValidos = (alvo || []).map((n) => n.id);
    if (!idsValidos.length) return res.status(404).json({ error: 'Nenhuma notificação desta zona' });

    const ts = await serverTs();
    const patch = acao === 'confirmar'
      ? { status: 'enviado', enviado_ts: ts }
      : { status: 'erro', erro_msg: String(erro_msg || 'falha no envio').slice(0, 500) };

    const { error } = await supabase
      .from('sime_notificacoes').update(patch).in('id', idsValidos);
    if (error) return res.status(500).json({ error: error.message });

    await supabase.from('sime_logs').insert({
      acao: `notificacao_${acao}`,
      modulo: 'hermes_notificacoes',
      payload: { ids: idsValidos, zona: zona.numeroZona },
      ts,
    });
    return res.status(200).json({ ok: true, atualizadas: idsValidos.length });
  }

  return res.status(400).json({ error: `Ação desconhecida: ${acao}` });
}
