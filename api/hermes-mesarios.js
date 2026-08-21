// api/hermes-mesarios.js
// Vercel Serverless Function
// Caminho de LEITURA + CONFIRMAÇÃO de mesários/apoio logístico para o Hermes Agent.
//
// Espelha api/hermes-update.js (mesma auth por zona via Bearer, mesmo
// service_role), mas opera sobre PESSOAS (sime_atores), não sobre seções:
//   - acao='listar'      → devolve as pessoas da zona (nome, telefone, seção, status)
//   - acao='consultar'   → autoatendimento: 1 telefone → convocação + seção pronta pro WhatsApp
//                          (+ imagem_url, se essa pessoa já tiver uma campanha
//                          de convocação com imagem configurada — usado pelo
//                          Hermes quando alguém se identifica como mesário
//                          espontaneamente, sem ter sido perguntado antes)
//   - acao='buscar_nome' → autoatendimento por nome (substring, case-insensitive) →
//                          mesmo formato de resposta do 'consultar', pra quem não
//                          está mandando do próprio telefone cadastrado
//   - acao='atualizar' → guarda um recado livre da pessoa (observacao) pro cartório revisar
//   - acao='relatar_terceiro' → alguém (grupo ou DM) reporta a situação de OUTRA
//                          pessoa, nomeada — anexa em observacao, marcado
//                          "precisa confirmar" (nunca muda confirmacao=,
//                          diferente de 'atualizar'/'confirmar'/'recusar', que
//                          são sempre a própria pessoa falando por si)
//   - acao='atualizar_telefone_terceiro' → alguém encaminha "Nome + telefone"
//                          que descobriu por fora sobre OUTRA pessoa (achado
//                          real 21/08/2026: cartório testou encaminhando
//                          contatos pro WhatsApp do Hermes). Diferente de
//                          relatar_terceiro (que é sobre a SITUAÇÃO da
//                          pessoa e nunca grava telefone), aqui o dado É um
//                          telefone — só grava automaticamente quando o nome
//                          bate em EXATAMENTE 1 pessoa, e só em
//                          telefone_alternativo (nunca sobrescreve o
//                          telefone_whatsapp principal, que é o que
//                          Hermes/campanha usam por padrão)
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

// Mesma heurística de normalizarTelefoneWhatsapp() em sime_ui_utils.js — pro
// padrão WhatsApp ("55"+DDD+9 dígitos) ficar idêntico em todo caminho de
// import, incluindo este (ver "Todo import normaliza telefone" no CLAUDE.md).
function normalizarTelefoneWhatsapp(raw) {
  const d = soDigitos(raw);
  if (!d) return '';
  if (d === '000000000000') return raw;
  const len = d.length;
  if (len === 13 && d.slice(0, 2) === '55') return d;
  if (len === 11) return '55' + d;
  if (len === 10) return /[6-9]/.test(d[2]) ? '55' + d.slice(0, 2) + '9' + d.slice(2) : '55' + d;
  if (len === 9 && d[0] === '9') return '5586' + d;
  if (len === 8) return /[6-9]/.test(d[0]) ? '55869' + d : '5586' + d;
  if (len === 12 && d[0] === '0') return '55' + d.slice(1);
  if (len === 12 && d.slice(0, 2) === '55') return /[6-9]/.test(d[4]) ? d.slice(0, 4) + '9' + d.slice(4) : d;
  return d;
}
// Mesmo critério de aceitação de cpNormalizarTelefone() ("colar lista de
// telefones") — deliberadamente conservador: rejeita (null) qualquer
// comprimento fora do que dá pra deduzir sem adivinhar (ex.: artefato de
// cópia com um dígito a mais). Usado só quando o telefone vem de terceiro,
// nunca da própria pessoa confirmando o dado.
function normalizarTelefoneParaGravar(raw) {
  const d = soDigitos(raw);
  const len = d.length;
  const aceito = len === 8 || len === 9 || len === 10 || len === 11
    || ((len === 12 || len === 13) && d.startsWith('55'));
  return aceito ? normalizarTelefoneWhatsapp(d) : null;
}
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

// Agrupa uma lista de pessoas (já filtrada por substring de nome) por
// nome_completo — a mesma pessoa pode ter mais de uma convocação (mesário
// e apoio logístico), não deve virar "gente diferente" no agrupamento.
// Extraído de 'buscar_nome' pra reaproveitar em 'relatar_terceiro'.
function agruparPorNome(alvos) {
  const porNome = new Map();
  for (const p of alvos) {
    if (!porNome.has(p.nome_completo)) porNome.set(p.nome_completo, []);
    porNome.get(p.nome_completo).push(p);
  }
  return porNome;
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

  const { acao, secao, status, telefone, mensagem, nome, telefone_relator, origem } = req.body || {};
  if (!acao) return res.status(400).json({ error: 'acao é obrigatória (listar|consultar|buscar_nome|atualizar|relatar_terceiro|atualizar_telefone_terceiro|confirmar|recusar|substituir)' });

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

    // ── CONSULTAR — autoatendimento ("oi", ou o Hermes reconhecendo alguém
    // se identificando como mesário espontaneamente) ──
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

      // Imagem de "como confirmar a convocação" (21/08/2026): não existe um
      // campo próprio pra isso em sime_atores — reaproveita a imagem já
      // configurada na campanha de convocação mais recente dessa pessoa
      // (sime_campanhas_confirmacao.imagem_url, a mesma que dispatch.js do
      // Hermes manda no fluxo normal de campanha). Se a pessoa nunca teve
      // uma campanha com imagem configurada, fica null e o Hermes manda só
      // o texto — nunca é erro, é só "sem imagem disponível".
      const atorIds = alvos.map(p => p.id).filter(Boolean);
      let imagemUrl = null;
      if (atorIds.length > 0) {
        const { data: campanhaRows } = await supabase
          .from('sime_campanhas_confirmacao')
          .select('imagem_url, created_at')
          .in('ator_id', atorIds)
          .not('imagem_url', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1);
        imagemUrl = campanhaRows?.[0]?.imagem_url || null;
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
        imagem_url: imagemUrl,
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

    // ── RELATAR_TERCEIRO — outro mesário reporta a situação de um COLEGA,
    // nomeado (grupo ou DM) — "o Fulano não vai poder", "avisa que a Maria
    // desistiu". Diferente de 'atualizar'/'confirmar'/'recusar' (sempre a
    // própria pessoa, identificada pelo telefone dela): aqui quem manda a
    // mensagem (telefone_relator) não é o alvo (nome) — então NUNCA muda
    // confirmacao=, só anexa em observacao com marca "precisa confirmar",
    // pro cartório verificar com a pessoa antes de agir. Casa por NOME
    // (substring, mesmo critério de 'buscar_nome') porque quem relata
    // raramente sabe o telefone cadastrado do colega.
    if (acao === 'relatar_terceiro') {
      if (!nome) return res.status(400).json({ error: 'nome é obrigatório para relatar_terceiro' });
      if (!mensagem) return res.status(400).json({ error: 'mensagem é obrigatória para relatar_terceiro' });
      const alvo = nome.trim().toLowerCase();
      if (alvo.length < 3) {
        return res.status(400).json({ error: 'nome muito curto para buscar (mínimo 3 caracteres)' });
      }
      const candidatos = pessoas.filter(p => (p.nome_completo || '').toLowerCase().includes(alvo));
      const porNome = agruparPorNome(candidatos);

      if (porNome.size === 0) {
        return res.status(404).json({
          ok: false, encontrado: 0,
          mensagem_wa: `Não encontrei ninguém chamado "${nome}" na lista de convocados desta zona.`,
        });
      }
      // Ambíguo — mais de uma pessoa distinta bate no nome. Não adivinha
      // qual: um relato de terceiro já é segundo-mão, gravar na pessoa
      // errada seria pior que não gravar. Fica pro Hermes avisar no
      // Telegram e o cartório resolver manualmente.
      if (porNome.size > 1) {
        return res.status(409).json({
          ok: false, ambiguo: true, encontrado: candidatos.length,
          candidatos: [...porNome.keys()],
        });
      }

      const [alvos] = [...porNome.values()];
      const ts = await serverTs();
      const carimbo = `[${String(ts).slice(0, 16).replace('T', ' ')}] ⚠️ Relato de terceiro (via ${origem || 'WhatsApp'}${telefone_relator ? `, tel. ${soDigitos(telefone_relator)}` : ''}): ${mensagem} — PRECISA CONFIRMAR COM A PESSOA`;
      for (const p of alvos) {
        const novaObs = p.observacao ? `${p.observacao}\n${carimbo}` : carimbo;
        // tem_relato_terceiro_pendente (21/08/2026) — o carimbo em observacao
        // sozinho só aparece pra quem já abriu o modal dessa pessoa; a flag
        // dá pra filtrar/destacar em "Contatar mesários" quem tem relato
        // esperando confirmação, sem precisar abrir um por um. Mesmo
        // espírito de precisa_substituir (flag manual, separada de
        // confirmacao) — o cartório desmarca depois de confirmar com a
        // própria pessoa (ver cmResolverRelatoTerceiro em
        // sime_contatar_mesarios.js).
        const { error: upErr } = await supabase.from('sime_atores')
          .update({ observacao: novaObs, tem_relato_terceiro_pendente: true })
          .eq('id', p.id);
        if (upErr) throw upErr;
      }
      await registrarLog('hermes_relato_terceiro', {
        nome_alvo: alvos[0].nome_completo, telefone_relator: telefone_relator ? soDigitos(telefone_relator) : null,
        zona: zona.numeroZona, mensagem, origem: origem || null,
        afetados: alvos.map(p => ({ id: p.id, nome: p.nome_completo })), ts,
      });
      return res.status(200).json({
        ok: true, encontrado: alvos.length, nomes: alvos.map(p => p.nome_completo),
      });
    }

    // ── ATUALIZAR_TELEFONE_TERCEIRO — alguém encaminha "Nome + telefone" que
    // descobriu por fora sobre OUTRA pessoa (achado real 21/08/2026: o
    // cartório testou encaminhar contatos pro WhatsApp do Hermes — hoje isso
    // não alimentava nada). Diferente de relatar_terceiro (que é sobre a
    // SITUAÇÃO da pessoa e nunca grava telefone): aqui o dado É um telefone.
    // Casa por NOME (mesmo critério de buscar_nome/relatar_terceiro) — só
    // grava automaticamente quando bate em EXATAMENTE 1 pessoa; nome
    // ambíguo ou não encontrado não adivinha (mesma cautela de sempre).
    // Grava só em telefone_alternativo, NUNCA em telefone_whatsapp — mesmo
    // um nome errado não sobrescreveria o telefone principal que
    // Hermes/campanha usam por padrão (ver
    // sql/SIME_atores_telefone_alternativo.sql).
    if (acao === 'atualizar_telefone_terceiro') {
      if (!nome) return res.status(400).json({ error: 'nome é obrigatório para atualizar_telefone_terceiro' });
      if (!telefone) return res.status(400).json({ error: 'telefone é obrigatório para atualizar_telefone_terceiro' });
      const alvo = nome.trim().toLowerCase();
      if (alvo.length < 3) {
        return res.status(400).json({ error: 'nome muito curto para buscar (mínimo 3 caracteres)' });
      }

      const telNormalizado = normalizarTelefoneParaGravar(telefone);
      if (!telNormalizado) {
        return res.status(422).json({
          ok: false, erro: 'telefone_invalido',
          mensagem_wa: `Não consegui reconhecer um telefone válido em "${telefone}" — confira o formato e tente de novo.`,
        });
      }

      const candidatos = pessoas.filter(p => (p.nome_completo || '').toLowerCase().includes(alvo));
      const porNome = agruparPorNome(candidatos);

      if (porNome.size === 0) {
        return res.status(404).json({
          ok: false, encontrado: 0,
          mensagem_wa: `Não encontrei ninguém chamado "${nome}" na lista de convocados desta zona.`,
        });
      }
      // Ambíguo — mais de uma pessoa distinta bate no nome. Não adivinha
      // qual: gravar telefone na pessoa errada é pior que não gravar.
      if (porNome.size > 1) {
        return res.status(409).json({
          ok: false, ambiguo: true, encontrado: candidatos.length,
          candidatos: [...porNome.keys()],
        });
      }

      const [alvos] = [...porNome.values()];
      const ts = await serverTs();
      for (const p of alvos) {
        const { error: upErr } = await supabase.from('sime_atores')
          .update({ telefone_alternativo: telNormalizado })
          .eq('id', p.id);
        if (upErr) throw upErr;
      }
      await registrarLog('hermes_atualizou_telefone_terceiro', {
        nome_alvo: alvos[0].nome_completo, telefone_novo: telNormalizado,
        telefone_relator: telefone_relator ? soDigitos(telefone_relator) : null,
        zona: zona.numeroZona, origem: origem || null,
        afetados: alvos.map(p => ({ id: p.id, nome: p.nome_completo })), ts,
      });
      return res.status(200).json({
        ok: true, encontrado: alvos.length, nomes: alvos.map(p => p.nome_completo),
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
