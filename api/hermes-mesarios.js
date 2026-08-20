// api/hermes-mesarios.js
// Vercel Serverless Function
// Caminho de LEITURA + CONFIRMAÇÃO de mesários/apoio logístico para o Hermes Agent.
//
// Espelha api/hermes-update.js (mesma auth por zona via Bearer, mesmo
// service_role), mas opera sobre PESSOAS (sime_atores), não sobre seções:
//   - acao='listar'      → devolve as pessoas da zona (nome, telefone, seção, status)
//   - acao='consultar'   → autoatendimento: 1 telefone → convocação + seção pronta pro WhatsApp
//   - acao='buscar_nome' → autoatendimento por nome (substring, case-insensitive) →
//                          mesmo formato de resposta do 'consultar', pra quem não
//                          está mandando do próprio telefone cadastrado
//   - acao='atualizar' → guarda um recado livre da pessoa (observacao) pro cartório revisar
//   - acao='confirmar' → marca sime_atores.confirmacao='confirmado' (permanece)
//   - acao='recusar'   → 'recusou'     (+ ativo=false — não vai atuar)
//   - acao='substituir'→ 'substituido' (+ ativo=false)
//
// Fecha o ciclo do painel "Confirmação de mesários" do SIME_admin.html: o Hermes
// pergunta pelo WhatsApp e grava a resposta; o cartório vê no painel/relatórios.
//
// 'consultar'/'atualizar' cobrem mesário (MRV) E apoio logístico (AL) — por
// isso o filtro de base inclui as 3 funções vindas do TRE, não só 'mesario'.
// 'atualizar' NUNCA sobrescreve nome/telefone/seção (dado oficial do TRE,
// recarregado por sime_sync_atores_from_raw) — só anexa o recado em
// observacao pra revisão humana, igual um log.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const FUNCOES_TRE = ['mesario', 'coord_acessibilidade', 'auxiliar_eleicao'];

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
// Extrai o número da seção do texto em observacao ("Seção votação: NNN") —
// só usado como fallback pra registros antigos, de antes do secao_id vir
// preenchido de verdade pela carga do TRE (sime_sync_atores_from_raw).
function secaoDaObs(obs) {
  const m = /Se[çc][ãa]o\s*vota[çc][ãa]o:\s*(\d+)/i.exec(obs || '');
  return m ? String(m[1]).padStart(4, '0') : null;
}
// Detalhe de seção: prefere secao_id (join com sime_secoes, já populado pra
// quem veio da carga do TRE); cai pro texto de observacao pra dado legado.
function secaoDetalhe(pessoa, secoesPorId) {
  const s = pessoa.secao_id ? secoesPorId.get(pessoa.secao_id) : null;
  if (s) return { numero: String(s.numero).padStart(4, '0'), local_nome: s.local_nome, municipio: s.municipio };
  const numero = secaoDaObs(pessoa.observacao);
  return numero ? { numero, local_nome: null, municipio: null } : null;
}

// Casa por telefone: exato (dígitos) ou, como folga, pelos últimos 8 dígitos
// (cobre variações de DDI/DDD entre o que o WhatsApp manda e o cadastro).
function telefoneCasa(cadastro, alvo) {
  const a = soDigitos(cadastro), b = soDigitos(alvo);
  if (!a || !b || a.length < 8 || b.length < 8) return false;
  return a === b || a.slice(-8) === b.slice(-8);
}

// Rótulo de função pronto pra frase em português.
function rotuloFuncao(pessoa) {
  if (pessoa.funcao === 'mesario') return pessoa.funcao_mesa || 'mesário(a)';
  if (pessoa.funcao === 'coord_acessibilidade') return 'Coordenador(a) de Acessibilidade';
  return 'Auxiliar de Serviços Eleitorais (apoio logístico)';
}

// Monta a mensagem de autoatendimento pra 1+ convocações da mesma pessoa
// (existe gente que é mesário E apoio logístico na mesma eleição).
function mensagemConsulta(pessoas, secoesPorId) {
  const partes = pessoas.map((p) => {
    if (p.funcao === 'mesario') {
      const sec = secaoDetalhe(p, secoesPorId);
      const local = sec ? `Seção ${sec.numero}` + (sec.local_nome ? ` — ${sec.local_nome}, ${sec.municipio}` : '') : 'seção a confirmar';
      return `${rotuloFuncao(p)} na ${local}`;
    }
    return rotuloFuncao(p);
  });
  const nome = pessoas[0].nome_completo;
  let msg = `Olá, ${nome}! Você está convocado(a) como ${partes.join(' e também ')} para a eleição de 04/10.`;
  if (pessoas.some((p) => p.confirmacao === 'confirmado')) {
    msg += ' Você já confirmou presença — obrigado!';
  } else if (pessoas.some((p) => p.confirmacao === 'recusou')) {
    msg += ' Consta que você não vai atuar — se isso mudou, me avisa.';
  }
  msg += ' Se algum dado estiver errado, ou você não puder mais atuar, me manda a informação que eu repasso pro cartório.';
  return msg;
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

  const { acao, secao, status, telefone, mensagem, nome } = req.body || {};
  if (!acao) return res.status(400).json({ error: 'acao é obrigatória (listar|consultar|buscar_nome|atualizar|confirmar|recusar|substituir)' });

  const zonaId = await buscarZonaId(zona.numeroZona);
  if (!zonaId) {
    return res.status(500).json({ error: `Zona ${zona.numeroZona} não cadastrada no SIME` });
  }

  try {
    // Base: mesários + apoio logístico da zona autenticada (isolamento por zona_id).
    let q = supabase.from('sime_atores')
      .select('id, nome_completo, telefone_whatsapp, observacao, confirmacao, ativo, secao_id, funcao, funcao_mesa')
      .eq('zona_id', zonaId)
      .in('funcao', FUNCOES_TRE);
    if (status) q = q.eq('confirmacao', status);
    const { data, error } = await q.order('nome_completo');
    if (error) throw error;
    let pessoas = data || [];

    // Filtro por seção (usa secao_id quando já houver backfill; senão, o texto do observacao).
    if (secao) {
      const alvo = String(parseInt(secao)).padStart(4, '0');
      pessoas = pessoas.filter(p => secaoDaObs(p.observacao) === alvo);
    }

    // Seções da zona, pra resolver secao_id → número/local/município.
    const { data: secoesData } = await supabase.from('sime_secoes').select('id, numero, local_nome, municipio').eq('zona_id', zonaId);
    const secoesPorId = new Map((secoesData || []).map(s => [s.id, s]));

    // ── LISTAR ──
    if (acao === 'listar') {
      return res.status(200).json({
        ok: true,
        total: pessoas.length,
        mesarios: pessoas.map(p => ({
          nome: p.nome_completo,
          telefone: p.telefone_whatsapp,
          secao: secaoDetalhe(p, secoesPorId)?.numero || null,
          confirmacao: p.confirmacao,
          ativo: p.ativo,
        })),
      });
    }

    // ── CONSULTAR — autoatendimento ("oi") ──
    if (acao === 'consultar') {
      if (!telefone) return res.status(400).json({ error: 'telefone é obrigatório para consultar' });
      const alvos = pessoas.filter(p => telefoneCasa(p.telefone_whatsapp, telefone));
      if (alvos.length === 0) {
        return res.status(404).json({
          ok: false,
          encontrado: 0,
          mensagem_wa: 'Não encontrei seu telefone na lista de convocados desta zona. Fale com o cartório.',
        });
      }
      return res.status(200).json({
        ok: true,
        encontrado: alvos.length,
        pessoas: alvos.map(p => ({
          nome: p.nome_completo,
          funcao: p.funcao,
          funcao_mesa: p.funcao_mesa,
          secao: secaoDetalhe(p, secoesPorId),
          confirmacao: p.confirmacao,
        })),
        mensagem_wa: mensagemConsulta(alvos, secoesPorId),
      });
    }

    // ── BUSCAR_NOME — autoatendimento por nome (quem não manda do próprio telefone) ──
    if (acao === 'buscar_nome') {
      if (!nome) return res.status(400).json({ error: 'nome é obrigatório para buscar_nome' });
      const alvo = nome.trim().toLowerCase();
      if (alvo.length < 3) {
        return res.status(400).json({ error: 'nome muito curto para buscar (mínimo 3 caracteres)' });
      }
      const alvos = pessoas.filter(p => (p.nome_completo || '').toLowerCase().includes(alvo));

      if (alvos.length === 0) {
        return res.status(404).json({
          ok: false,
          encontrado: 0,
          mensagem_wa: `Não encontrei ninguém chamado "${nome}" na lista de convocados desta zona. Confira a grafia ou fale com o cartório.`,
        });
      }

      // Agrupa por nome completo — a mesma pessoa pode ter mais de uma
      // convocação (ex.: mesário e apoio logístico), não deve virar "gente
      // diferente" na resposta. Nomes completos distintos que batem no
      // mesmo pedaço de texto (ex.: dois "José da Silva") ficam separados.
      const porNome = new Map();
      for (const p of alvos) {
        if (!porNome.has(p.nome_completo)) porNome.set(p.nome_completo, []);
        porNome.get(p.nome_completo).push(p);
      }

      if (porNome.size > 8) {
        return res.status(200).json({
          ok: true,
          encontrado: alvos.length,
          mensagem_wa: `Encontrei ${porNome.size} pessoas com "${nome}" — manda o nome completo pra eu achar certo.`,
        });
      }

      if (porNome.size === 1) {
        const [pessoaUnica] = [...porNome.values()];
        return res.status(200).json({
          ok: true,
          encontrado: pessoaUnica.length,
          pessoas: pessoaUnica.map(p => ({
            nome: p.nome_completo, funcao: p.funcao, funcao_mesa: p.funcao_mesa,
            secao: secaoDetalhe(p, secoesPorId), confirmacao: p.confirmacao,
          })),
          mensagem_wa: mensagemConsulta(pessoaUnica, secoesPorId),
        });
      }

      const linhas = [...porNome.entries()].map(([nomeCompleto, ps]) => {
        const p = ps[0];
        const sec = secaoDetalhe(p, secoesPorId);
        return `• ${nomeCompleto} — ${rotuloFuncao(p)}${sec ? ` (Seção ${sec.numero})` : ''} — ${p.confirmacao}`;
      });
      return res.status(200).json({
        ok: true,
        encontrado: alvos.length,
        mensagem_wa: `Encontrei ${porNome.size} pessoas com "${nome}":\n${linhas.join('\n')}\n\nManda o nome completo se quiser o detalhe de uma pessoa específica.`,
      });
    }

    // ── ATUALIZAR — recado livre da pessoa, vira observação pro cartório revisar ──
    // Nunca sobrescreve nome/telefone/seção (dado oficial do TRE) — só anexa.
    if (acao === 'atualizar') {
      if (!telefone) return res.status(400).json({ error: 'telefone é obrigatório para atualizar' });
      if (!mensagem) return res.status(400).json({ error: 'mensagem é obrigatória para atualizar' });
      const alvos = pessoas.filter(p => telefoneCasa(p.telefone_whatsapp, telefone));
      if (alvos.length === 0) {
        return res.status(404).json({
          ok: false,
          encontrado: 0,
          mensagem_wa: 'Não encontrei seu telefone na lista de convocados desta zona. Fale com o cartório.',
        });
      }
      const ts = await serverTs();
      const carimbo = `[${String(ts).slice(0, 16).replace('T', ' ')}] Recado via Hermes: ${mensagem}`;
      for (const p of alvos) {
        const novaObs = p.observacao ? `${p.observacao}\n${carimbo}` : carimbo;
        const { error: upErr } = await supabase.from('sime_atores')
          .update({ observacao: novaObs })
          .eq('id', p.id);
        if (upErr) throw upErr;
      }
      await registrarLog('hermes_atualizou_info', {
        telefone: soDigitos(telefone), zona: zona.numeroZona, mensagem,
        // id junto do nome (20/08/2026) — sem isso o modal de mesário em
        // SIME_convocacao.html não tinha como casar este log com a pessoa
        // sem comparação fuzzy por nome, e ficava de fora do histórico.
        afetados: alvos.map(p => ({ id: p.id, nome: p.nome_completo })), ts,
      });
      return res.status(200).json({
        ok: true,
        encontrado: alvos.length,
        mensagem_wa: 'Anotado! Vou repassar pro cartório. Obrigado por avisar.',
      });
    }

    // ── CONFIRMAR / RECUSAR / SUBSTITUIR (identifica a pessoa pelo telefone) ──
    const conf = ACAO_CONF[acao];
    if (!conf) return res.status(400).json({ error: `Ação desconhecida: ${acao}` });
    if (!telefone) return res.status(400).json({ error: 'telefone é obrigatório para registrar confirmação' });

    const alvos = pessoas.filter(p => telefoneCasa(p.telefone_whatsapp, telefone));
    if (alvos.length === 0) {
      return res.status(404).json({
        ok: false,
        encontrado: 0,
        mensagem_wa: 'Não encontrei você na lista de mesários desta zona. Fale com o cartório.',
      });
    }

    const ts = await serverTs();
    for (const p of alvos) {
      const { error: upErr } = await supabase.from('sime_atores')
        .update({ confirmacao: conf.confirmacao, ativo: conf.ativo })
        .eq('id', p.id);
      if (upErr) throw upErr;
    }
    await registrarLog('hermes_confirmou_mesario', {
      acao, telefone: soDigitos(telefone), zona: zona.numeroZona,
      // id junto (20/08/2026) — mesmo motivo do hermes_atualizou_info acima.
      afetados: alvos.map(p => ({ id: p.id, nome: p.nome_completo, secao: secaoDetalhe(p, secoesPorId)?.numero || null })), ts,
    });

    return res.status(200).json({
      ok: true,
      encontrado: alvos.length,
      confirmacao: conf.confirmacao,
      nomes: alvos.map(p => p.nome_completo),
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
