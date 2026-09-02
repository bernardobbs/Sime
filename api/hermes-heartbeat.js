// api/hermes-heartbeat.js
// Vercel Serverless Function
//
// Telemetria + checagem de atualização do Hermes. Mesma auth por zona de
// hermes-update.js / hermes-mesarios.js / hermes-notificacoes.js /
// hermes-campanhas.js — cada instância Hermes tem seu HERMES_SECRET_ZONA_<n>.
//
// Por que um endpoint, e não UPSERT direto em sime_heartbeat com o service
// key do Hermes: desde 03/08/2026 index.js NÃO fala mais com o Supabase
// direto (ver HERMES_RUNTIME.md, seção 3, no repositório bernardobbs/hermes)
// — foi corrigido depois de um
// bug real de escrita com coluna errada. Toda gravação do Hermes passa por
// endpoint com HERMES_SECRET como Bearer, sem exceção; isto aqui segue o
// mesmo padrão pras tabelas de sql/SIME_hermes_gestao_schema.sql.
//
// Ações:
//   enviar                → grava telemetria (heartbeat) e devolve, na mesma
//                           resposta, se há atualização pedida — evita uma
//                           segunda chamada no mesmo ciclo
//   confirmar_atualizacao → Hermes terminou de atualizar: grava versão/commit
//                           instalados, zera o pedido pendente
//   erro_atualizacao      → Hermes tentou e falhou: grava o erro, zera o
//                           pedido (não fica tentando pra sempre sem
//                           intervenção de quem opera o Pi)
//   componentes           → lista os componentes da zona com a idade do
//                           heartbeat de cada um (idade_s, calculada com o
//                           relógio do servidor — nunca o do Pi). Usado por
//                           uma segunda instância de Hermes (número de
//                           WhatsApp backup) pra decidir se o principal
//                           parou de reportar e assumir a monitoria de
//                           grupo — mesmo padrão de idade_s já usado em
//                           hermes-notificacoes.js pro escalonamento de
//                           pânico, pelo mesmo motivo (não confiar no
//                           horário local do Pi).

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const COMPONENTE_PADRAO = 'hermes';

function secretsPorZona() {
  const mapa = {};
  for (const [key, val] of Object.entries(process.env)) {
    const m = key.match(/^HERMES_SECRET_ZONA_(.+)$/);
    if (m && val) mapa[m[1]] = val;
  }
  return mapa;
}
function resolverZonaPorAuth(authHeader) {
  const secrets = secretsPorZona();
  for (const [numeroZona, secret] of Object.entries(secrets)) {
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

  const { acao = 'enviar', componente = COMPONENTE_PADRAO, telemetria = {}, versao, commit_hash, erro_msg } = req.body || {};

  // ── ENVIAR — telemetria do ciclo + resposta já traz se há update pedido ──
  if (acao === 'enviar') {
    const ts = await serverTs();
    const row = {
      zona_id: zonaId,
      componente,
      ultimo_heartbeat: ts,
      versao: telemetria.versao ?? null,
      commit_hash: telemetria.commit_hash ?? null,
      uptime_s: telemetria.uptime_s ?? null,
      mem_mb: telemetria.mem_mb ?? null,
      cpu_pct: telemetria.cpu_pct ?? null,
      temperatura_c: telemetria.temperatura_c ?? null,
      disco_livre_mb: telemetria.disco_livre_mb ?? null,
      ip: telemetria.ip ?? null,
      node_version: telemetria.node_version ?? null,
      whatsapp_status: telemetria.whatsapp_status ?? null,
      telegram_status: telemetria.telegram_status ?? null,
      ultima_sincronizacao: telemetria.ultima_sincronizacao ?? null,
      detalhe: telemetria.detalhe ?? null,
    };
    const { error } = await supabase
      .from('sime_heartbeat')
      .upsert(row, { onConflict: 'zona_id,componente' });
    if (error) return res.status(500).json({ error: error.message });

    const { data: comp } = await supabase
      .from('sime_componentes')
      .select('atualizar_agora,versao_desejada')
      .eq('zona_id', zonaId).eq('componente', componente)
      .maybeSingle();

    return res.status(200).json({
      ok: true,
      atualizar_agora: !!comp?.atualizar_agora,
      versao_desejada: comp?.versao_desejada || null,
    });
  }

  // ── CONFIRMAR_ATUALIZACAO / ERRO_ATUALIZACAO ──
  if (acao === 'confirmar_atualizacao' || acao === 'erro_atualizacao') {
    const ts = await serverTs();
    const patch = acao === 'confirmar_atualizacao'
      ? {
          versao_instalada: versao || null,
          commit_instalado: commit_hash || null,
          atualizar_agora: false,
          atualizado_em: ts,
          ultimo_resultado: 'ok',
          ultimo_erro: null,
        }
      : {
          atualizar_agora: false,
          ultimo_resultado: 'erro',
          ultimo_erro: String(erro_msg || 'falha desconhecida').slice(0, 500),
        };

    const { error } = await supabase
      .from('sime_componentes')
      .upsert({ zona_id: zonaId, componente, ...patch }, { onConflict: 'zona_id,componente' });
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ ok: true });
  }

  // ── COMPONENTES — idade do heartbeat de cada componente da zona ──
  if (acao === 'componentes') {
    const ts = await serverTs();
    const { data, error } = await supabase
      .from('sime_heartbeat')
      .select('componente, ultimo_heartbeat')
      .eq('zona_id', zonaId);
    if (error) return res.status(500).json({ error: error.message });

    const componentes = (data || []).map((c) => ({
      componente: c.componente,
      idade_s: c.ultimo_heartbeat ? Math.round((new Date(ts) - new Date(c.ultimo_heartbeat)) / 1000) : null,
    }));
    return res.status(200).json({ ok: true, zona: zona.numeroZona, componentes });
  }

  return res.status(400).json({ error: `Ação desconhecida: ${acao}` });
}
