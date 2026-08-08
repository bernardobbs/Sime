// api/hermes-contatos.js
// Vercel Serverless Function
//
// Resolve telefone por PAPEL — fecha a pendência do escalonamento: a fila de
// notificações (hermes-notificacoes.js) manda pra todo ADMIN_NUMBERS igual,
// sem diferenciar nível. Aqui o Hermes pergunta quem é o Gestor de Problemas
// e quem é o Chefe de Cartório desta zona; a decisão de QUANDO escalar pra
// cada um (10 min / 30 min, ver CLAUDE.md) continua no Hermes, que já calcula
// `idade_s` de cada notificação — este endpoint só resolve o "pra quem".
//
// Mesma auth por zona dos demais endpoints hermes-*.
//
// Ações:
//   listar → telefones ativos de Gestor de Problemas e Chefe de Cartório
//            desta zona (perfil='gestor_prob'/'coordenador' em sime_usuarios)

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const zona = resolverZonaPorAuth(req.headers['authorization'] || '');
  if (!zona) return res.status(401).json({ error: 'Não autorizado' });

  const zonaId = await buscarZonaId(zona.numeroZona);
  if (!zonaId) return res.status(400).json({ error: 'Zona não encontrada' });

  const { acao = 'listar' } = req.body || {};

  if (acao === 'listar') {
    const { data, error } = await supabase
      .from('sime_usuarios')
      .select('perfil, telefone_whatsapp')
      .eq('zona_id', zonaId)
      .eq('ativo', true)
      .in('perfil', ['gestor_prob', 'coordenador'])
      .not('telefone_whatsapp', 'is', null);
    if (error) return res.status(500).json({ error: error.message });

    const contatos = { gestor_prob: [], coordenador: [] };
    for (const u of data || []) {
      if (contatos[u.perfil] && u.telefone_whatsapp) contatos[u.perfil].push(u.telefone_whatsapp);
    }
    return res.status(200).json({ ok: true, zona: zona.numeroZona, contatos });
  }

  return res.status(400).json({ error: `Ação desconhecida: ${acao}` });
}
