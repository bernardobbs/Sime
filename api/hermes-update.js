// api/hermes-update.js
// Vercel Serverless Function
// Recebe eventos do Hermes Agent e atualiza o Supabase
// Tambem recebe webhooks do Supabase e chama o Hermes para notificar

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const HERMES_URL = process.env.HERMES_URL; // http://SEU_ORACLE_IP:3000

// Cada zona roda sua própria instância Hermes/Oracle (ver hermes/setup.sh),
// cada uma com seu próprio secret: HERMES_SECRET_ZONA_7, HERMES_SECRET_ZONA_96, ...
// Onboarding de zona nova = só adicionar a env var, sem mudar código.
function secretsPorZona() {
  const mapa = {};
  for (const [key, val] of Object.entries(process.env)) {
    const m = key.match(/^HERMES_SECRET_ZONA_(.+)$/);
    if (m && val) mapa[m[1]] = val; // ex.: mapa['7'] = 'xxxx'
  }
  return mapa;
}

// Resolve qual zona autenticou a requisição a partir do Bearer recebido.
// Retorna { numeroZona, secret } ou null se não bateu com nenhum secret.
function resolverZonaPorAuth(authHeader) {
  for (const [numeroZona, secret] of Object.entries(secretsPorZona())) {
    if (authHeader === `Bearer ${secret}`) return { numeroZona, secret };
  }
  return null;
}

// Busca o UUID da zona pelo número (sime_zonas.numero)
async function buscarZonaId(numeroZona) {
  const { data } = await supabase
    .from('sime_zonas')
    .select('id')
    .eq('numero', parseInt(numeroZona))
    .maybeSingle();
  return data?.id || null;
}

// Mapeamento: evento (texto) → campo do banco
const EVENTO_MAP = {
  enc:              { tabela: 'sime_mesa_estado', campo: 'encerrada',       tipo: 'bool'   },
  vot:              { tabela: 'sime_mesa_estado', campo: 'votacao',          tipo: 'bool'   },
  zeresima:         { tabela: 'sime_mesa_estado', campo: 'zeresima',         tipo: 'bool'   },
  fila:             { tabela: 'sime_mesa_estado', campo: 'fila',             tipo: 'int'    },
  panico_energia:   { tabela: 'sime_mesa_estado', campo: 'panico_energia',   tipo: 'bool'   },
  panico_urna:      { tabela: 'sime_mesa_estado', campo: 'panico_urna',      tipo: 'bool'   },
  urna:             { tabela: 'sime_mesa_estado', campo: 'urna_recolhida',   tipo: 'bool'   },
  midia_pronta:     { tabela: 'sime_midias',      campo: 'status',           tipo: 'enum',
                      valor_fixo: 'pronta_para_coleta'                                      },
  panico_resolvido: { tabela: 'sime_mesa_estado', campo: null,               tipo: 'resolver'},
  mesa_completa:    { tabela: 'sime_mesa_estado', campo: null,               tipo: 'mesa'   },
};

// Busca secao_id pelo numero, restrito à zona que autenticou a requisição
// (números de seção podem se repetir entre zonas diferentes).
async function buscarSecao(numeroStr, zonaId) {
  const numero = parseInt(numeroStr);
  const { data, error } = await supabase
    .from('sime_secoes')
    .select('id, local_nome, municipio')
    .eq('numero', numero)
    .eq('zona_id', zonaId)
    .single();
  if (error || !data) return null;
  return data;
}

// Eleição ativa da zona (necessária para a chave composta eleicao_id+secao_id).
// Com múltiplas zonas ativas simultaneamente, pegar qualquer 'ativa=true' sem
// filtro de zona resolveria a eleição errada — daí o .eq('zona_id', zonaId).
// ORDER BY como proteção extra contra duas eleições ativas na mesma zona.
async function buscarEleicaoAtiva(zonaId) {
  const { data } = await supabase
    .from('sime_eleicoes')
    .select('id')
    .eq('zona_id', zonaId)
    .eq('ativa', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

// Server timestamp — NUNCA usar Date.now() do device
async function serverTs() {
  const { data } = await supabase.rpc('sime_now');
  return data;
}

// Registra log de auditoria
async function registrarLog(acao, secaoId, payload) {
  await supabase.from('sime_logs').insert({
    acao,
    modulo: 'hermes_whatsapp',
    secao_id: secaoId,
    payload,
    ts: await serverTs(),
  });
}

// Notifica Hermes para enviar WhatsApp — usa o secret da MESMA zona que
// autenticou a requisição, para responder à instância Hermes correta.
async function chamarHermes(skill, dados, secretZona) {
  if (!HERMES_URL) return;
  try {
    await fetch(`${HERMES_URL}/hermes/skill/${skill}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretZona}`,
      },
      body: JSON.stringify(dados),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.error('Falha ao chamar Hermes:', e.message);
    // Nao bloqueia — o Hermes pode estar temporariamente indisponivel
  }
}

// ─────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────────────────
export default async function handler(req, res) {

  // Verificar secret — determina de qual zona veio a requisição
  const auth = req.headers['authorization'] || '';
  const zona = resolverZonaPorAuth(auth);
  if (!zona) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { secao, evento, valor, remetente, remetente_nome, origem } = req.body;

  // Validar campos obrigatorios
  if (!secao || !evento) {
    return res.status(400).json({ error: 'secao e evento sao obrigatorios' });
  }

  const zonaId = await buscarZonaId(zona.numeroZona);
  if (!zonaId) {
    return res.status(500).json({ error: `Zona ${zona.numeroZona} não cadastrada no SIME` });
  }

  // Buscar secao no banco, restrito à zona autenticada
  const secaoData = await buscarSecao(secao, zonaId);
  if (!secaoData) {
    return res.status(404).json({
      error: `Secao ${secao} nao encontrada no SIME`,
      mensagem_wa: `Secao ${secao} nao esta cadastrada no sistema.`,
    });
  }

  const mapa = EVENTO_MAP[evento];
  if (!mapa) {
    return res.status(400).json({ error: `Evento desconhecido: ${evento}` });
  }

  // Eleição ativa da zona — necessária para a chave composta (eleicao_id, secao_id)
  const eleicaoId = await buscarEleicaoAtiva(zonaId);
  if (!eleicaoId) {
    return res.status(409).json({ error: 'Nenhuma eleição ativa configurada no SIME' });
  }

  const ts = await serverTs();
  let resultado = {};

  try {
    // ── Casos especiais ──────────────────────────────────

    // Mesa completa: atualiza todos os 4 membros
    if (mapa.tipo === 'mesa') {
      const { error } = await supabase
        .from('sime_mesa_estado')
        .upsert({
          eleicao_id: eleicaoId,
          secao_id: secaoData.id,
          mesa_pres: 1, mesa_m1: 1, mesa_m2: 1, mesa_sec: 1,
          updated_at: ts,
          updated_by_origem: origem || 'hermes_whatsapp',
        }, { onConflict: 'eleicao_id,secao_id' });
      if (error) throw error;
      resultado = { campo: 'mesa_completa', valor: true };
    }

    // Panico resolvido: resolvido depende do ultimo panico ativo
    else if (mapa.tipo === 'resolver') {
      const { data: estado } = await supabase
        .from('sime_mesa_estado')
        .select('panico_energia, panico_urna')
        .eq('eleicao_id', eleicaoId)
        .eq('secao_id', secaoData.id)
        .single();

      const patch = { updated_at: ts };
      if (estado?.panico_energia) patch.panico_energia_resolvido = true;
      if (estado?.panico_urna)    patch.panico_urna_resolvido    = true;

      const { error } = await supabase
        .from('sime_mesa_estado')
        .update(patch)
        .eq('eleicao_id', eleicaoId)
        .eq('secao_id', secaoData.id);
      if (error) throw error;
      resultado = { campo: 'panico_resolvido', valor: true };
    }

    // Midia pronta: tabela separada
    else if (mapa.tabela === 'sime_midias') {
      const { error } = await supabase
        .from('sime_midias')
        .upsert({
          eleicao_id: eleicaoId,
          secao_id: secaoData.id,
          status: mapa.valor_fixo,
          pronta_ts: ts,
          updated_at: ts,
        }, { onConflict: 'eleicao_id,secao_id' });
      if (error) throw error;
      resultado = { campo: 'status', valor: mapa.valor_fixo };

      // Notificar coletor da rota via Hermes
      await chamarHermes('sime_notificar', {
        evento: 'midia_pronta',
        secao: secao,
        local: secaoData.local_nome,
        cidade: secaoData.municipio,
        ts: new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      }, zona.secret);
    }

    // Caso padrao: campo booleano ou inteiro
    else {
      const valorFinal = mapa.tipo === 'bool' ? Boolean(valor) : parseInt(valor);
      const { error } = await supabase
        .from('sime_mesa_estado')
        .upsert({
          eleicao_id: eleicaoId,
          secao_id: secaoData.id,
          [mapa.campo]: valorFinal,
          updated_at: ts,
          updated_by_origem: origem || 'hermes_whatsapp',
        }, { onConflict: 'eleicao_id,secao_id' });
      if (error) throw error;
      resultado = { campo: mapa.campo, valor: valorFinal };

      // Panico: notificar coordenadores imediatamente
      if (evento === 'panico_energia' || evento === 'panico_urna') {
        await chamarHermes('sime_notificar', {
          evento,
          secao,
          local: secaoData.local_nome,
          cidade: secaoData.municipio,
          ts: new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          // destinatarios buscados automaticamente dos atores cadastrados
        }, zona.secret);
      }
    }

    // Log de auditoria
    await registrarLog('hermes_atualizou_sime', secaoData.id, {
      evento, resultado, remetente, remetente_nome, origem
    });

    return res.status(200).json({
      ok: true,
      secao,
      campo: resultado.campo,
      valor: resultado.valor,
      ts_servidor: ts,
      local: secaoData.local_nome,
      cidade: secaoData.municipio,
      mensagem_wa: `Secao ${parseInt(secao)} atualizada: ${resultado.campo}`,
    });

  } catch (err) {
    console.error('Erro ao atualizar SIME:', err);
    return res.status(500).json({
      error: 'Erro interno ao atualizar o SIME',
      detalhe: err.message,
    });
  }
}
