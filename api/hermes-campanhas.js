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
// ── Três fluxos de campanha ──
//
// SIMPLES (mensagem_convocacao vazio, campanha_id vazio): manda
// mensagem_enviada (+ imagem_url, se tiver) e pronto — status
// pendente → enviado/erro. É o que sempre existiu (alerta anti-golpe,
// mensagem livre).
//
// COM CONFIRMAÇÃO DE IDENTIDADE — legado (mensagem_convocacao preenchido,
// campanha_id vazio): antes de mandar a convocação de verdade, confirma que
// o número ainda é da pessoa. Uma etapa fixa, SIM/NÃO hardcoded em
// identidade.js do lado do Hermes.
//
//   pendente ──envia mensagem_enviada (verificação)──▶ aguardando_resposta
//   aguardando_resposta ──resposta SIM──▶ confirmado
//   aguardando_resposta ──resposta NÃO──▶ telefone_incorreto (terminal)
//   aguardando_resposta ──sem resposta, RETRY_HORAS passaram──▶ reenvia
//     (até MAX_TENTATIVAS; depois disso vira sem_resposta, terminal)
//   confirmado ──envia mensagem_convocacao + imagem_url──▶ finalizado
//
// SCRIPT CONVERSACIONAL POR ETAPA (campanha_id preenchido, ver
// sql/SIME_campanhas_scripts_schema.sql e modules/campanhas/script.js do
// Hermes): generaliza o fluxo de identidade acima pra N etapas
// configuráveis (sime_campanha_etapas), cada uma com seus próprios ramos
// de resposta (palavras-chave → próxima etapa ou status final). etapa_atual
// acompanha em que etapa o item está; reenvio por timeout busca a
// mensagem/imagem da etapa ATUAL (não sempre a etapa 1). Cada etapa pode
// ter sua própria imagem (sime_campanha_etapas.imagem_url, desde
// 22/08/2026, ver sql/SIME_campanha_etapas_imagem.sql) — a imagem pertence
// à etapa, nunca à linha de fila (diferente do fluxo simples/legado, onde
// imagem_url vive em sime_campanhas_confirmacao). Resposta que não casa
// com nenhum ramo vira status 'fora_do_script' (terminal — fila de
// atenção, ver ação 'relatorio').
//
// Quem classifica a resposta (SIM/NÃO, ou ramo do script) em linguagem
// natural é o Hermes (keyword matching, mesmo espírito de keywords.js) —
// este endpoint só recebe a decisão já resolvida via acao=responder /
// acao=avancar_etapa.
//
// Ações:
//   pendentes  → itens prontos pra alguma ação agora (mais antigos primeiro),
//                cada um já dizendo o que fazer em proxima_acao
//   confirmar          → avança o status (aceita novo_status; default 'enviado',
//                         ou 'aguardando_resposta' automático se campanha_id)
//   erro               → marca 'erro' + incrementa tentativas, para não travar a fila
//   responder          → grava a resposta SIM/NÃO do fluxo legado de identidade
//   obter_etapa_pendente → só lê: há etapa de SCRIPT aguardando resposta desse telefone?
//   avancar_etapa      → grava o ramo casado pelo Hermes e avança (ou fecha) o script
//   registrar_fora_do_script → resposta que não casou com nenhum ramo da etapa
//   verificar_pendente → só lê: há campanha (legado OU script) aguardando resposta desse telefone?
//   resumo            → contagem por status da zona (pro relatório horário no Telegram)
//                        + em_andamento (22/08/2026: false quando só sobra
//                        item terminal — evita repetir o mesmo resumo pra
//                        sempre depois que tudo já foi enviado/encerrado)
//   relatorio         → mesma contagem, mas detalhada por pessoa (telefone/nome),
//                       inclui a fila de atenção 'fora_do_script'
//   listar_fora_do_script_periodo → itens 'fora_do_script' num período
//                       (desde/ate, ISO), cada um já com a etapa
//                       correspondente (respostas_esperadas) — usado pra
//                       sugerir novas palavras-chave por IA (nunca aplica
//                       sozinho, só sugere)
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

  const {
    acao = 'pendentes', ids = [], erro_msg, whatsapp_existe, novo_status,
    telefone, decisao, resposta_texto,
    item_id, proxima_etapa, intencao, status_final,
    desde, ate,
  } = req.body || {};

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

    let { data, error } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('id, ator_id, telefone_whatsapp, mensagem_enviada, mensagem_convocacao, imagem_url, status, tentativas, ts_enviado, created_at, campanha_id, etapa_atual')
      .eq('zona_id', zonaId)
      .in('status', ['pendente', 'aguardando_resposta', 'confirmado'])
      .order('created_at', { ascending: true })
      .limit(LIMITE_POR_CICLO);
    if (error) return res.status(500).json({ error: error.message });

    // Controle total da campanha (21/08/2026, pedido direto do dono do
    // projeto): pausar/encerrar uma campanha em sime_campanhas.status
    // precisa realmente PARAR o envio dos itens dela, não só mudar um rótulo
    // cosmético na tela. Item sem campanha_id (fluxo legado, de antes desta
    // mudança) passa direto — só item COM campanha_id fica sujeito ao status
    // da campanha; 'ativa' é a única que deixa passar.
    const campanhaIdsPresentes = [...new Set((data || []).map((c) => c.campanha_id).filter(Boolean))];
    if (campanhaIdsPresentes.length) {
      const { data: statusCampanhas, error: campErr } = await supabase
        .from('sime_campanhas')
        .select('id, status')
        .in('id', campanhaIdsPresentes);
      if (campErr) return res.status(500).json({ error: campErr.message });
      const statusPorCampanha = new Map((statusCampanhas || []).map((c) => [c.id, c.status]));
      data = (data || []).filter((c) => !c.campanha_id || statusPorCampanha.get(c.campanha_id) === 'ativa');
    }

    // Itens de script (etapa_atual preenchido) precisam da mensagem/imagem
    // da ETAPA ATUAL, buscada em sime_campanha_etapas — não de
    // mensagem_enviada/imagem_url em sime_campanhas_confirmacao, que só
    // cobrem a etapa 1 congelada no envio inicial (a imagem de script, desde
    // 22/08/2026, pertence à etapa — ver sql/SIME_campanha_etapas_imagem.sql
    // — nunca à linha de fila). Sem isso, reenviar um item parado na etapa
    // 3, por exemplo, mandaria de volta o texto/imagem da etapa 1. Busca em
    // lote (não uma query por item) pra não fazer N idas ao banco no loop
    // abaixo — cobre tanto o primeiro envio (etapa_atual=1) quanto reenvios
    // de qualquer etapa.
    const cutoffDate = new Date(cutoff);
    const itensComEtapa = (data || []).filter((c) => c.etapa_atual);
    const mensagemEtapaPorChave = new Map(); // `${campanha_id}:${etapa_numero}` -> mensagem
    const imagemEtapaPorChave = new Map();   // `${campanha_id}:${etapa_numero}` -> imagem_url
    if (itensComEtapa.length) {
      const campanhaIds = [...new Set(itensComEtapa.map((c) => c.campanha_id))];
      const { data: etapas, error: etapasErr } = await supabase
        .from('sime_campanha_etapas')
        .select('campanha_id, etapa_numero, mensagem, imagem_url')
        .in('campanha_id', campanhaIds);
      if (etapasErr) return res.status(500).json({ error: etapasErr.message });
      for (const e of etapas || []) {
        const chave = `${e.campanha_id}:${e.etapa_numero}`;
        mensagemEtapaPorChave.set(chave, e.mensagem);
        imagemEtapaPorChave.set(chave, e.imagem_url || null);
      }
    }

    const campanhas = [];
    for (const c of data || []) {
      let proximaAcao = null, mensagem = null, imagemUrl = null;

      if (c.status === 'pendente') {
        // etapa_atual preenchido → é a etapa 1 de um script de campanha
        // (mensagem já vem pronta em mensagem_enviada, ver SIME_atores.html);
        // tem mensagem_convocacao → é o fluxo legado com confirmação de
        // identidade, a mensagem_enviada aqui é a VERIFICAÇÃO, não a
        // convocação em si. Nenhum dos dois → fluxo simples de sempre, uma
        // tacada só. NÃO usar campanha_id sozinho aqui (21/08/2026): desde
        // que toda mensagem passou a exigir uma campanha ("controle total
        // das campanhas"), campanha_id está preenchido em TODO item, script
        // ou não — etapa_atual é que só existe pra script de verdade.
        mensagem = c.mensagem_enviada;
        proximaAcao = c.etapa_atual ? 'enviar_etapa_script' : (c.mensagem_convocacao ? 'enviar_verificacao' : 'enviar');
        if (proximaAcao === 'enviar') imagemUrl = c.imagem_url || null;
        else if (proximaAcao === 'enviar_etapa_script') imagemUrl = imagemEtapaPorChave.get(`${c.campanha_id}:${c.etapa_atual}`) || null;
      } else if (c.status === 'aguardando_resposta') {
        const devido = !c.ts_enviado || new Date(c.ts_enviado) < cutoffDate;
        if (!devido) continue; // ainda dentro da janela de espera — não insiste
        if (c.etapa_atual) {
          // Reenvio de uma etapa de script — mensagem/imagem da etapa
          // ATUAL, ver busca em lote acima. Etapa órfã (apagada depois de
          // enviada) não trava a fila — só não sai daqui, igual a qualquer
          // item sem mensagem (checado abaixo).
          proximaAcao = 'reenviar_etapa_script';
          mensagem = mensagemEtapaPorChave.get(`${c.campanha_id}:${c.etapa_atual}`) || null;
          imagemUrl = imagemEtapaPorChave.get(`${c.campanha_id}:${c.etapa_atual}`) || null;
        } else {
          proximaAcao = 'reenviar_verificacao';
          mensagem = c.mensagem_enviada;
        }
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
        // campanha_id/etapa_atual só vêm preenchidos pra itens de script
        // (ver sql/SIME_campanhas_scripts_schema.sql) — o Hermes usa
        // campanha_id pra saber que precisa chamar confirmar sem novo_status
        // explícito (o default já vira 'aguardando_resposta' pra esses itens,
        // ver ação 'confirmar' abaixo) e depois obter_etapa_pendente/
        // avancar_etapa pra seguir o script.
        campanha_id: c.campanha_id || null,
        etapa_atual: c.etapa_atual || null,
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
    // poderia marcar como enviado o item de outra. etapa_atual vem junto pra
    // decidir o default de novo_status abaixo (script sempre espera resposta
    // depois de mandar — campanha_id sozinho NÃO serve mais pra essa decisão
    // desde 21/08/2026, está preenchido em todo item agora, script ou não).
    const { data: alvo } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('id, tentativas, campanha_id, etapa_atual')
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

    // novo_status explícito vale pra todo o lote. Sem ele, o default depende
    // do item: etapa_atual preenchido é etapa de script — mandar a etapa 1
    // sempre espera resposta (o script só progride via avancar_etapa), então
    // o default correto é 'aguardando_resposta', não 'enviado'. Sem isso, um
    // item de script confirmado sem novo_status explícito saía do filtro de
    // pendentes (['pendente','aguardando_resposta','confirmado']) pra sempre
    // e o script nunca avançava — mesmo bug que motivou expor campanha_id em
    // 'pendentes' acima. campanha_id sozinho NÃO serve mais como esse sinal
    // (21/08/2026): está preenchido em todo item agora, não só script — um
    // "golpe"/"livre" simples com campanha_id ficaria preso em
    // 'aguardando_resposta' pra sempre se usasse campanha_id aqui.
    const statusExplicito = ['enviado', 'aguardando_resposta', 'finalizado'].includes(novo_status) ? novo_status : null;
    const porStatus = new Map();
    for (const c of validos) {
      const status = statusExplicito || (c.etapa_atual ? 'aguardando_resposta' : 'enviado');
      if (!porStatus.has(status)) porStatus.set(status, []);
      porStatus.get(status).push(c);
    }

    for (const [status, itens] of porStatus) {
      if (status === 'aguardando_resposta') {
        for (const c of itens) {
          const { error: upErr } = await supabase
            .from('sime_campanhas_confirmacao')
            .update({ status: 'aguardando_resposta', ts_enviado: ts, tentativas: (c.tentativas || 0) + 1, updated_at: ts })
            .eq('id', c.id);
          if (upErr) return res.status(500).json({ error: upErr.message });
        }
      } else {
        const patch = { status, updated_at: ts };
        if (status === 'enviado') patch.ts_enviado = ts;
        if (typeof whatsapp_existe === 'boolean') {
          patch.whatsapp_existe = whatsapp_existe;
          patch.whatsapp_existe_ts = ts;
        }
        const { error } = await supabase
          .from('sime_campanhas_confirmacao').update(patch).in('id', itens.map((c) => c.id));
        if (error) return res.status(500).json({ error: error.message });
      }
    }

    await supabase.from('sime_logs').insert({
      acao: 'campanha_confirmar', modulo: 'hermes_campanhas',
      payload: { ids: idsValidos, zona: zona.numeroZona, novo_status: statusExplicito || 'auto-por-item' }, ts,
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

  // ── OBTER_ETAPA_PENDENTE ── consulta (não escreve nada) se há um item com
  // etapa_atual preenchido, status 'aguardando_resposta', casando pelo
  // telefone — e, se sim, devolve a etapa atual do script (mensagem já foi
  // mandada; o que falta são as respostas_esperadas dessa etapa, pro Hermes
  // casar localmente). Espelha VERIFICAR_PENDENTE (mesma regra de telefone),
  // mas só considera itens QUE TÊM etapa_atual — itens do fluxo legado ou
  // simples (etapa_atual nulo) nunca aparecem aqui, então o Hermes cai pro
  // identidade.js de sempre pra eles. Filtro por etapa_atual, não
  // campanha_id (21/08/2026): desde que toda mensagem passou a exigir uma
  // campanha, campanha_id está preenchido também em disparo simples/
  // convocação — só etapa_atual continua exclusivo de script de verdade.
  // Ver sql/SIME_campanhas_scripts_schema.sql e modules/campanhas/script.js
  // do lado do Hermes.
  if (acao === 'obter_etapa_pendente') {
    if (!telefone) return res.status(400).json({ error: 'telefone é obrigatório' });

    const { data: candidatos, error } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('id, telefone_whatsapp, campanha_id, etapa_atual, ts_enviado')
      .eq('zona_id', zonaId)
      .eq('status', 'aguardando_resposta')
      .not('etapa_atual', 'is', null);
    if (error) return res.status(500).json({ error: error.message });

    const casados = (candidatos || [])
      .filter((c) => telefoneCasa(c.telefone_whatsapp, telefone))
      .sort((a, b) => new Date(b.ts_enviado || 0) - new Date(a.ts_enviado || 0));

    if (!casados.length) return res.status(200).json({ ok: true, pendente: false });

    const item = casados[0];
    const { data: etapa, error: etapaErr } = await supabase
      .from('sime_campanha_etapas')
      .select('etapa_numero, respostas_esperadas')
      .eq('campanha_id', item.campanha_id)
      .eq('etapa_numero', item.etapa_atual)
      .maybeSingle();
    if (etapaErr) return res.status(500).json({ error: etapaErr.message });
    if (!etapa) return res.status(200).json({ ok: true, pendente: false }); // etapa órfã — não trava, cai pro legado

    return res.status(200).json({
      ok: true,
      pendente: true,
      item_id: item.id,
      campanha_id: item.campanha_id,
      etapa_atual: etapa.etapa_numero,
      respostas_esperadas: etapa.respostas_esperadas,
    });
  }

  // ── AVANCAR_ETAPA ── grava a decisão de um ramo do script (casado pelo
  // Hermes em script.js) e avança pra próxima etapa, ou fecha com
  // status_final se o ramo for terminal (proxima_etapa null). Restrito ao
  // item_id explícito (o Hermes já resolveu qual item é, via
  // obter_etapa_pendente acima) e confere zona, igual todo o resto do
  // arquivo.
  if (acao === 'avancar_etapa') {
    if (!item_id) return res.status(400).json({ error: 'item_id é obrigatório' });

    const { data: item, error: itemErr } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('id, campanha_id, etapa_atual')
      .eq('id', item_id)
      .eq('zona_id', zonaId)
      .maybeSingle();
    if (itemErr) return res.status(500).json({ error: itemErr.message });
    if (!item) return res.status(404).json({ error: 'Item não encontrado nesta zona' });

    const ts = await serverTs();
    const proximaEtapaNumero = proxima_etapa ?? null;

    // Terminal: grava status_final e sai do fluxo de aguardando_resposta.
    if (!proximaEtapaNumero) {
      const statusFinal = ['confirmado', 'telefone_incorreto', 'finalizado', 'sem_resposta', 'erro']
        .includes(status_final) ? status_final : 'finalizado';
      const { error } = await supabase
        .from('sime_campanhas_confirmacao')
        .update({
          status: statusFinal,
          resposta_recebida: resposta_texto ? String(resposta_texto).slice(0, 500) : null,
          decisao_detectada: intencao || null,
          ts_respondido: ts,
          updated_at: ts,
        })
        .eq('id', item.id);
      if (error) return res.status(500).json({ error: error.message });

      await supabase.from('sime_logs').insert({
        acao: 'campanha_script_terminal', modulo: 'hermes_campanhas',
        payload: { id: item.id, zona: zona.numeroZona, intencao, status_final: statusFinal }, ts,
      });
      return res.status(200).json({ ok: true, id: item.id, status: statusFinal, proxima_mensagem: null });
    }

    // Não-terminal: busca a mensagem da próxima etapa e avança etapa_atual,
    // mantendo status 'aguardando_resposta' (a próxima etapa também espera
    // resposta).
    const { data: proximaEtapa, error: proxErr } = await supabase
      .from('sime_campanha_etapas')
      .select('mensagem, imagem_url')
      .eq('campanha_id', item.campanha_id)
      .eq('etapa_numero', proximaEtapaNumero)
      .maybeSingle();
    if (proxErr) return res.status(500).json({ error: proxErr.message });
    if (!proximaEtapa) return res.status(400).json({ error: `Etapa ${proximaEtapaNumero} não existe para esta campanha` });

    const { error } = await supabase
      .from('sime_campanhas_confirmacao')
      .update({
        etapa_atual: proximaEtapaNumero,
        resposta_recebida: resposta_texto ? String(resposta_texto).slice(0, 500) : null,
        decisao_detectada: intencao || null,
        ts_respondido: ts,
        ts_enviado: ts, // conta como novo envio pra fins de RETRY_HORAS/MAX_TENTATIVAS
        // Zera tentativas ao entrar numa etapa nova — cada etapa ganha seu
        // próprio orçamento de MAX_TENTATIVAS reenvios. Sem isso, uma etapa
        // 1 que precisou de 2 reenvios deixaria só 1 tentativa sobrando pra
        // TODAS as etapas seguintes, mesmo que a pessoa tenha respondido a
        // etapa 1 rápido (o reenvio de uma etapa não devia gastar orçamento
        // de outra).
        tentativas: 0,
        updated_at: ts,
      })
      .eq('id', item.id);
    if (error) return res.status(500).json({ error: error.message });

    await supabase.from('sime_logs').insert({
      acao: 'campanha_script_avancou', modulo: 'hermes_campanhas',
      payload: { id: item.id, zona: zona.numeroZona, intencao, etapa_anterior: item.etapa_atual, etapa_nova: proximaEtapaNumero }, ts,
    });
    return res.status(200).json({ ok: true, id: item.id, etapa_atual: proximaEtapaNumero, proxima_mensagem: proximaEtapa.mensagem, proxima_imagem_url: proximaEtapa.imagem_url || null });
  }

  // ── REGISTRAR_FORA_DO_SCRIPT ── resposta que não casou com nenhuma
  // palavra-chave da etapa atual (seção 17 da especificação de melhorias).
  // Não decide a intenção da pessoa nem manda resposta automática — mas
  // MUDA o status pra 'fora_do_script' (terminal, sai do filtro de
  // 'pendentes'). Antes disso só ia pro log e o item continuava
  // 'aguardando_resposta', então o Hermes ficava reenviando a mesma etapa
  // pra alguém que já tinha respondido (só que fora do script esperado) —
  // e não havia nenhum jeito de listar esses casos pra revisão humana além
  // de vasculhar sime_logs. Agora aparece em 'relatorio' como fila de
  // atenção; classificação por IA fica pra quando essa seção da
  // especificação for implementada (não é isto aqui).
  if (acao === 'registrar_fora_do_script') {
    if (!item_id) return res.status(400).json({ error: 'item_id é obrigatório' });

    const { data: item, error: itemErr } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('id, telefone_whatsapp, ator_id, sime_atores(nome_completo)')
      .eq('id', item_id)
      .eq('zona_id', zonaId)
      .maybeSingle();
    if (itemErr) return res.status(500).json({ error: itemErr.message });
    if (!item) return res.status(404).json({ error: 'Item não encontrado nesta zona' });

    const ts = await serverTs();
    const { error } = await supabase
      .from('sime_campanhas_confirmacao')
      .update({
        status: 'fora_do_script',
        resposta_recebida: resposta_texto ? String(resposta_texto).slice(0, 500) : null,
        ts_respondido: ts,
        updated_at: ts,
      })
      .eq('id', item_id);
    if (error) return res.status(500).json({ error: error.message });

    await supabase.from('sime_logs').insert({
      acao: 'campanha_script_fora_do_script', modulo: 'hermes_campanhas',
      payload: { id: item_id, zona: zona.numeroZona, resposta_texto }, ts,
    });
    return res.status(200).json({
      ok: true, registrado: true,
      telefone: item.telefone_whatsapp, nome: item.sime_atores?.nome_completo || null,
    });
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

    // em_andamento (22/08/2026, achado real: dono do projeto viu o mesmo
    // "Resumo da campanha" repetir toda hora no Telegram DIAS depois da
    // campanha já ter terminado — total/contagem nunca mudam quando não há
    // nada em andamento, mas o dispatch.js do Hermes mandava mesmo assim).
    // pendente/aguardando_resposta/confirmado são os únicos status
    // NÃO-terminais (mesma lista de 'pendentes' acima) — se não sobrar
    // nenhum, não há nada "rodando" pra fotografar de hora em hora,
    // campanha formal (sime_campanhas) ou fluxo legado sem campanha_id.
    const emAndamento = (contagem.pendente || 0) + (contagem.aguardando_resposta || 0) + (contagem.confirmado || 0) > 0;

    return res.status(200).json({
      ok: true,
      zona: zona.numeroZona,
      total: (data || []).length,
      contagem,
      em_andamento: emAndamento,
    });
  }

  // ── RELATORIO ── mesma fotografia do resumo, mas detalhada por pessoa —
  // pedido do dono do projeto pra saber exatamente QUEM não tem WhatsApp,
  // QUEM confirmou e QUEM negou ser a pessoa procurada (não só a contagem).
  // whatsapp_existe é lido à parte do status: 'erro' cobre qualquer falha
  // de envio (rede, timeout), não só número inexistente — só entra em
  // nao_whatsapp quando o Hermes marcou whatsapp_existe=false de propósito.
  //
  // fora_do_script (desde 18/08/2026) é a fila de atenção dos scripts de
  // campanha — respostas que não casaram com nenhuma palavra-chave da
  // etapa (ver ação 'registrar_fora_do_script'). Traz resposta_recebida
  // junto (as outras três colunas não precisam do texto da resposta —
  // aqui é justamente o que um humano precisa ler pra decidir o que fazer).
  if (acao === 'relatorio') {
    const { data, error } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('telefone_whatsapp, status, whatsapp_existe, resposta_recebida, sime_atores(nome_completo)')
      .eq('zona_id', zonaId);
    if (error) return res.status(500).json({ error: error.message });

    const linha = (c) => ({ telefone: c.telefone_whatsapp, nome: c.sime_atores?.nome_completo || null });
    const rows = data || [];
    const naoWhatsapp = rows.filter((c) => c.whatsapp_existe === false).map(linha);
    const confirmaram = rows.filter((c) => ['confirmado', 'finalizado'].includes(c.status)).map(linha);
    const negaram = rows.filter((c) => c.status === 'telefone_incorreto').map(linha);
    const foraDoScript = rows.filter((c) => c.status === 'fora_do_script')
      .map((c) => ({ ...linha(c), resposta: c.resposta_recebida || null }));

    return res.status(200).json({
      ok: true, zona: zona.numeroZona, total: rows.length,
      nao_whatsapp: naoWhatsapp, confirmaram, negaram, fora_do_script: foraDoScript,
    });
  }

  // ── LISTAR_FORA_DO_SCRIPT_PERIODO ── (desde 19/08/2026) pedido do dono
  // do projeto: "quero que todas as mensagens do dia anterior virem
  // aprendizado para o script conversacional" — confirmado, ao perguntar o
  // escopo, que é especificamente sobre as respostas que caíram fora do
  // script (não o log geral de conversa), pra sugerir novas palavras-chave
  // por IA. Diferente de 'relatorio' (fila de atenção sem filtro de data,
  // achatada): aqui filtra por `ts_respondido` num período (`desde`/`ate`,
  // ISO) e já traz, JUNTO de cada item, a etapa correspondente
  // (respostas_esperadas — os ramos/palavras-chave já cadastrados), pra
  // quem chama poder montar um prompt de IA por etapa sem precisar de uma
  // segunda ida ao banco por item. Só lê — não decide nada, não muda
  // status (isso é papel de 'avancar_etapa', chamado só depois que um
  // humano aprovar uma sugestão e editar o script de verdade).
  if (acao === 'listar_fora_do_script_periodo') {
    if (!desde || !ate) return res.status(400).json({ error: 'desde e ate são obrigatórios (ISO 8601)' });

    const { data, error } = await supabase
      .from('sime_campanhas_confirmacao')
      .select('id, telefone_whatsapp, campanha_id, etapa_atual, resposta_recebida, ts_respondido, sime_atores(nome_completo)')
      .eq('zona_id', zonaId)
      .eq('status', 'fora_do_script')
      .gte('ts_respondido', desde)
      .lt('ts_respondido', ate)
      .not('campanha_id', 'is', null);
    if (error) return res.status(500).json({ error: error.message });

    const itens = data || [];
    if (itens.length === 0) return res.status(200).json({ ok: true, itens: [] });

    // Etapas em lote (mesmo padrão de 'pendentes' acima) — evita uma query
    // por item quando vários itens do período são da mesma etapa.
    const chaves = [...new Set(itens.map((i) => `${i.campanha_id}:${i.etapa_atual}`))];
    const campanhaIds = [...new Set(itens.map((i) => i.campanha_id))];
    const { data: etapas, error: etapasErr } = await supabase
      .from('sime_campanha_etapas')
      .select('campanha_id, etapa_numero, respostas_esperadas')
      .in('campanha_id', campanhaIds);
    if (etapasErr) return res.status(500).json({ error: etapasErr.message });
    const etapaPorChave = new Map((etapas || []).map((e) => [`${e.campanha_id}:${e.etapa_numero}`, e]));

    const { data: campanhasInfo } = await supabase
      .from('sime_campanhas')
      .select('id, nome')
      .in('id', campanhaIds);
    const nomeCampanhaPorId = new Map((campanhasInfo || []).map((c) => [c.id, c.nome]));

    const resultado = itens
      .filter((i) => etapaPorChave.has(`${i.campanha_id}:${i.etapa_atual}`)) // etapa órfã (apagada depois) — ignora, não trava nada
      .map((i) => ({
        id: i.id,
        telefone: i.telefone_whatsapp,
        nome: i.sime_atores?.nome_completo || null,
        resposta: i.resposta_recebida,
        campanha_id: i.campanha_id,
        campanha_nome: nomeCampanhaPorId.get(i.campanha_id) || null,
        etapa_numero: i.etapa_atual,
        respostas_esperadas: etapaPorChave.get(`${i.campanha_id}:${i.etapa_atual}`).respostas_esperadas,
      }));

    return res.status(200).json({ ok: true, itens: resultado });
  }

  return res.status(400).json({ error: `Ação desconhecida: ${acao}` });
}
