// api/hermes-campanhas.js
// Vercel Serverless Function
// Fila de disparo em massa que o Hermes CONSULTA — mesmo sentido de
// api/hermes-notificacoes.js (SIME → Hermes), mas para sime_campanhas_confirmacao
// em vez de sime_notificacoes.
//
// SIME popula (aba "📢 Disparo em massa" de SIME_atores.html): telefone,
// ator_id, zona_id, mensagem_enviada, status='pendente'. O Hermes é quem
// drena e manda pelo WhatsApp — respeitando 5 msgs/min e só se
// DISPATCH_ATIVO=true no .env dele (decisão de quem opera o Raspberry Pi,
// fora deste repo).
//
// Por que puxar em vez de empurrar: o Hermes roda no PC do cartório, atrás do
// NAT do roteador — sem endereço público, então quem inicia a conexão é
// sempre ele, a cada ciclo.
//
// Ações:
//   pendentes  → itens ainda não enviados da zona (mais antigos primeiro)
//   confirmar  → marca 'enviado' (some da fila); aceita whatsapp_existe opcional
//   erro       → marca 'erro' + incrementa tentativas, para não travar a fila
//
// Mesma auth por zona de hermes-update.js / hermes-mesarios.js / hermes-notificacoes.js.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Limite por ciclo — mesmo motivo do hermes-notificacoes.js: não devolver um
// lote gigante de uma vez se o Hermes ficar horas fora do ar. O rate limit de
// 5 msgs/min do próprio Hermes já naturalmente pauta o ritmo de envio.
const LIMITE_POR_CICLO = 100;

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

  const { acao = 'pendentes', ids = [], erro_msg, whatsapp_existe } = req.body || {};

  // ── PENDENTES ──
  if (acao === 'pendentes') {
    const { data, error } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('id, ator_id, telefone_whatsapp, mensagem_enviada, tentativas, created_at')
      .eq('zona_id', zonaId)
      .eq('status', 'pendente')
      .order('created_at', { ascending: true })
      .limit(LIMITE_POR_CICLO);
    if (error) return res.status(500).json({ error: error.message });

    // Item sem mensagem não tem o que enviar — não trava a fila, mas também
    // não devolve pro Hermes tentar (mesmo espírito do SQL: "sem isso o item
    // vira erro no primeiro ciclo do Hermes"). Aqui já filtra antes de sair.
    const campanhas = (data || [])
      .filter((c) => (c.mensagem_enviada || '').trim())
      .map((c) => ({
        id: c.id,
        ator_id: c.ator_id,
        telefone: c.telefone_whatsapp,
        mensagem: c.mensagem_enviada,
        tentativas: c.tentativas || 0,
        criado_em: c.created_at,
      }));
    return res.status(200).json({ ok: true, zona: zona.numeroZona, campanhas });
  }

  // ── CONFIRMAR / ERRO ──
  if (acao === 'confirmar' || acao === 'erro') {
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'ids é obrigatório' });
    }
    // Confere que os ids são da zona que está chamando — sem isso, uma zona
    // poderia marcar como enviado o item de outra.
    const { data: alvo } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('id, tentativas')
      .in('id', ids)
      .eq('zona_id', zonaId);
    const validos = alvo || [];
    if (!validos.length) return res.status(404).json({ error: 'Nenhum item desta zona' });
    const idsValidos = validos.map((c) => c.id);

    const ts = await serverTs();
    let patch;
    if (acao === 'confirmar') {
      patch = { status: 'enviado', ts_enviado: ts };
      if (typeof whatsapp_existe === 'boolean') {
        patch.whatsapp_existe = whatsapp_existe;
        patch.whatsapp_existe_ts = ts;
      }
    } else {
      // tentativas é por-linha — não dá pra incrementar em lote com um único
      // UPDATE, então atualiza cada uma com o valor atual + 1.
      for (const c of validos) {
        const { error: upErr } = await supabase
          .from('sime_campanhas_confirmacao')
          .update({
            status: 'erro',
            erro_msg: String(erro_msg || 'falha no envio').slice(0, 500),
            tentativas: (c.tentativas || 0) + 1,
            ...(typeof whatsapp_existe === 'boolean' ? { whatsapp_existe, whatsapp_existe_ts: ts } : {}),
          })
          .eq('id', c.id);
        if (upErr) return res.status(500).json({ error: upErr.message });
      }
      await supabase.from('sime_logs').insert({
        acao: 'campanha_erro', modulo: 'hermes_campanhas',
        payload: { ids: idsValidos, zona: zona.numeroZona, erro_msg }, ts,
      });
      return res.status(200).json({ ok: true, atualizadas: idsValidos.length });
    }

    const { error } = await supabase
      .from('sime_campanhas_confirmacao').update(patch).in('id', idsValidos);
    if (error) return res.status(500).json({ error: error.message });

    await supabase.from('sime_logs').insert({
      acao: 'campanha_confirmar', modulo: 'hermes_campanhas',
      payload: { ids: idsValidos, zona: zona.numeroZona }, ts,
    });
    return res.status(200).json({ ok: true, atualizadas: idsValidos.length });
  }

  return res.status(400).json({ error: `Ação desconhecida: ${acao}` });
}
