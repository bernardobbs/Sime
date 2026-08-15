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
// Por que puxar em vez de empurrar: o Hermes roda atrás do NAT do roteador —
// sem endereço público, então quem inicia a conexão é sempre ele, a cada ciclo.
//
// ── Dois fluxos de campanha ──
//
// SIMPLES (mensagem_convocacao vazio): manda mensagem_enviada (+ imagem_url,
// se tiver) e pronto — status pendente → enviado/erro. É o que sempre existiu
// (alerta anti-golpe, mensagem livre).
//
// COM CONFIRMAÇÃO DE IDENTIDADE (mensagem_convocacao preenchido): antes de
// mandar a convocação de verdade, confirma que o número ainda é da pessoa.
//
//   pendente ──envia mensagem_enviada (verificação)──▶ aguardando_resposta
//   aguardando_resposta ──resposta SIM──▶ confirmado
//   aguardando_resposta ──resposta NÃO──▶ telefone_incorreto (terminal)
//   aguardando_resposta ──sem resposta, RETRY_HORAS passaram──▶ reenvia
//     (até MAX_TENTATIVAS; depois disso vira sem_resposta, terminal)
//   confirmado ──envia mensagem_convocacao + imagem_url──▶ finalizado
//
// Quem classifica a resposta (SIM/NÃO) em linguagem natural é o Hermes
// (keyword matching, mesmo espírito de keywords.js) — este endpoint só
// recebe a decisão já resolvida via acao=responder.
//
// Ações:
//   pendentes  → itens prontos pra alguma ação agora (mais antigos primeiro),
//                cada um já dizendo o que fazer em proxima_acao
//   confirmar         → avança o status (aceita novo_status; default 'enviado')
//   erro              → marca 'erro' + incrementa tentativas, para não travar a fila
//   responder         → grava a resposta SIM/NÃO de quem recebeu a verificação
//   verificar_pendente → só lê: há campanha aguardando resposta desse telefone?
//   resumo            → contagem por status da zona (pro relatório horário no Telegram)
//   relatorio         → mesma contagem, mas detalhada por pessoa (telefone/nome)
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

// Quanto esperar por uma resposta antes de reenviar a verificação, e quantas
// vezes tentar antes de desistir (vira 'sem_resposta', terminal). Valores
// fixos aqui de propósito — não expostos como parâmetro pra não virar
// decisão por chamada; mudar exige editar o código, igual outros limites
// do projeto (rate limit de 5 msgs/min, por exemplo).
const RETRY_HORAS = 24;
const MAX_TENTATIVAS = 3;

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
function soDigitos(s) { return String(s || '').replace(/\D/g, ''); }
function telefoneCasa(cadastro, alvo) {
  const a = soDigitos(cadastro), b = soDigitos(alvo);
  if (!a || !b || a.length < 8 || b.length < 8) return false;
  return a === b || a.slice(-8) === b.slice(-8);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const zona = resolverZonaPorAuth(req.headers['authorization'] || '');
  if (!zona) return res.status(401).json({ error: 'Não autorizado' });

  const zonaId = await buscarZonaId(zona.numeroZona);
  if (!zonaId) return res.status(400).json({ error: 'Zona não encontrada' });

  const { acao = 'pendentes', ids = [], erro_msg, whatsapp_existe, novo_status, telefone, decisao, resposta_texto } = req.body || {};

  // ── PENDENTES ──
  if (acao === 'pendentes') {
    const ts = await serverTs();
    const cutoff = new Date(new Date(ts).getTime() - RETRY_HORAS * 3600 * 1000).toISOString();

    // Auto-expira quem estourou o número máximo de tentativas e já passou da
    // janela de retry — vira estado terminal, não fica reaparecendo pra
    // sempre nem no resumo como "aguardando".
    await supabase.from('sime_campanhas_confirmacao')
      .update({ status: 'sem_resposta', updated_at: ts })
      .eq('zona_id', zonaId)
      .eq('status', 'aguardando_resposta')
      .gte('tentativas', MAX_TENTATIVAS)
      .lt('ts_enviado', cutoff);

    const { data, error } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('id, ator_id, telefone_whatsapp, mensagem_enviada, mensagem_convocacao, imagem_url, status, tentativas, ts_enviado, created_at')
      .eq('zona_id', zonaId)
      .in('status', ['pendente', 'aguardando_resposta', 'confirmado'])
      .order('created_at', { ascending: true })
      .limit(LIMITE_POR_CICLO);
    if (error) return res.status(500).json({ error: error.message });

    const campanhas = [];
    for (const c of data || []) {
      let proximaAcao = null, mensagem = null, imagemUrl = null;

      if (c.status === 'pendente') {
        // Tem mensagem_convocacao → é o fluxo com confirmação de identidade,
        // a mensagem_enviada aqui é a VERIFICAÇÃO, não a convocação em si.
        // Sem mensagem_convocacao → fluxo simples de sempre, uma tacada só.
        mensagem = c.mensagem_enviada;
        proximaAcao = c.mensagem_convocacao ? 'enviar_verificacao' : 'enviar';
        if (proximaAcao === 'enviar') imagemUrl = c.imagem_url || null;
      } else if (c.status === 'aguardando_resposta') {
        const devido = !c.ts_enviado || new Date(c.ts_enviado) < new Date(cutoff);
        if (!devido) continue; // ainda dentro da janela de espera — não insiste
        proximaAcao = 'reenviar_verificacao';
        mensagem = c.mensagem_enviada;
      } else if (c.status === 'confirmado') {
        proximaAcao = 'enviar_convocacao';
        mensagem = c.mensagem_convocacao;
        imagemUrl = c.imagem_url || null;
      }

      if (!proximaAcao || !(mensagem || '').trim()) continue; // sem o que mandar — não trava a fila, mas também não sai daqui

      campanhas.push({
        id: c.id,
        ator_id: c.ator_id,
        telefone: c.telefone_whatsapp,
        proxima_acao: proximaAcao,
        mensagem,
        imagem_url: imagemUrl,
        tentativas: c.tentativas || 0,
        criado_em: c.created_at,
      });
    }
    return res.status(200).json({ ok: true, zona: zona.numeroZona, campanhas });
  }

  // ── CONFIRMAR ── avança o status. novo_status default 'enviado' (fluxo
  // simples, comportamento de sempre). 'aguardando_resposta' incrementa
  // tentativas (é uma tentativa de verificação a mais, primeira ou reenvio).
  // 'finalizado' fecha o fluxo com confirmação (convocação + imagem mandadas).
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

    if (acao === 'erro') {
      // tentativas é por-linha — não dá pra incrementar em lote com um único
      // UPDATE, então atualiza cada uma com o valor atual + 1.
      for (const c of validos) {
        const { error: upErr } = await supabase
          .from('sime_campanhas_confirmacao')
          .update({
            status: 'erro',
            erro_msg: String(erro_msg || 'falha no envio').slice(0, 500),
            tentativas: (c.tentativas || 0) + 1,
            updated_at: ts,
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

    const novoStatus = ['enviado', 'aguardando_resposta', 'finalizado'].includes(novo_status) ? novo_status : 'enviado';

    if (novoStatus === 'aguardando_resposta') {
      for (const c of validos) {
        const { error: upErr } = await supabase
          .from('sime_campanhas_confirmacao')
          .update({ status: 'aguardando_resposta', ts_enviado: ts, tentativas: (c.tentativas || 0) + 1, updated_at: ts })
          .eq('id', c.id);
        if (upErr) return res.status(500).json({ error: upErr.message });
      }
    } else {
      const patch = { status: novoStatus, updated_at: ts };
      if (novoStatus === 'enviado') patch.ts_enviado = ts;
      if (typeof whatsapp_existe === 'boolean') {
        patch.whatsapp_existe = whatsapp_existe;
        patch.whatsapp_existe_ts = ts;
      }
      const { error } = await supabase
        .from('sime_campanhas_confirmacao').update(patch).in('id', idsValidos);
      if (error) return res.status(500).json({ error: error.message });
    }

    await supabase.from('sime_logs').insert({
      acao: 'campanha_confirmar', modulo: 'hermes_campanhas',
      payload: { ids: idsValidos, zona: zona.numeroZona, novo_status: novoStatus }, ts,
    });
    return res.status(200).json({ ok: true, atualizadas: idsValidos.length });
  }

  // ── RESPONDER ── grava a resposta de quem recebeu a mensagem de
  // verificação. Casa por telefone (não por id — o Hermes recebe a resposta
  // como uma mensagem de WhatsApp normal, identificada só pelo remetente),
  // restrito a itens 'aguardando_resposta' da zona autenticada. Se houver
  // mais de um casando (não devia, mas por segurança), usa o mais recente.
  if (acao === 'responder') {
    if (!telefone) return res.status(400).json({ error: 'telefone é obrigatório' });
    if (!['confirmado', 'telefone_incorreto'].includes(decisao)) {
      return res.status(400).json({ error: "decisao deve ser 'confirmado' ou 'telefone_incorreto'" });
    }
    const { data: candidatos } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('id, telefone_whatsapp, ts_enviado')
      .eq('zona_id', zonaId)
      .eq('status', 'aguardando_resposta');
    const casados = (candidatos || [])
      .filter((c) => telefoneCasa(c.telefone_whatsapp, telefone))
      .sort((a, b) => new Date(b.ts_enviado || 0) - new Date(a.ts_enviado || 0));

    if (!casados.length) {
      return res.status(404).json({ ok: false, encontrado: 0, error: 'Nenhuma campanha aguardando resposta desse telefone' });
    }

    const item = casados[0];
    const ts = await serverTs();
    const { error } = await supabase
      .from('sime_campanhas_confirmacao')
      .update({
        status: decisao,
        resposta_recebida: resposta_texto ? String(resposta_texto).slice(0, 500) : null,
        decisao_detectada: decisao,
        ts_respondido: ts,
        updated_at: ts,
      })
      .eq('id', item.id);
    if (error) return res.status(500).json({ error: error.message });

    await supabase.from('sime_logs').insert({
      acao: 'campanha_respondida', modulo: 'hermes_campanhas',
      payload: { id: item.id, zona: zona.numeroZona, decisao, resposta_texto }, ts,
    });
    return res.status(200).json({ ok: true, id: item.id, status: decisao });
  }

  // ── VERIFICAR_PENDENTE ── consulta (nunca muda nada) se há uma campanha
  // 'aguardando_resposta' pra esse telefone na zona autenticada. Usado pelo
  // Hermes pra decidir se responde "quem é você" com a identidade de quem
  // manda a verificação (services/campanhas/identidade.js) — só nesse
  // contexto, pra não virar uma resposta automática genérica pra qualquer
  // DM perguntando "quem é". Mesma regra de casamento por telefone de
  // RESPONDER acima, mas sem escrever nada.
  if (acao === 'verificar_pendente') {
    if (!telefone) return res.status(400).json({ error: 'telefone é obrigatório' });
    const { data: candidatos, error } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('telefone_whatsapp')
      .eq('zona_id', zonaId)
      .eq('status', 'aguardando_resposta');
    if (error) return res.status(500).json({ error: error.message });
    const pendente = (candidatos || []).some((c) => telefoneCasa(c.telefone_whatsapp, telefone));
    return res.status(200).json({ ok: true, pendente });
  }

  // ── RESUMO ── contagem por status da zona inteira (não só "última hora")
  // — é uma fotografia do estado atual da campanha, pro Hermes postar no
  // Telegram todo ciclo (ex.: de hora em hora).
  if (acao === 'resumo') {
    const { data, error } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('status')
      .eq('zona_id', zonaId);
    if (error) return res.status(500).json({ error: error.message });

    const contagem = {};
    for (const row of data || []) contagem[row.status] = (contagem[row.status] || 0) + 1;
    return res.status(200).json({ ok: true, zona: zona.numeroZona, total: (data || []).length, contagem });
  }

  // ── RELATORIO ── mesma fotografia do resumo, mas detalhada por pessoa —
  // pedido do dono do projeto pra saber exatamente QUEM não tem WhatsApp,
  // QUEM confirmou e QUEM negou ser a pessoa procurada (não só a contagem).
  // whatsapp_existe é lido à parte do status: 'erro' cobre qualquer falha
  // de envio (rede, timeout), não só número inexistente — só entra em
  // nao_whatsapp quando o Hermes marcou whatsapp_existe=false de propósito.
  if (acao === 'relatorio') {
    const { data, error } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('telefone_whatsapp, status, whatsapp_existe, sime_atores(nome_completo)')
      .eq('zona_id', zonaId);
    if (error) return res.status(500).json({ error: error.message });

    const linha = (c) => ({ telefone: c.telefone_whatsapp, nome: c.sime_atores?.nome_completo || null });
    const rows = data || [];
    const naoWhatsapp = rows.filter((c) => c.whatsapp_existe === false).map(linha);
    const confirmaram = rows.filter((c) => ['confirmado', 'finalizado'].includes(c.status)).map(linha);
    const negaram = rows.filter((c) => c.status === 'telefone_incorreto').map(linha);

    return res.status(200).json({
      ok: true, zona: zona.numeroZona, total: rows.length,
      nao_whatsapp: naoWhatsapp, confirmaram, negaram,
    });
  }

  return res.status(400).json({ error: `Ação desconhecida: ${acao}` });
}
