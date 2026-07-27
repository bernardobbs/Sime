// api/hermes-mesarios.js
// Vercel Serverless Function
// Caminho de LEITURA + CONFIRMAÇÃO de mesários para o Hermes Agent.
//
// Espelha api/hermes-update.js (mesma auth por zona via Bearer, mesmo
// service_role), mas opera sobre PESSOAS (sime_atores), não sobre seções:
//   - acao='listar'    → devolve os mesários da zona (nome, telefone, seção, status)
//   - acao='confirmar' → marca sime_atores.confirmacao='confirmado' (permanece)
//   - acao='recusar'   → 'recusou'     (+ ativo=false — não vai atuar)
//   - acao='substituir'→ 'substituido' (+ ativo=false)
//
// Fecha o ciclo do painel "Confirmação de mesários" do SIME_admin.html: o Hermes
// pergunta pelo WhatsApp e grava a resposta; o cartório vê no painel/relatórios.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Auth por zona (mesmo padrão de hermes-update.js) ──
// Cada instância Hermes/Oracle tem seu próprio HERMES_SECRET_ZONA_<numero>.
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
async function registrarLog(acao, payload) {
  await supabase.from('sime_logs').insert({
    acao,
    modulo: 'hermes_mesarios',
    payload,
    ts: await serverTs(),
  });
}

// Só dígitos — normaliza telefone pra comparar (mesma ideia de sime_importar_ator).
function soDigitos(s) { return String(s || '').replace(/\D/g, ''); }
// Extrai o número da seção do texto em observacao ("Seção votação: NNN"),
// enquanto o backfill de secao_id não roda.
function secaoDaObs(obs) {
  const m = /Se[çc][ãa]o\s*vota[çc][ãa]o:\s*(\d+)/i.exec(obs || '');
  return m ? String(m[1]).padStart(4, '0') : null;
}

// Casa por telefone: exato (dígitos) ou, como folga, pelos últimos 8 dígitos
// (cobre variações de DDI/DDD entre o que o WhatsApp manda e o cadastro).
function telefoneCasa(cadastro, alvo) {
  const a = soDigitos(cadastro), b = soDigitos(alvo);
  if (!a || !b || a.length < 8 || b.length < 8) return false;
  return a === b || a.slice(-8) === b.slice(-8);
}

const ACAO_CONF = {
  confirmar:  { confirmacao: 'confirmado',  ativo: true  },
  recusar:    { confirmacao: 'recusou',     ativo: false },
  substituir: { confirmacao: 'substituido', ativo: false },
};

// ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const zona = resolverZonaPorAuth(auth);
  if (!zona) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { acao, secao, status, telefone } = req.body || {};
  if (!acao) return res.status(400).json({ error: 'acao é obrigatória (listar|confirmar|recusar|substituir)' });

  const zonaId = await buscarZonaId(zona.numeroZona);
  if (!zonaId) {
    return res.status(500).json({ error: `Zona ${zona.numeroZona} não cadastrada no SIME` });
  }

  try {
    // Base: mesários da zona autenticada (isolamento por zona_id).
    let q = supabase.from('sime_atores')
      .select('id, nome_completo, telefone_whatsapp, observacao, confirmacao, ativo, secao_id')
      .eq('zona_id', zonaId)
      .eq('funcao', 'mesario');
    if (status) q = q.eq('confirmacao', status);
    const { data, error } = await q.order('nome_completo');
    if (error) throw error;
    let mesarios = data || [];

    // Filtro por seção (usa secao_id quando já houver backfill; senão, o texto do observacao).
    if (secao) {
      const alvo = String(parseInt(secao)).padStart(4, '0');
      mesarios = mesarios.filter(m => secaoDaObs(m.observacao) === alvo);
    }

    // ── LISTAR ──
    if (acao === 'listar') {
      return res.status(200).json({
        ok: true,
        total: mesarios.length,
        mesarios: mesarios.map(m => ({
          nome: m.nome_completo,
          telefone: m.telefone_whatsapp,
          secao: secaoDaObs(m.observacao),
          confirmacao: m.confirmacao,
          ativo: m.ativo,
        })),
      });
    }

    // ── CONFIRMAR / RECUSAR / SUBSTITUIR (identifica a pessoa pelo telefone) ──
    const conf = ACAO_CONF[acao];
    if (!conf) return res.status(400).json({ error: `Ação desconhecida: ${acao}` });
    if (!telefone) return res.status(400).json({ error: 'telefone é obrigatório para registrar confirmação' });

    const alvos = mesarios.filter(m => telefoneCasa(m.telefone_whatsapp, telefone));
    if (alvos.length === 0) {
      return res.status(404).json({
        ok: false,
        encontrado: 0,
        mensagem_wa: 'Não encontrei você na lista de mesários desta zona. Fale com o cartório.',
      });
    }

    const ts = await serverTs();
    for (const m of alvos) {
      const { error: upErr } = await supabase.from('sime_atores')
        .update({ confirmacao: conf.confirmacao, ativo: conf.ativo })
        .eq('id', m.id);
      if (upErr) throw upErr;
    }
    await registrarLog('hermes_confirmou_mesario', {
      acao, telefone: soDigitos(telefone), zona: zona.numeroZona,
      afetados: alvos.map(m => ({ nome: m.nome_completo, secao: secaoDaObs(m.observacao) })), ts,
    });

    return res.status(200).json({
      ok: true,
      encontrado: alvos.length,
      confirmacao: conf.confirmacao,
      nomes: alvos.map(m => m.nome_completo),
      ts_servidor: ts,
      mensagem_wa: acao === 'confirmar'
        ? 'Confirmado! Obrigado. Você está mantido como mesário.'
        : (acao === 'recusar'
            ? 'Registrado que você NÃO vai atuar. O cartório será avisado.'
            : 'Registrada a substituição. O cartório vai providenciar o substituto.'),
    });

  } catch (err) {
    console.error('Erro em hermes-mesarios:', err);
    return res.status(500).json({ error: 'Erro interno', detalhe: err.message });
  }
}
