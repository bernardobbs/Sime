// ══════════════════════════════════════
// DASHBOARD — situação geral da zona em dois níveis: por LOCAL DE VOTAÇÃO
// (agrega as seções que dividem o mesmo prédio) e, ao clicar num local, por
// SEÇÃO (os 4 cargos de mesa). Usa o status de confirmação REAL do SIME
// (sime_atores.confirmacao, gravado por api/hermes-mesarios.js quando a
// pessoa responde pelo WhatsApp) — não o "Confirmou convocação" da
// planilha, que é um controle humano paralelo e não chega a sime_atores
// (ver sime_mesarios_sync.js).
//
// sime_secoes não tem id próprio de "local de votação" — o agrupamento é
// por (local_nome + município). Endereço do local (rua/povoado) também não
// existe no schema hoje, então os cards mostram local + município, não
// endereço completo.
// ══════════════════════════════════════

const RS_CARGOS = ['Presidente', '1º Mesário', '2º Mesário', '1º Secretário'];

let rsDados = null;      // { secoes:[...], porSecao:{}, totalMesarios, totalApoio }
let rsBusca = '';
let rsModo = 'grade';    // 'grade' | 'lista'
let rsLocalAberto = null; // chave `${local_nome}|||${municipio}` do local em drilldown, ou null
// Fechada por padrão (21/08/2026) — a tabela por município deixava o topo
// do Dashboard denso demais competindo com a barra-funil e as pizzas;
// pedido do cartório pra virar uma seção recolhível em vez de sumir ou
// virar mais gráficos.
let rsMunicipiosAberto = false;
function rsToggleMunicipios() { rsMunicipiosAberto = !rsMunicipiosAberto; render(); }

async function rsCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { rsDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: secoes, error: e1 }, { data: atores, error: e2 }, { data: apoio, error: e3 }] = await Promise.all([
    sb.from('sime_secoes').select('id, numero, municipio, local_nome, eleitores').eq('zona_id', zonaId).eq('ativo', true).order('numero'),
    sb.from('sime_atores').select('id, nome_completo, secao_id, funcao_mesa, confirmacao, precisa_substituir, data_confirmacao').eq('zona_id', zonaId).eq('funcao', 'mesario').eq('ativo', true),
    // Antes era só `count` (head:true) — trocado por linha completa com
    // confirmacao pra poder quebrar confirmados/faltam também pro apoio
    // logístico nos stat cards, não só o total.
    // secao_id junto (21/08/2026) — só pra saber quantos LOCAIS têm pelo
    // menos um apoio logístico designado, pro gráfico de pizza "nomeado x
    // vazio" (apoio não tem cargo fixo tipo mesário, então "vazio" aqui é
    // por local, não por cargo).
    // funcao junto (21/08/2026) — as pizzas novas separam Coordenador de
    // Acessibilidade de Auxiliar de Eleição (antes só existia o bucket
    // combinado "apoio logístico"); sem a função aqui não dava pra saber
    // qual dos dois cada linha representa.
    sb.from('sime_atores').select('id, confirmacao, secao_id, funcao').eq('zona_id', zonaId).eq('ativo', true).in('funcao', ['coord_acessibilidade', 'auxiliar_eleicao']),
  ]);
  if (e1 || e2 || e3) { rsDados = { erro: (e1 || e2 || e3).message }; render(); return; }

  // Por local, quem tem alguém designado/confirmado de CADA função de apoio
  // separadamente — 1 vaga por local pra cada uma (mesma premissa já usada
  // pro bucket combinado: nem coordenador de acessibilidade nem auxiliar de
  // eleição têm cargo fixo no schema, então a "vaga" é por prédio).
  const secaoIdsPorFuncaoTodos = { coord_acessibilidade: new Set(), auxiliar_eleicao: new Set() };
  const secaoIdsPorFuncaoConfirmado = { coord_acessibilidade: new Set(), auxiliar_eleicao: new Set() };
  for (const a of apoio || []) {
    if (!a.secao_id || !secaoIdsPorFuncaoTodos[a.funcao]) continue;
    secaoIdsPorFuncaoTodos[a.funcao].add(a.secao_id);
    if (a.confirmacao === 'confirmado') secaoIdsPorFuncaoConfirmado[a.funcao].add(a.secao_id);
  }

  const porSecao = {};
  const atualizadoPorSecao = {};
  for (const a of atores || []) {
    if (!a.secao_id || !a.funcao_mesa) continue;
    if (!porSecao[a.secao_id]) porSecao[a.secao_id] = {};
    // Se por algum motivo houver mais de um ativo no mesmo cargo, fica o
    // "melhor" status (confirmado > pendente > recusou) — melhor mostrar
    // otimista do que esconder que alguém já confirmou. Guarda o ator
    // inteiro agora (não só a string de confirmacao) — o card da seção
    // mostra o nome de quem está designado, não só um ícone.
    const atual = porSecao[a.secao_id][a.funcao_mesa];
    const prioridade = { confirmado: 3, pendente: 2, substituido: 1, recusou: 1, contato_incorreto: 1 };
    if (!atual || (prioridade[a.confirmacao] || 0) >= (prioridade[atual.confirmacao] || 0)) {
      porSecao[a.secao_id][a.funcao_mesa] = a;
    }
    if (a.data_confirmacao && (!atualizadoPorSecao[a.secao_id] || a.data_confirmacao > atualizadoPorSecao[a.secao_id])) {
      atualizadoPorSecao[a.secao_id] = a.data_confirmacao;
    }
  }
  rsDados = {
    secoes: secoes || [], porSecao, atualizadoPorSecao,
    totalMesarios: (atores || []).length, totalApoio: (apoio || []).length,
    confirmadosMRV: (atores || []).filter(a => a.confirmacao === 'confirmado').length,
    confirmadosApoio: (apoio || []).filter(a => a.confirmacao === 'confirmado').length,
    secaoIdsPorFuncaoTodos, secaoIdsPorFuncaoConfirmado,
  };
  render();
}

function rsEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Recebe o ator inteiro (não só a string de confirmacao) pra poder mostrar o
// nome e sinalizar precisa_substituir — flag manual do cartório, distinta de
// confirmacao='substituido' (que é o status já resolvido). Uma pessoa
// confirmada pode ser marcada pra substituição depois (ex.: virou inelegível)
// — por isso esse flag tem prioridade visual sobre o confirmacao normal.
function rsStatusCargo(ator) {
  if (!ator) return { icone: '❌', label: 'Sem designação', cls: 'rs-sem', nome: null, id: null };
  const nome = ator.nome_completo, id = ator.id;
  if (ator.precisa_substituir) return { icone: '🔁', label: `Precisa ser substituído — ${nome}`, cls: 'rs-alerta', nome, id };
  if (ator.confirmacao === 'confirmado') return { icone: '✅', label: `Confirmado — ${nome}`, cls: 'rs-ok', nome, id };
  if (ator.confirmacao === 'recusou') return { icone: '⚠️', label: `Recusou — precisa substituto — ${nome}`, cls: 'rs-alerta', nome, id };
  if (ator.confirmacao === 'contato_incorreto') return { icone: '🔍', label: `Contato incorreto — ${nome}`, cls: 'rs-alerta', nome, id };
  return { icone: '🔶', label: `Aguardando confirmação — ${nome}`, cls: 'rs-aguardando', nome, id }; // pendente/substituido/outros
}

function rsFmtData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function rsAbrirLocal(chave) { rsLocalAberto = chave; render(); }
function rsFecharLocal() { rsLocalAberto = null; render(); }

function rsCalcular() {
  const linhas = rsDados.secoes.map(s => {
    const cargos = RS_CARGOS.map(cargo => rsStatusCargo(rsDados.porSecao[s.id]?.[cargo]));
    const designados = cargos.filter(x => x.cls !== 'rs-sem').length;
    const confirmados = cargos.filter(x => x.cls === 'rs-ok').length;
    return { secao: s, cargos, designados, confirmados, atualizado: rsDados.atualizadoPorSecao[s.id] };
  });

  const porLocalMap = {};
  for (const l of linhas) {
    const chave = `${l.secao.local_nome || '(sem local)'}|||${l.secao.municipio || ''}`;
    if (!porLocalMap[chave]) porLocalMap[chave] = { chave, local_nome: l.secao.local_nome, municipio: l.secao.municipio, secoes: [] };
    porLocalMap[chave].secoes.push(l);
  }
  const porLocal = Object.values(porLocalMap).map(loc => {
    const totalCargos = loc.secoes.length * RS_CARGOS.length;
    const designados = loc.secoes.reduce((n, l) => n + l.designados, 0);
    const confirmados = loc.secoes.reduce((n, l) => n + l.confirmados, 0);
    const semNenhumNoLocal = loc.secoes.filter(l => l.designados === 0).length;
    // pct é sobre CONFIRMADOS, não designados (corrigido 20/08/2026 — achado
    // real em produção: uma seção com mesário na função mas nunca contactado
    // aparecia como "designado" e o local batia 100%/verde mesmo sem ninguém
    // confirmado, escondendo que a seção ainda precisava de trabalho).
    // "Designados" continua calculado e exibido à parte (ver rsCardLocal) —
    // é informação real, só não deve mais controlar a cor/barra de "pronto".
    const pct = totalCargos ? Math.round((confirmados / totalCargos) * 100) : 0;
    // Coordenador de Acessibilidade e Auxiliar de Eleição, separados
    // (21/08/2026) — antes existia um "temApoio" combinando os dois; as
    // pizzas novas mostram cada função à parte, cada uma com sua própria
    // vaga por local.
    const temCoord = loc.secoes.some(l => rsDados.secaoIdsPorFuncaoTodos.coord_acessibilidade.has(l.secao.id));
    const temCoordConfirmado = loc.secoes.some(l => rsDados.secaoIdsPorFuncaoConfirmado.coord_acessibilidade.has(l.secao.id));
    const temAuxiliar = loc.secoes.some(l => rsDados.secaoIdsPorFuncaoTodos.auxiliar_eleicao.has(l.secao.id));
    const temAuxiliarConfirmado = loc.secoes.some(l => rsDados.secaoIdsPorFuncaoConfirmado.auxiliar_eleicao.has(l.secao.id));
    return { ...loc, totalCargos, designados, confirmados, semNenhumNoLocal, pct, temCoord, temCoordConfirmado, temAuxiliar, temAuxiliarConfirmado };
  }).sort((a, b) => (a.local_nome || '').localeCompare(b.local_nome || ''));

  // Totais pros gráficos de pizza (nomeado x vazio, confirmado x total) —
  // MRV é por CARGO de mesa (4 por seção); apoio logístico não tem cargo
  // fixo, então "nomeado x vazio" vira "por local" (tem alguém designado
  // naquele prédio ou não), usando o mesmo agrupamento de porLocal.
  const mrvTotalCargos = linhas.length * RS_CARGOS.length;
  const mrvDesignados = linhas.reduce((n, l) => n + l.designados, 0);
  // Cargo-slot, não headcount — consistente com mrvDesignados/mrvTotalCargos
  // acima (rsDados.confirmadosMRV conta ATORES confirmados, não cargos; nas
  // pizzas novas de 3 fatias as 3 partes têm que somar mrvTotalCargos).
  const mrvConfirmadoCargos = linhas.reduce((n, l) => n + l.confirmados, 0);
  const locaisComCoord = porLocal.filter(l => l.temCoord).length;
  const locaisComCoordConfirmado = porLocal.filter(l => l.temCoordConfirmado).length;
  const locaisComAuxiliar = porLocal.filter(l => l.temAuxiliar).length;
  const locaisComAuxiliarConfirmado = porLocal.filter(l => l.temAuxiliarConfirmado).length;

  // Por MUNICÍPIO, não só por local de votação (pedido do cartório em
  // 21/08/2026: "saber por cidade e por função se já está com todas as
  // funções preenchidas e se já foi confirmado") — cada zona do SIME cobre
  // vários municípios (ex.: 7ª Zona = Campo Maior + Jatobá do Piauí +
  // Sigefredo Pacheco), e um local de votação sozinho não deixa ver esse
  // recorte. Agrega os mesmos números de porLocal (cargo-slot pra MRV, 1
  // vaga/local pra Coord./Auxiliar) por município, sem recalcular nada do
  // zero — porLocal já carrega .municipio em cada entrada.
  const porMunicipioMap = {};
  for (const loc of porLocal) {
    const chave = loc.municipio || '(sem município)';
    if (!porMunicipioMap[chave]) {
      porMunicipioMap[chave] = {
        municipio: chave, locais: 0,
        mrvTotalCargos: 0, mrvDesignados: 0, mrvConfirmados: 0,
        locaisComCoord: 0, locaisComCoordConfirmado: 0,
        locaisComAuxiliar: 0, locaisComAuxiliarConfirmado: 0,
      };
    }
    const m = porMunicipioMap[chave];
    m.locais++;
    m.mrvTotalCargos += loc.totalCargos;
    m.mrvDesignados += loc.designados;
    m.mrvConfirmados += loc.confirmados;
    if (loc.temCoord) m.locaisComCoord++;
    if (loc.temCoordConfirmado) m.locaisComCoordConfirmado++;
    if (loc.temAuxiliar) m.locaisComAuxiliar++;
    if (loc.temAuxiliarConfirmado) m.locaisComAuxiliarConfirmado++;
  }
  const porMunicipio = Object.values(porMunicipioMap).sort((a, b) => a.municipio.localeCompare(b.municipio));

  return {
    linhas, porLocal, mrvTotalCargos, mrvDesignados, mrvConfirmadoCargos,
    locaisComCoord, locaisComCoordConfirmado, locaisComAuxiliar, locaisComAuxiliarConfirmado,
    porMunicipio,
  };
}

// Donut de 3 fatias em SVG puro (sem lib de gráfico — projeto é sem
// framework), pedido do cartório em 21/08/2026 pra substituir o donut de 2
// fatias anterior: Confirmado / Convocado (designado, mas ainda não
// confirmado) / Vazio — as 3 somam sempre o Total do grupo (MRV, Coord. de
// Acessibilidade ou Auxiliar de Eleição). r=15.9155 é o truque clássico:
// 2*pi*r ≈ 100, então stroke-dasharray pode usar porcentagem direto. Cada
// fatia é um círculo rotacionado a partir de -90° (12h) pelo tanto que as
// fatias anteriores já ocuparam, então elas encaixam sem sobrepor.
function rsPizzaSVG3(valConfirmado, valConvocado, valVazio, corConfirmado, corConvocado, corVazio) {
  const total = valConfirmado + valConvocado + valVazio;
  const pctConf = total ? (valConfirmado / total) * 100 : 0;
  const pctConv = total ? (valConvocado / total) * 100 : 0;
  const pctVaz = total ? (valVazio / total) * 100 : 0;
  return `
    <svg width="72" height="72" viewBox="0 0 36 36" style="flex-shrink:0">
      <circle cx="18" cy="18" r="15.9155" fill="none" stroke="${corVazio}" stroke-width="4.5"
        stroke-dasharray="${pctVaz} ${100 - pctVaz}" transform="rotate(${-90 + (pctConf + pctConv) * 3.6} 18 18)"></circle>
      <circle cx="18" cy="18" r="15.9155" fill="none" stroke="${corConvocado}" stroke-width="4.5"
        stroke-dasharray="${pctConv} ${100 - pctConv}" transform="rotate(${-90 + pctConf * 3.6} 18 18)"></circle>
      <circle cx="18" cy="18" r="15.9155" fill="none" stroke="${corConfirmado}" stroke-width="4.5"
        stroke-dasharray="${pctConf} ${100 - pctConf}" transform="rotate(-90 18 18)"></circle>
      <text x="18" y="19" text-anchor="middle" dominant-baseline="middle" font-size="7" font-weight="900" fill="var(--text)">${Math.round(pctConf)}%</text>
    </svg>`;
}

const RS_COR_CONFIRMADO = 'var(--green)', RS_COR_CONVOCADO = 'var(--blue)', RS_COR_VAZIO = 'var(--border2)';

function rsPizzaCard3(titulo, valConfirmado, valConvocado, valVazio) {
  const total = valConfirmado + valConvocado + valVazio;
  return `
    <div class="import-card" style="padding:12px 14px;display:flex;align-items:center;gap:10px">
      ${rsPizzaSVG3(valConfirmado, valConvocado, valVazio, RS_COR_CONFIRMADO, RS_COR_CONVOCADO, RS_COR_VAZIO)}
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:.76rem;margin-bottom:6px">${titulo}</div>
        <div style="font-size:.72rem;color:var(--text2);display:flex;align-items:center;gap:6px;margin-bottom:2px">
          <span style="width:9px;height:9px;border-radius:2px;background:${RS_COR_CONFIRMADO};display:inline-block;flex-shrink:0"></span>
          Confirmado: <b style="color:var(--text)">${valConfirmado}</b>
        </div>
        <div style="font-size:.72rem;color:var(--text2);display:flex;align-items:center;gap:6px;margin-bottom:2px">
          <span style="width:9px;height:9px;border-radius:2px;background:${RS_COR_CONVOCADO};display:inline-block;flex-shrink:0"></span>
          Convocado: <b style="color:var(--text)">${valConvocado}</b>
        </div>
        <div style="font-size:.72rem;color:var(--text2);display:flex;align-items:center;gap:6px">
          <span style="width:9px;height:9px;border-radius:2px;background:${RS_COR_VAZIO};display:inline-block;flex-shrink:0"></span>
          Vazio: <b style="color:var(--text)">${valVazio}</b>
        </div>
        <div style="font-size:.68rem;color:var(--text3);margin-top:4px">Total: ${total}</div>
      </div>
    </div>`;
}

// Barra horizontal única resumindo a zona inteira (MRV + Coord. de
// Acessibilidade + Auxiliar de Eleição juntos), pedido do cartório em
// 21/08/2026 pra sentar em cima das 3 pizzas: 3 estágios sobrepostos na
// MESMA faixa (não 3 barras separadas) — Total de vagas é a faixa de fundo
// (cor A), Convocados é uma barra mais curta por cima (cor B), Confirmados
// é a mais curta de todas por cima dessa (cor C). Cada estágio é subconjunto
// do anterior (confirmado ⊆ convocado ⊆ total), por isso dá pra sobrepor
// em vez de empilhar em 3 faixas.
function rsBarraFunil(total, convocados, confirmados) {
  const corTotal = 'var(--border2)', corConvocado = RS_COR_CONVOCADO, corConfirmado = RS_COR_CONFIRMADO;
  const pctConv = total ? Math.min(100, (convocados / total) * 100) : 0;
  const pctConf = total ? Math.min(100, (confirmados / total) * 100) : 0;
  return `
    <div class="import-card" style="padding:14px 16px">
      <div style="font-weight:800;font-size:.8rem;margin-bottom:10px">📊 Progresso geral da zona — MRV + Coordenadores de Acessibilidade + Auxiliares de Eleição</div>
      <div style="position:relative;height:22px;border-radius:11px;background:${corTotal};overflow:hidden">
        <div style="position:absolute;inset:0;height:100%;width:${pctConv}%;background:${corConvocado};border-radius:11px"></div>
        <div style="position:absolute;inset:0;height:100%;width:${pctConf}%;background:${corConfirmado};border-radius:11px"></div>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:.74rem">
        <div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:${corTotal};display:inline-block;flex-shrink:0"></span>Total de vagas: <b>${total}</b></div>
        <div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:${corConvocado};display:inline-block;flex-shrink:0"></span>Convocados: <b>${convocados}</b></div>
        <div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:${corConfirmado};display:inline-block;flex-shrink:0"></span>Confirmados: <b>${confirmados}</b></div>
      </div>
    </div>`;
}

// "Preenchido" = tem alguém designado pra vaga (confirmado ou não);
// "confirmado" = quem está designado já confirmou. As duas coisas são
// perguntas DIFERENTES que o cartório faz ("já tem gente pra todo cargo?"
// vs "essa gente já confirmou?"), por isso cada função de grupo mostra as
// duas contagens lado a lado, não uma só.
function rsSituacaoMunicipio(m) {
  const mrvPreenchido = m.mrvTotalCargos > 0 && m.mrvDesignados === m.mrvTotalCargos;
  const mrvConfirmado = m.mrvTotalCargos > 0 && m.mrvConfirmados === m.mrvTotalCargos;
  const coordPreenchido = m.locais > 0 && m.locaisComCoord === m.locais;
  const coordConfirmado = m.locais > 0 && m.locaisComCoordConfirmado === m.locais;
  const auxPreenchido = m.locais > 0 && m.locaisComAuxiliar === m.locais;
  const auxConfirmado = m.locais > 0 && m.locaisComAuxiliarConfirmado === m.locais;
  const tudoConfirmado = mrvConfirmado && coordConfirmado && auxConfirmado;
  const tudoPreenchido = mrvPreenchido && coordPreenchido && auxPreenchido;
  return { mrvPreenchido, mrvConfirmado, coordPreenchido, coordConfirmado, auxPreenchido, auxConfirmado, tudoConfirmado, tudoPreenchido };
}

// "X/Y confirmados" + nota "(Z preenchidos)" só quando confirmado < preenchido
// — mesmo padrão de rsCardLocal (designados só aparece quando diverge de
// confirmados, pra não repetir o mesmo número duas vezes à toa).
function rsCelulaGrupo(confirmados, preenchidos, total) {
  const cor = total === 0 ? 'var(--text3)' : confirmados === total ? 'var(--green)' : preenchidos === 0 ? 'var(--red)' : 'var(--text)';
  return `<span style="color:${cor};font-weight:700">${confirmados}/${total}</span>${preenchidos !== confirmados ? ` <span style="color:var(--text3);font-size:.9em">(${preenchidos} pr.)</span>` : ''}`;
}

function rsTabelaMunicipios(porMunicipio) {
  if (!porMunicipio.length) return '';
  // Fechada por padrão (21/08/2026, ver rsMunicipiosAberto) — cabeçalho
  // clicável tipo "▸/▾", mesmo padrão de disclosure já usado noutras telas
  // do SIME. O corpo (tabela) só entra no HTML quando aberta — não só
  // escondido por CSS — pra não pesar o Dashboard com uma tabela grande
  // toda vez que ele carrega.
  return `
    <div class="import-card">
      <div class="ic-title" style="cursor:pointer;display:flex;align-items:center;gap:6px" onclick="rsToggleMunicipios()">
        <span>${rsMunicipiosAberto ? '▾' : '▸'}</span> 🏘️ Progresso por município e função
      </div>
      ${rsMunicipiosAberto ? `
      <div class="ic-sub">Vagas de MRV são por cargo de mesa (4 por seção); Coordenador de Acessibilidade e
        Auxiliar de Eleição são 1 por local de votação. "pr." = preenchido (tem alguém designado, confirmado ou não).</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.82rem">
          <thead>
            <tr style="text-align:left;border-bottom:1px solid var(--border2)">
              <th style="padding:6px 8px">Município</th>
              <th style="padding:6px 8px">MRV</th>
              <th style="padding:6px 8px">Coord. Acessibilidade</th>
              <th style="padding:6px 8px">Auxiliar de Eleição</th>
              <th style="padding:6px 8px">Situação</th>
            </tr>
          </thead>
          <tbody>
            ${porMunicipio.map(m => {
              const s = rsSituacaoMunicipio(m);
              const situacao = s.tudoConfirmado ? '✅ Tudo confirmado' : s.tudoPreenchido ? '🔶 Preenchido, falta confirmar' : '❌ Ainda falta preencher';
              return `
              <tr style="border-bottom:1px solid var(--border2)">
                <td style="padding:6px 8px;font-weight:700">${rsEsc(m.municipio)}</td>
                <td style="padding:6px 8px">${rsCelulaGrupo(m.mrvConfirmados, m.mrvDesignados, m.mrvTotalCargos)}</td>
                <td style="padding:6px 8px">${rsCelulaGrupo(m.locaisComCoordConfirmado, m.locaisComCoord, m.locais)}</td>
                <td style="padding:6px 8px">${rsCelulaGrupo(m.locaisComAuxiliarConfirmado, m.locaisComAuxiliar, m.locais)}</td>
                <td style="padding:6px 8px">${situacao}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : ''}
    </div>`;
}

function rsBarraCor(pct) {
  if (pct === 0) return 'var(--red)';
  if (pct >= 100) return 'var(--green)';
  return 'var(--blue)';
}

function rsCardLocal(loc) {
  const cor = rsBarraCor(loc.pct);
  return `
    <div class="import-card" style="cursor:pointer;padding:14px 16px" onclick="rsAbrirLocal('${loc.chave.replace(/'/g, "\\'")}')">
      <div style="font-weight:800;font-size:.86rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${loc.local_nome || '(sem local)'}">${loc.local_nome || '(sem local)'}</div>
      <div class="ic-sub" style="margin-bottom:8px;display:flex;align-items:center;gap:4px">📍 ${loc.municipio || ''}</div>
      <div style="display:flex;justify-content:space-between;font-size:.76rem;color:var(--text2);margin-bottom:4px">
        <span>Seções<br><b style="color:var(--text);font-size:.9rem">${String(loc.secoes.length).padStart(2, '0')}</b></span>
        <span style="text-align:right">Confirmados<br><b style="color:var(--text);font-size:.9rem">${loc.confirmados}/${loc.totalCargos}</b></span>
      </div>
      ${loc.designados !== loc.confirmados ? `<div class="ic-sub" style="margin-bottom:4px">${loc.designados}/${loc.totalCargos} designados (nem todos confirmaram)</div>` : ''}
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <div style="flex:1;height:6px;border-radius:99px;background:var(--bg2);overflow:hidden">
          <div style="height:100%;width:${Math.min(loc.pct, 100)}%;background:${cor};border-radius:99px"></div>
        </div>
        <span style="font-size:.72rem;font-weight:700;color:${cor};white-space:nowrap">${loc.pct}%</span>
      </div>
    </div>`;
}

function rsLinhaLocal(loc) {
  const cor = rsBarraCor(loc.pct);
  return `
    <div class="import-card" style="cursor:pointer;padding:10px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap" onclick="rsAbrirLocal('${loc.chave.replace(/'/g, "\\'")}')">
      <div style="flex:1;min-width:160px">
        <div style="font-weight:800;font-size:.84rem">${loc.local_nome || '(sem local)'}</div>
        <div class="ic-sub" style="margin-bottom:0">📍 ${loc.municipio || ''}</div>
      </div>
      <div style="font-size:.76rem;color:var(--text2);white-space:nowrap">Seções: <b style="color:var(--text)">${loc.secoes.length}</b></div>
      <div style="font-size:.76rem;color:var(--text2);white-space:nowrap">Confirmados: <b style="color:var(--text)">${loc.confirmados}/${loc.totalCargos}</b>${loc.designados !== loc.confirmados ? ` <span style="color:var(--text3)">(${loc.designados} designados)</span>` : ''}</div>
      <div style="display:flex;align-items:center;gap:8px;width:140px">
        <div style="flex:1;height:6px;border-radius:99px;background:var(--bg2);overflow:hidden">
          <div style="height:100%;width:${Math.min(loc.pct, 100)}%;background:${cor};border-radius:99px"></div>
        </div>
        <span style="font-size:.72rem;font-weight:700;color:${cor}">${loc.pct}%</span>
      </div>
    </div>`;
}

function rsCardSecao(l) {
  return `
    <div class="import-card" style="padding:14px 16px;border-left:4px solid ${l.confirmados === 4 ? 'var(--green)' : l.designados === 0 ? 'var(--red)' : 'var(--blue)'}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div>
          <div style="font-size:1.6rem;font-weight:900">Seção ${l.secao.numero}</div>
          <div class="ic-sub" style="margin-bottom:0">${l.secao.eleitores ?? '—'} eleitores</div>
        </div>
      </div>
      <div style="display:flex;gap:14px;margin-top:10px;flex-wrap:wrap">
        ${l.cargos.map((cg, i) => `
          <div style="text-align:center;max-width:78px${cg.id ? ';cursor:pointer' : ''}" title="${rsEsc(cg.label)}${cg.id ? ' — clique pra ver tentativas de contato' : ''}"${cg.id ? ` onclick="event.stopPropagation();cmAbrirModal('${cg.id}')"` : ''}>
            <div style="font-size:1.1rem">${cg.icone}</div>
            <div style="font-size:.68rem;color:var(--text2);margin-top:2px">${RS_CARGOS[i]}</div>
            ${cg.nome ? `<div style="font-size:.66rem;color:${cg.id ? 'var(--blue)' : 'var(--text3)'};margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${cg.id ? 'text-decoration:underline' : ''}">${rsEsc(cg.nome.split(' ')[0])}</div>` : ''}
          </div>`).join('')}
      </div>
      <div class="ic-sub" style="margin-top:10px;margin-bottom:0">Atualizado em ${rsFmtData(l.atualizado)}</div>
    </div>`;
}

function renderResumoSecoes() {
  const c = document.getElementById('content');
  if (!window.supabaseAtores) {
    c.innerHTML = '<div class="import-card"><div class="import-result ir-warn">Entre com a conta da equipe pra ver o dashboard.</div></div>';
    return;
  }
  if (!rsDados) {
    c.innerHTML = '<div class="import-card"><div class="ic-title">📊 Dashboard</div><div class="ic-sub">Carregando…</div></div>';
    rsCarregar();
    return;
  }
  if (rsDados.erro) {
    c.innerHTML = `<div class="import-card"><div class="import-result ir-warn">⚠ ${rsDados.erro}</div></div>`;
    return;
  }

  const {
    linhas, porLocal, mrvTotalCargos, mrvDesignados, mrvConfirmadoCargos,
    locaisComCoord, locaisComCoordConfirmado, locaisComAuxiliar, locaisComAuxiliarConfirmado,
    porMunicipio,
  } = rsCalcular();

  // Redesenhado em 21/08/2026 a pedido do cartório: 3 pizzas (MRV / Coord.
  // de Acessibilidade / Auxiliar de Eleição), cada uma com 3 fatias que
  // somam o Total daquele grupo — Confirmado / Convocado (designado, ainda
  // não confirmado) / Vazio — em vez do desenho anterior de 4 pizzas de 2
  // fatias (nomeado x vazio, separado de confirmado x total). MRV é "vaga"
  // por CARGO de mesa (4 por seção); Coord. de Acessibilidade e Auxiliar de
  // Eleição não têm cargo fixo no schema, então a "vaga" vira 1 por LOCAL de
  // votação (mesma premissa que já existia no desenho anterior, agora
  // separada por função em vez de combinada num "apoio logístico" só).
  const locaisTotal = porLocal.length;
  const pizzasHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
      ${rsPizzaCard3('MRV (Mesários)', mrvConfirmadoCargos, mrvDesignados - mrvConfirmadoCargos, mrvTotalCargos - mrvDesignados)}
      ${rsPizzaCard3('Coordenadores de Acessibilidade', locaisComCoordConfirmado, locaisComCoord - locaisComCoordConfirmado, locaisTotal - locaisComCoord)}
      ${rsPizzaCard3('Auxiliares de Eleição (apoio logístico)', locaisComAuxiliarConfirmado, locaisComAuxiliar - locaisComAuxiliarConfirmado, locaisTotal - locaisComAuxiliar)}
    </div>`;

  // Barra-resumo da zona inteira (21/08/2026), acima das 3 pizzas — soma os
  // 3 grupos num só "funil": Total de vagas (MRV + 1 por local pra cada uma
  // das outras duas funções) → Convocados → Confirmados.
  const funilTotal = mrvTotalCargos + locaisTotal * 2;
  const funilConvocados = mrvDesignados + locaisComCoord + locaisComAuxiliar;
  const funilConfirmados = mrvConfirmadoCargos + locaisComCoordConfirmado + locaisComAuxiliarConfirmado;
  const funilHTML = rsBarraFunil(funilTotal, funilConvocados, funilConfirmados);

  const statsHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
      <div class="import-card" style="border-left:4px solid #2e7d32;padding:14px 16px">
        <div class="ic-sub" style="margin-bottom:2px">Locais de votação</div>
        <div style="font-size:1.6rem;font-weight:900">${porLocal.length}</div>
      </div>
      <div class="import-card" style="border-left:4px solid #1565c0;padding:14px 16px">
        <div class="ic-sub" style="margin-bottom:2px">Seções</div>
        <div style="font-size:1.6rem;font-weight:900">${linhas.length}</div>
      </div>
      <div class="import-card" style="border-left:4px solid #e65100;padding:14px 16px">
        <div class="ic-sub" style="margin-bottom:2px">Mesários (MRV)</div>
        <div style="font-size:1.6rem;font-weight:900">${rsDados.confirmadosMRV}<span style="font-size:1rem;color:var(--text3)">/${rsDados.totalMesarios}</span></div>
        <div class="ic-sub" style="margin-bottom:0;margin-top:2px">✅ confirmados · ${rsDados.totalMesarios - rsDados.confirmadosMRV} falta${rsDados.totalMesarios - rsDados.confirmadosMRV === 1 ? '' : 'm'} confirmar</div>
      </div>
      <div class="import-card" style="border-left:4px solid #6a1b9a;padding:14px 16px">
        <div class="ic-sub" style="margin-bottom:2px">Apoio logístico (AL)</div>
        <div style="font-size:1.6rem;font-weight:900">${rsDados.confirmadosApoio}<span style="font-size:1rem;color:var(--text3)">/${rsDados.totalApoio}</span></div>
        <div class="ic-sub" style="margin-bottom:0;margin-top:2px">✅ confirmados · ${rsDados.totalApoio - rsDados.confirmadosApoio} falta${rsDados.totalApoio - rsDados.confirmadosApoio === 1 ? '' : 'm'} confirmar</div>
      </div>
    </div>`;

  // ── Drilldown de um local: seções daquele local, com os 4 cargos ──
  if (rsLocalAberto) {
    const loc = porLocal.find(l => l.chave === rsLocalAberto);
    if (!loc) { rsLocalAberto = null; } else {
      c.innerHTML = `
        ${statsHTML}
        <div class="import-card" style="padding:12px 16px;display:flex;align-items:center;gap:10px">
          <button class="btn btn-out" style="padding:6px 12px;font-size:.76rem" onclick="rsFecharLocal()">← Voltar</button>
          <div>
            <div style="font-weight:800">${loc.local_nome || '(sem local)'}</div>
            <div class="ic-sub" style="margin-bottom:0">📍 ${loc.municipio || ''} — ${loc.secoes.length} seção(ões), ${loc.designados}/${loc.totalCargos} cargos designados</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
          ${loc.secoes.map(rsCardSecao).join('')}
        </div>`;
      return;
    }
  }

  // ── Grade/lista de locais de votação ──
  const q = rsBusca.trim().toLowerCase();
  const filtrados = q ? porLocal.filter(l => (l.local_nome || '').toLowerCase().includes(q) || (l.municipio || '').toLowerCase().includes(q)) : porLocal;
  const semNenhum = linhas.filter(l => l.designados === 0).length;
  const completas = linhas.filter(l => l.confirmados === 4).length;

  c.innerHTML = `
    ${funilHTML}
    ${rsTabelaMunicipios(porMunicipio)}
    ${pizzasHTML}
    ${statsHTML}
    <div class="import-card" style="padding:12px 16px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <input type="text" placeholder="🔍 Pesquisar local de votação…" value="${rsBusca.replace(/"/g, '&quot;')}" oninput="rsBusca=this.value;render()" style="flex:1;min-width:200px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
        <div style="display:flex;gap:4px">
          <button class="btn ${rsModo === 'grade' ? 'btn-dark' : 'btn-out'}" style="padding:7px 10px;font-size:.76rem" onclick="rsModo='grade';render()" aria-label="Ver em grade" aria-pressed="${rsModo === 'grade'}">▦</button>
          <button class="btn ${rsModo === 'lista' ? 'btn-dark' : 'btn-out'}" style="padding:7px 10px;font-size:.76rem" onclick="rsModo='lista';render()" aria-label="Ver em lista" aria-pressed="${rsModo === 'lista'}">☰</button>
        </div>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:.78rem;margin-top:10px">
        <div style="${semNenhum > 0 ? 'color:var(--red);font-weight:700' : 'color:var(--text2)'}">${semNenhum} seção(ões) sem nenhum cargo designado</div>
        <div style="color:var(--text2)">${completas} seção(ões) com mesa completa confirmada</div>
      </div>
    </div>
    ${filtrados.length ? (
      rsModo === 'grade'
        ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px">${filtrados.map(rsCardLocal).join('')}</div>`
        : `<div style="display:flex;flex-direction:column;gap:8px">${filtrados.map(rsLinhaLocal).join('')}</div>`
    ) : '<div class="import-card"><div class="ic-sub" style="margin-bottom:0">Nenhum local encontrado com essa busca.</div></div>'}`;
}
