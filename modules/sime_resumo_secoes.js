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
// Filtro por situação dos LOCAIS de votação (pedido direto, 01/09/2026: "um
// filtro para mostrar seções todas confirmadas, seções com vagas e seções
// com mesários pendentes"). Aplicado sobre `porLocal` (mesmo nível da busca
// e da grade/lista) — um local "tem vaga" se pelo menos um cargo de mesa,
// em qualquer seção dele, ainda não tem ninguém designado; "tem pendente" se
// pelo menos um cargo tem alguém designado mas ainda não confirmou. As duas
// condições não são mutuamente exclusivas (um local pode ter os dois ao
// mesmo tempo) — o filtro é uma lente por vez, não uma categorização única.
let rsFiltroStatus = 'todos'; // 'todos' | 'confirmadas' | 'vagas' | 'pendentes'
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

  const [{ data: secoes, error: e1 }, { data: atores, error: e2 }, { data: apoio, error: e3 }, { data: voluntarios, error: e4 }] = await Promise.all([
    sb.from('sime_secoes').select('id, numero, municipio, local_nome, eleitores').eq('zona_id', zonaId).eq('ativo', true).order('numero'),
    // inscricao_eleitoral junto (01/09/2026, pedido direto: "um mesário
    // nunca pode ser coordenador de acessibilidade e membro da mesa ao
    // mesmo tempo") — é a chave usada pra cruzar com o apoio logístico e
    // achar esse conflito (mesma pessoa, dois papéis).
    // meio_contato junto (01/09/2026, pedido direto: ícone do cargo muda
    // conforme o meio de contato quando ainda não confirmou — carta, oficial
    // de justiça ou ligação, ver rsStatusCargo).
    sb.from('sime_atores').select('id, nome_completo, secao_id, funcao_mesa, confirmacao, precisa_substituir, data_confirmacao, inscricao_eleitoral, meio_contato').eq('zona_id', zonaId).eq('funcao', 'mesario').eq('ativo', true),
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
    // nome_completo/precisa_substituir junto (01/09/2026, pedido direto:
    // "no dashboard abaixo do nome pode indicar o nome do coordenador de
    // acessibilidade designado?") — antes só dava pra saber SE tinha alguém
    // (pra pizza/vaga por local), não QUEM era, porque o select não trazia
    // esses dois campos.
    sb.from('sime_atores').select('id, nome_completo, confirmacao, secao_id, funcao, precisa_substituir, inscricao_eleitoral, meio_contato').eq('zona_id', zonaId).eq('ativo', true).in('funcao', ['coord_acessibilidade', 'auxiliar_eleicao']),
    // Fila de voluntários disponíveis (28/08/2026, pedido direto: "se
    // aparecer seção incompleta e/ou marcado para substituição indicar quem
    // deve ocupar a vaga, deve vir por ordem de cadastro") — já vem ordenada
    // por created_at ascendente (quem se cadastrou primeiro é sugerido
    // primeiro), pra rsProximoVoluntario() só pegar o primeiro que casar.
    sb.from('sime_voluntarios').select('id, nome, telefone_whatsapp, funcoes, municipio, local_votacao, created_at').eq('zona_id', zonaId).eq('ativo', true).eq('status', 'disponivel').order('created_at', { ascending: true }),
  ]);
  if (e1 || e2 || e3 || e4) { rsDados = { erro: (e1 || e2 || e3 || e4).message }; render(); return; }

  const secoesPorId = Object.fromEntries((secoes || []).map(s => [s.id, s]));

  // Conflito: mesário e Coordenador de Acessibilidade não podem ser a mesma
  // pessoa ao mesmo tempo (01/09/2026, pedido direto) — achado real
  // cruzando por título de eleitor: já existem casos assim na 7ª Zona (duas
  // pessoas confirmadas nos dois papéis, em seções diferentes, ao mesmo
  // tempo). Cada mapa guarda só o PRIMEIRO achado por pessoa — suficiente
  // pra avisar "também está no outro papel", sem precisar listar todos.
  const mesarioPorInscricao = {};
  for (const a of atores || []) {
    if (!a.inscricao_eleitoral || !a.funcao_mesa || mesarioPorInscricao[a.inscricao_eleitoral]) continue;
    const sec = a.secao_id ? secoesPorId[a.secao_id] : null;
    mesarioPorInscricao[a.inscricao_eleitoral] = { funcao_mesa: a.funcao_mesa, secaoNumero: sec?.numero };
  }
  const coordPorInscricao = {};
  for (const a of apoio || []) {
    if (a.funcao !== 'coord_acessibilidade' || !a.inscricao_eleitoral || coordPorInscricao[a.inscricao_eleitoral]) continue;
    const sec = a.secao_id ? secoesPorId[a.secao_id] : null;
    coordPorInscricao[a.inscricao_eleitoral] = { secaoNumero: sec?.numero };
  }

  // Por local, quem tem alguém designado/confirmado de CADA função de apoio
  // separadamente — 1 vaga por local pra cada uma (mesma premissa já usada
  // pro bucket combinado: nem coordenador de acessibilidade nem auxiliar de
  // eleição têm cargo fixo no schema, então a "vaga" é por prédio).
  const secaoIdsPorFuncaoTodos = { coord_acessibilidade: new Set(), auxiliar_eleicao: new Set() };
  const secaoIdsPorFuncaoConfirmado = { coord_acessibilidade: new Set(), auxiliar_eleicao: new Set() };
  // Quem exatamente está designado como Coordenador de Acessibilidade em
  // cada seção (não só "tem alguém ou não", como os Sets acima já davam) —
  // pra mostrar o nome no drilldown do local, mesmo critério de prioridade
  // já usado pra mesário (confirmado > convocado/pendente > recusou/etc.).
  const coordPorSecao = {};
  const prioridadeApoio = { confirmado: 3, convocado: 2, pendente: 2, substituido: 1, recusou: 1, contato_incorreto: 1 };
  for (const a of apoio || []) {
    if (!a.secao_id || !secaoIdsPorFuncaoTodos[a.funcao]) continue;
    secaoIdsPorFuncaoTodos[a.funcao].add(a.secao_id);
    if (a.confirmacao === 'confirmado') secaoIdsPorFuncaoConfirmado[a.funcao].add(a.secao_id);
    if (a.funcao === 'coord_acessibilidade') {
      const atual = coordPorSecao[a.secao_id];
      if (!atual || (prioridadeApoio[a.confirmacao] || 0) >= (prioridadeApoio[atual.confirmacao] || 0)) {
        coordPorSecao[a.secao_id] = a;
      }
    }
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
    const prioridade = { confirmado: 3, convocado: 2, pendente: 2, substituido: 1, recusou: 1, contato_incorreto: 1 };
    if (!atual || (prioridade[a.confirmacao] || 0) >= (prioridade[atual.confirmacao] || 0)) {
      porSecao[a.secao_id][a.funcao_mesa] = a;
    }
    if (a.data_confirmacao && (!atualizadoPorSecao[a.secao_id] || a.data_confirmacao > atualizadoPorSecao[a.secao_id])) {
      atualizadoPorSecao[a.secao_id] = a.data_confirmacao;
    }
  }
  // Contagem simples de Auxiliar de Eleição, por PESSOA — não por local
  // (22/08/2026, achado real: o TRE nunca traz o código do local pra essa
  // função específica, então "locaisComAuxiliar" fica sempre 0/vazio, por
  // mais gente cadastrada e confirmada que exista — ver CLAUDE.md
  // "Coordenador de Acessibilidade e Auxiliar de Eleição entravam SEMPRE
  // sem secao_id". Diferente de Coordenador de Acessibilidade, que tem uma
  // ponte de local funcionando pra maioria dos registros — aqui não há
  // dado nenhum pra apoiar um agrupamento por local, então a pizza usa
  // headcount direto: "auxiliar_eleicao é todo AL que não é coordenador"
  // (regra já aplicada no sync, sql/SIME_schema.sql).
  const auxiliarTotal = (apoio || []).filter(a => a.funcao === 'auxiliar_eleicao').length;
  const auxiliarConfirmado = (apoio || []).filter(a => a.funcao === 'auxiliar_eleicao' && a.confirmacao === 'confirmado').length;

  rsDados = {
    secoes: secoes || [], porSecao, atualizadoPorSecao,
    totalMesarios: (atores || []).length, totalApoio: (apoio || []).length,
    confirmadosMRV: (atores || []).filter(a => a.confirmacao === 'confirmado').length,
    confirmadosApoio: (apoio || []).filter(a => a.confirmacao === 'confirmado').length,
    auxiliarTotal, auxiliarConfirmado,
    secaoIdsPorFuncaoTodos, secaoIdsPorFuncaoConfirmado, coordPorSecao,
    mesarioPorInscricao, coordPorInscricao,
    voluntarios: voluntarios || [],
  };
  render();
}

// Primeiro voluntário DISPONÍVEL que topa trabalhar como mesário (MRV) nessa
// seção — lista já vem ordenada por created_at ascendente (ver rsCarregar),
// então o primeiro que casar é literalmente quem se cadastrou há mais tempo
// (fila por ordem de cadastro, não por sorteio nem por proximidade). município/
// local_votacao vazios no cadastro do voluntário = "topo qualquer lugar",
// então casam com qualquer seção — mesma regra de "qualquer" já usada no
// resto do cadastro de voluntários (vlBadgeFuncoes/vlBadgeLocal).
function rsVoluntariosDisponiveis(municipio, localNome) {
  const lista = rsDados.voluntarios || [];
  return lista.filter(v =>
    (!v.funcoes || !v.funcoes.length || v.funcoes.includes('mesario')) &&
    (!v.municipio || v.municipio === municipio) &&
    (!v.local_votacao || v.local_votacao === localNome)
  );
}
function rsProximoVoluntario(municipio, localNome) {
  return rsVoluntariosDisponiveis(municipio, localNome)[0] || null;
}

// Escapa pra uso dentro de uma string JS de aspas simples num atributo
// onclick="..." (contexto diferente de rsEsc, que escapa pra texto/atributo
// HTML) — nomes de local têm apóstrofo de verdade (ex.: "Salão Com. 'Mario
// Cazuza'"), então sem isso o onclick quebraria no meio do próprio HTML.
function rsJsStr(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// "ao clicar em cima da função vazia poderia aparecer os voluntários
// disponíveis" (31/08/2026, pedido direto) — antes a sugestão (🙋) era só
// informativa, sem clique, e mostrava só o PRIMEIRO da fila. Clicar no
// cargo vazio agora abre a lista inteira de voluntários que casam (função +
// local), na mesma ordem de fila (cadastro mais antigo primeiro) — só
// leitura/contato (WhatsApp), não designa ninguém sozinho: designar
// continua sendo feito manualmente pelas telas de sempre.
function rsAbrirVoluntarios(municipio, localNome, cargoLabel) {
  const lista = rsVoluntariosDisponiveis(municipio, localNome);
  document.getElementById('overlay').classList.add('open');
  document.getElementById('modal-body').innerHTML = `
    <div class="m-hdr">
      <div class="m-title">🙋 Voluntários disponíveis — ${rsEsc(cargoLabel)}</div>
      <button class="close-btn" aria-label="Fechar" onclick="rsFecharModal()">✕</button>
    </div>
    <div class="m-body">
      <div class="ic-sub">Vaga em ${rsEsc(localNome || '—')}${municipio ? `, ${rsEsc(municipio)}` : ''} — por ordem de cadastro. Só mostra quem já topou trabalhar; designar continua manual, pelas telas de sempre.</div>
      ${lista.length ? `<div class="m-hist">${lista.map((v, i) => `
        <div class="m-hist-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div><b>${i + 1}º</b> ${rsEsc(v.nome)}${!v.funcoes || !v.funcoes.length ? ' <span style="color:var(--text2);font-size:.68rem">(qualquer função)</span>' : ''}${!v.municipio ? ' <span style="color:var(--text2);font-size:.68rem">(qualquer local)</span>' : ''}</div>
          ${v.telefone_whatsapp && linkWhatsApp(v.telefone_whatsapp) ? `<a href="${linkWhatsApp(v.telefone_whatsapp)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : '<span style="color:var(--text2);font-size:.7rem">sem telefone</span>'}
        </div>`).join('')}</div>` : '<div class="ic-sub" style="margin-bottom:0">Nenhum voluntário disponível pra esse local no momento.</div>'}
    </div>`;
}
function rsFecharModal(e) {
  if (!e || e.target === document.getElementById('overlay')) {
    document.getElementById('overlay')?.classList.remove('open');
  }
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
  if (ator.confirmacao === 'convocado') return { icone: '📋', label: `Convocado, aguardando confirmação — ${nome}`, cls: 'rs-aguardando', nome, id };
  if (ator.confirmacao === 'recusou') return { icone: '⚠️', label: `Recusou — precisa substituto — ${nome}`, cls: 'rs-alerta', nome, id };
  if (ator.confirmacao === 'contato_incorreto') return { icone: '🔍', label: `Contato incorreto — ${nome}`, cls: 'rs-alerta', nome, id };
  // pendente/substituido/outros — ainda não confirmou. O losango 🔶
  // continua sendo o padrão (WhatsApp/sem meio definido); quando o meio de
  // contato é outro, o ícone passa a refletir isso (01/09/2026, pedido
  // direto: "mude o icone se for ainda não confirmado permanece o losango,
  // se mudar para carta de convocação mude o icone para uma carta, se for
  // oficial de justiça mude o icone para um policial..., se for contato
  // telefonico mude o [ícone] para um telefone") — só essa faixa muda; as
  // demais (✅/📋/⚠️/🔍/🔁 acima) continuam com o ícone de sempre, mesmo se
  // o meio de contato também estiver marcado.
  const RS_ICONE_POR_MEIO = { carta_registrada: '✉️', oficial_justica: '👮', ligacao: '📞', zeo: '🏛️' };
  const RS_MEIO_SUFIXO = { carta_registrada: ' (Carta Registrada)', oficial_justica: ' (Oficial de Justiça)', ligacao: ' (Ligação telefônica)', zeo: ' (ZEO/TRE)' };
  const icone = RS_ICONE_POR_MEIO[ator.meio_contato] || '🔶';
  const sufixo = RS_MEIO_SUFIXO[ator.meio_contato] || '';
  return { icone, label: `Aguardando confirmação${sufixo} — ${nome}`, cls: 'rs-aguardando', nome, id };
}

// Conflito de papel — mesário e Coordenador de Acessibilidade não podem ser
// a mesma pessoa ao mesmo tempo (01/09/2026, pedido direto: "um mesário
// nunca pode ser coordenador de acessibilidade e membro da mesa ao mesmo
// tempo") — na prática, um exige ficar fixo na própria seção o dia todo, o
// outro exige circular pelas seções do local ajudando eleitor com
// deficiência; ninguém faz os dois ao mesmo tempo. As duas funções abaixo
// checam nos dois sentidos, sempre por título de eleitor (mesma pessoa),
// usando os mapas montados em rsCarregar (mesarioPorInscricao/
// coordPorInscricao). Não bloqueia nada — só avisa, pro cartório resolver
// manualmente (mesmo critério "não adivinha" de sempre: o SIME não decide
// sozinho qual dos dois papéis a pessoa deveria manter).
function rsConflitoMesarioComoCoord(ator) {
  if (!ator?.inscricao_eleitoral) return null;
  return rsDados?.coordPorInscricao?.[ator.inscricao_eleitoral] || null;
}
function rsConflitoCoordComoMesario(coordAtor) {
  if (!coordAtor?.inscricao_eleitoral) return null;
  return rsDados?.mesarioPorInscricao?.[coordAtor.inscricao_eleitoral] || null;
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
    const cargos = RS_CARGOS.map(cargo => {
      const ator = rsDados.porSecao[s.id]?.[cargo];
      const st = rsStatusCargo(ator);
      st.conflito = rsConflitoMesarioComoCoord(ator);
      return st;
    });
    // Sugestão de quem deve ocupar a vaga (28/08/2026) — só quando o cargo
    // está mesmo em aberto: sem ninguém designado (❌) ou com alguém marcado
    // pra ser substituído (🔁). Confirmado/convocado/aguardando resposta não
    // precisam de sugestão — a vaga já está (ou está a caminho de estar)
    // ocupada.
    for (const cg of cargos) {
      if (cg.cls === 'rs-sem' || cg.icone === '🔁') {
        const sug = rsProximoVoluntario(s.municipio, s.local_nome);
        if (sug) { cg.sugestaoNome = sug.nome; cg.sugestaoId = sug.id; }
      }
    }
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
    // Quem exatamente é o Coordenador de Acessibilidade do local (01/09/2026,
    // pedido direto: "no dashboard abaixo do nome pode indicar o nome do
    // coordenador de acessibilidade designado?") — dedupe por id, já que
    // mais de uma seção do mesmo local aponta pro mesmo `coordPorSecao` só
    // quando é literalmente a mesma pessoa (vaga é por local, não por seção).
    const coordenadoresMap = {};
    for (const l of loc.secoes) {
      const c = rsDados.coordPorSecao[l.secao.id];
      if (c) coordenadoresMap[c.id] = c;
    }
    const coordenadores = Object.values(coordenadoresMap);
    return { ...loc, totalCargos, designados, confirmados, semNenhumNoLocal, pct, temCoord, temCoordConfirmado, temAuxiliar, temAuxiliarConfirmado, coordenadores };
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

// Cores das 3 fatias (02/09/2026, revisado — pedido direto do cartório:
// "achei um pouco confuso"). Confirmado/Convocado continuam verde/azul (a
// dupla mais segura pra quem tem daltonismo vermelho-verde, o tipo mais
// comum); "Vazio" era `var(--border2)` — um bege/cinza quase da cor do
// próprio card no tema claro, então a fatia "some" visualmente em vez de
// avisar que falta gente. Trocado por `var(--red)`, mesmo sinal de "falta
// preencher" que `rsBarraCor()` já usa pro gradiente por local (0%→vermelho)
// — fica consistente com o resto do Dashboard, não é uma cor nova inventada
// só pra isto.
const RS_COR_CONFIRMADO = 'var(--green)', RS_COR_CONVOCADO = 'var(--blue)', RS_COR_VAZIO = 'var(--red)';

// Cada linha da legenda ganhou o percentual ao lado da contagem (pedido
// junto: "adicionar o percentual nas fatias/barras") — antes só a fatia
// Confirmado tinha percentual, e só dentro do SVG (`rsPizzaSVG3`, centro do
// donut); Convocado/Vazio não tinham nenhum, obrigando a fazer conta de
// cabeça pra saber a proporção.
function rsPct(valor, total) { return total ? Math.round((valor / total) * 100) : 0; }

function rsPizzaCard3(titulo, valConfirmado, valConvocado, valVazio) {
  const total = valConfirmado + valConvocado + valVazio;
  return `
    <div class="import-card" style="padding:12px 14px;display:flex;align-items:center;gap:10px">
      ${rsPizzaSVG3(valConfirmado, valConvocado, valVazio, RS_COR_CONFIRMADO, RS_COR_CONVOCADO, RS_COR_VAZIO)}
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:.76rem;margin-bottom:6px">${titulo}</div>
        <div style="font-size:.72rem;color:var(--text2);display:flex;align-items:center;gap:6px;margin-bottom:2px">
          <span style="width:9px;height:9px;border-radius:2px;background:${RS_COR_CONFIRMADO};display:inline-block;flex-shrink:0"></span>
          Confirmado: <b style="color:var(--text)">${valConfirmado}</b> <span style="color:var(--text3)">(${rsPct(valConfirmado, total)}%)</span>
        </div>
        <div style="font-size:.72rem;color:var(--text2);display:flex;align-items:center;gap:6px;margin-bottom:2px">
          <span style="width:9px;height:9px;border-radius:2px;background:${RS_COR_CONVOCADO};display:inline-block;flex-shrink:0"></span>
          Convocado: <b style="color:var(--text)">${valConvocado}</b> <span style="color:var(--text3)">(${rsPct(valConvocado, total)}%)</span>
        </div>
        <div style="font-size:.72rem;color:var(--text2);display:flex;align-items:center;gap:6px">
          <span style="width:9px;height:9px;border-radius:2px;background:${RS_COR_VAZIO};display:inline-block;flex-shrink:0"></span>
          Vazio: <b style="color:var(--text)">${valVazio}</b> <span style="color:var(--text3)">(${rsPct(valVazio, total)}%)</span>
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
        <div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:${corConvocado};display:inline-block;flex-shrink:0"></span>Convocados: <b>${convocados}</b> <span style="color:var(--text3)">(${Math.round(pctConv)}%)</span></div>
        <div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:${corConfirmado};display:inline-block;flex-shrink:0"></span>Confirmados: <b>${confirmados}</b> <span style="color:var(--text3)">(${Math.round(pctConf)}%)</span></div>
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

// Barra de progresso em gradiente vermelho→amarelo→verde (01/09/2026, pedido
// direto a partir de um print do card "8/8 designados... 75%" — a barra era
// sempre azul enquanto não batia 100%, sem noção de "quão perto" estava).
// Em vez de calcular a cor em JS (que exigiria saber o hex exato de cada tema
// — sime_theme_dark.css e sime_theme_cream.css usam tons de verde/vermelho
// diferentes), o gradiente inteiro fica pintado no elemento (var(--red) →
// var(--yellow) → var(--green), que cada tema já define do jeito certo) e um
// clip-path revela só os primeiros pct% dele — o resultado é a MESMA barra
// "termômetro" de sempre, só que a cor do trecho preenchido já é a cor certa
// daquele ponto da escala (baixo = vermelho, meio = amarelo, alto = verde),
// em vez de azul genérico.
function rsBarraGradienteHTML(pct) {
  const p = Math.min(Math.max(pct, 0), 100);
  return `<div style="position:absolute;inset:0;background:linear-gradient(90deg,var(--red),var(--yellow) 50%,var(--green));clip-path:inset(0 ${100 - p}% 0 0);border-radius:99px"></div>`;
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
        <div style="flex:1;height:6px;border-radius:99px;background:var(--bg2);overflow:hidden;position:relative">
          ${rsBarraGradienteHTML(loc.pct)}
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
        <div style="flex:1;height:6px;border-radius:99px;background:var(--bg2);overflow:hidden;position:relative">
          ${rsBarraGradienteHTML(loc.pct)}
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
        ${l.cargos.map((cg, i) => {
          // Cargo vazio (❌, sem ninguém designado) fica clicável pra abrir a
          // fila inteira de voluntários disponíveis — antes só o card tinha
          // a sugestão do primeiro da fila (🙋), sem clique nenhum. Cargo com
          // gente designada (id preenchido — inclusive 🔁 precisa substituir)
          // continua abrindo o modal de contato de sempre, sem mudança.
          const vago = !cg.id && cg.cls === 'rs-sem';
          const onclick = cg.id ? `onclick="event.stopPropagation();cmAbrirModal('${cg.id}')"`
            : vago ? `onclick="event.stopPropagation();rsAbrirVoluntarios('${rsJsStr(l.secao.municipio)}','${rsJsStr(l.secao.local_nome)}','${rsJsStr(RS_CARGOS[i])}')"`
            : '';
          let titulo = cg.id ? `${rsEsc(cg.label)} — clique pra ver tentativas de contato` : vago ? `${rsEsc(cg.label)} — clique pra ver voluntários disponíveis` : rsEsc(cg.label);
          // Conflito de papel (01/09/2026) — a mesma pessoa também está
          // designada Coordenador(a) de Acessibilidade em outra seção; não
          // pode estar nos dois cargos ao mesmo tempo no Dia D.
          if (cg.conflito) titulo += ` — ⚠️ também é Coordenador(a) de Acessibilidade na Seção ${cg.conflito.secaoNumero}`;
          return `
          <div style="text-align:center;max-width:78px${onclick ? ';cursor:pointer' : ''}" title="${titulo}" ${onclick}>
            <div style="font-size:1.1rem">${cg.icone}</div>
            <div style="font-size:.68rem;color:var(--text2);margin-top:2px">${RS_CARGOS[i]}</div>
            ${cg.nome ? `<div style="font-size:.66rem;color:${cg.id ? 'var(--blue)' : 'var(--text3)'};margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${cg.id ? 'text-decoration:underline' : ''}">${rsEsc(cg.nome.split(' ')[0])}</div>` : ''}
            ${cg.sugestaoNome ? `<div style="font-size:.62rem;color:var(--green);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${vago ? 'text-decoration:underline' : ''}" title="Sugestão pela fila de voluntários disponíveis, por ordem de cadastro: ${rsEsc(cg.sugestaoNome)}">🙋 ${rsEsc(cg.sugestaoNome.split(' ')[0])}</div>` : ''}
            ${cg.conflito ? `<div style="font-size:.6rem;color:var(--red);font-weight:700;margin-top:1px">⚠️ tb. Coord. Seção ${rsEsc(cg.conflito.secaoNumero)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
      <div class="ic-sub" style="margin-top:10px;margin-bottom:0">Atualizado em ${rsFmtData(l.atualizado)}</div>
    </div>`;
}

function renderResumoSecoes() {
  const c = document.getElementById('content');
  // Preserva foco + posição do cursor do campo de busca entre re-renders
  // (01/09/2026, achado real reportado pelo cartório: "a consulta ainda
  // esta sendo caracter por caracter" — cada render() reconstrói
  // #content.innerHTML do zero, mesmo padrão do resto do app; pra um botão
  // isso não importa, mas pra um <input> de digitação isso troca o elemento
  // por um novo a cada tecla e derruba o foco, obrigando a clicar de novo
  // pra continuar digitando o próximo caractere). Captado aqui, antes de
  // qualquer innerHTML ser reescrito, e reaplicado no fim da função — só
  // quando o campo de busca era de fato o elemento focado.
  const rsBuscaFocada = document.activeElement?.id === 'rs-busca';
  const rsBuscaCursor = rsBuscaFocada ? document.activeElement.selectionStart : null;
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
    locaisComCoord, locaisComCoordConfirmado,
    porMunicipio,
  } = rsCalcular();

  // Redesenhado em 21/08/2026 a pedido do cartório: 3 pizzas (MRV / Coord.
  // de Acessibilidade / Auxiliar de Eleição), cada uma com 3 fatias que
  // somam o Total daquele grupo — Confirmado / Convocado (designado, ainda
  // não confirmado) / Vazio — em vez do desenho anterior de 4 pizzas de 2
  // fatias (nomeado x vazio, separado de confirmado x total). MRV é "vaga"
  // por CARGO de mesa (4 por seção); Coord. de Acessibilidade não tem cargo
  // fixo no schema, então a "vaga" vira 1 por LOCAL de votação.
  //
  // Auxiliar de Eleição É DIFERENTE (corrigido 22/08/2026): a pizza "por
  // local" sempre dava 0%/100% vazio pra esse grupo, mesmo com gente
  // confirmada — não é falta de gente, é falta de dado (o TRE não manda o
  // código do local pra essa função, ver CLAUDE.md). Sem como saber ONDE
  // cada auxiliar atua, a pizza usa contagem simples por PESSOA (como o
  // stat card "Apoio logístico (AL)" já fazia por baixo dos panos) — sem
  // fatia de "vazio", porque não há como calcular uma vaga vazia sem
  // inventar um total que o TRE não forneceu.
  const locaisTotal = porLocal.length;
  const pizzasHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
      ${rsPizzaCard3('MRV (Mesários)', mrvConfirmadoCargos, mrvDesignados - mrvConfirmadoCargos, mrvTotalCargos - mrvDesignados)}
      ${rsPizzaCard3('Coordenadores de Acessibilidade', locaisComCoordConfirmado, locaisComCoord - locaisComCoordConfirmado, locaisTotal - locaisComCoord)}
      ${rsPizzaCard3('Auxiliares de Eleição (apoio logístico)', rsDados.auxiliarConfirmado, rsDados.auxiliarTotal - rsDados.auxiliarConfirmado, 0)}
    </div>`;

  // Barra-resumo da zona inteira (21/08/2026), acima das 3 pizzas — soma os
  // 3 grupos num só "funil": Total de vagas (MRV + 1 por local pra Coord. +
  // headcount de Auxiliar, ver pizza acima) → Convocados → Confirmados.
  // Auxiliar entra por PESSOA, não por local (22/08/2026, mesmo motivo da
  // pizza) — todo auxiliar carregado já conta como "convocado" (existe,
  // foi contactado ou está na fila pra ser), não há vaga vazia calculável.
  const funilTotal = mrvTotalCargos + locaisTotal + rsDados.auxiliarTotal;
  const funilConvocados = mrvDesignados + locaisComCoord + rsDados.auxiliarTotal;
  const funilConfirmados = mrvConfirmadoCargos + locaisComCoordConfirmado + rsDados.auxiliarConfirmado;
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
      // Nome do(s) Coordenador(es) de Acessibilidade do local (01/09/2026,
      // pedido direto: "abaixo do nome pode indicar o nome do coordenador de
      // acessibilidade designado?") — mesmo ícone de status já usado nos
      // cargos de mesa (rsStatusCargo), pra ficar consistente com o resto da
      // tela; "vaga" é por local (não por seção), então normalmente é só 1.
      // Clicável (mesmo dia, pedido direto: "permita clicar no nome do
      // coordenador para verificar a situação") — abre o mesmo modal de
      // tentativas de contato que o nome do mesário já abre nos cargos de
      // mesa (cmAbrirModal), mesmo estilo visual (azul, sublinhado).
      const coordHTML = loc.coordenadores.length
        ? loc.coordenadores.map(c => {
            const st = rsStatusCargo(c);
            const conflito = rsConflitoCoordComoMesario(c);
            const aviso = conflito
              ? ` <span style="color:var(--red);font-weight:700;font-size:.8em" title="Também é mesário(a) — ${rsEsc(conflito.funcao_mesa)} da Seção ${rsEsc(conflito.secaoNumero)} — não pode estar nos dois cargos ao mesmo tempo">⚠️ também é mesário (Seção ${rsEsc(conflito.secaoNumero)})</span>`
              : '';
            return `${st.icone} <span style="color:var(--blue);text-decoration:underline;cursor:pointer" onclick="cmAbrirModal('${c.id}')" title="Ver tentativas de contato">${rsEsc(st.nome)}</span>${aviso}`;
          }).join(', ')
        : '❌ Sem coordenador de acessibilidade designado';
      c.innerHTML = `
        ${statsHTML}
        <div class="import-card" style="padding:12px 16px;display:flex;align-items:center;gap:10px">
          <button class="btn btn-out" style="padding:6px 12px;font-size:.76rem" onclick="rsFecharLocal()">← Voltar</button>
          <div>
            <div style="font-weight:800">${loc.local_nome || '(sem local)'}</div>
            <div class="ic-sub" style="margin-bottom:0">📍 ${loc.municipio || ''} — ${loc.secoes.length} seção(ões), ${loc.designados}/${loc.totalCargos} cargos designados</div>
            <div class="ic-sub" style="margin-bottom:0;margin-top:2px">🧏 Coordenador(a) de Acessibilidade: ${coordHTML}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
          ${loc.secoes.map(rsCardSecao).join('')}
        </div>`;
      return;
    }
  }

  // ── Grade/lista de locais de votação ──
  // Busca por nome do local, município OU número de seção (01/09/2026,
  // pedido direto: "quero poder pesquisar o numero da seção") — um local
  // "casa" se qualquer seção dele tiver o número buscado como substring
  // (ex.: "63" acha a seção 0063), não só nome/município como antes.
  //
  // Vários termos de uma vez, separados por VÍRGULA (01/09/2026, pedido
  // direto: "no filtro do dashboard so permite consultar numero por
  // numero" — antes o campo inteiro virava UM substring só, então buscar
  // duas seções ao mesmo tempo, ex. "63,245", não achava nada — nenhum local
  // tem as duas como substring do próprio texto). Cada termo (separado por
  // vírgula) é tratado à parte (nome/município/nº de seção); um local entra
  // se casar com QUALQUER termo. Só vírgula, não espaço — nome de local é
  // sempre uma frase com espaço (ex. "Grupo Escolar A", "Escola B"), e
  // partir por espaço também quebraria esses nomes em palavras soltas,
  // fazendo "Escola B" casar com qualquer local que só tivesse "escola" no
  // nome (ex. "Grupo ESCOLAr A") — regressão real, pegou no teste da busca
  // por nome que já existia antes desta mudança.
  const termos = rsBusca.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
  const rsLocalCasaTermo = (l, t) =>
    (l.local_nome || '').toLowerCase().includes(t) ||
    (l.municipio || '').toLowerCase().includes(t) ||
    l.secoes.some(sl => String(sl.secao.numero).includes(t));
  let filtrados = termos.length
    ? porLocal.filter(l => termos.some(t => rsLocalCasaTermo(l, t)))
    : porLocal;
  // Filtro por situação (01/09/2026) — três lentes sobre os mesmos locais já
  // filtrados pela busca, não substituem a busca.
  if (rsFiltroStatus === 'confirmadas') {
    filtrados = filtrados.filter(l => l.totalCargos > 0 && l.confirmados === l.totalCargos);
  } else if (rsFiltroStatus === 'vagas') {
    filtrados = filtrados.filter(l => l.designados < l.totalCargos);
  } else if (rsFiltroStatus === 'pendentes') {
    filtrados = filtrados.filter(l => l.confirmados < l.designados);
  }
  const semNenhum = linhas.filter(l => l.designados === 0).length;
  const completas = linhas.filter(l => l.confirmados === 4).length;

  c.innerHTML = `
    ${funilHTML}
    ${rsTabelaMunicipios(porMunicipio)}
    ${pizzasHTML}
    ${statsHTML}
    <div class="import-card" style="padding:12px 16px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <input type="text" id="rs-busca" placeholder="🔍 Pesquisar local ou nº da seção — separe vários por vírgula…" value="${rsBusca.replace(/"/g, '&quot;')}" oninput="rsBusca=this.value;render()" style="flex:1;min-width:200px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
        <select onchange="rsFiltroStatus=this.value;render()" aria-label="Filtrar por situação" style="padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
          <option value="todos" ${rsFiltroStatus === 'todos' ? 'selected' : ''}>Todos os locais</option>
          <option value="confirmadas" ${rsFiltroStatus === 'confirmadas' ? 'selected' : ''}>✅ Todas as seções confirmadas</option>
          <option value="vagas" ${rsFiltroStatus === 'vagas' ? 'selected' : ''}>❌ Com vagas (cargo sem designação)</option>
          <option value="pendentes" ${rsFiltroStatus === 'pendentes' ? 'selected' : ''}>🔶 Com mesários pendentes de confirmação</option>
        </select>
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
    ) : '<div class="import-card"><div class="ic-sub" style="margin-bottom:0">Nenhum local encontrado com essa busca/filtro.</div></div>'}`;

  // Reaplica o foco (ver comentário no topo da função) — só depois do
  // innerHTML novo estar no ar, senão o elemento com esse id ainda não existe.
  if (rsBuscaFocada) {
    const buscaEl = document.getElementById('rs-busca');
    if (buscaEl) {
      buscaEl.focus();
      const pos = rsBuscaCursor ?? buscaEl.value.length;
      buscaEl.setSelectionRange(pos, pos);
    }
  }
}
