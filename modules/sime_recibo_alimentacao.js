// ══════════════════════════════════════
// RECIBO DE AUXÍLIO ALIMENTAÇÃO — aba "🍽️ Auxílio Alimentação" de
// SIME_convocacao.html. Pedido direto (18/09/2026), com dois documentos
// reais anexados como referência: o modelo oficial do ELO ("Controle de
// Entrega de Auxílio Alimentação / Lista de presença" — Seção|Inscrição|
// Nome|Função|Assinatura, agrupado por local de votação, terminando com um
// bloco de SUBSTITUIÇÕES em branco e "Total pago"/"Suprido (carimbo e
// assinatura)") e uma planilha auxiliar de vales-alimentação de mesários.
//
// Este módulo replica o FORMATO do ELO — mesmas colunas, mesmo bloco de
// substituições pra troca de última hora com assinatura sempre em branco
// — pros 4 grupos que o pedido cobre: mesa receptora, coordenador de
// acessibilidade, auxiliares de eleição (geral, um recibo por dia — o
// grupo trabalha sábado/D-1 e domingo/Dia D) e junta eleitoral.
//
// Só GERA O DOCUMENTO — não é um controle de pagamento com status por
// pessoa (sem "pago"/"pendente"); a confirmação de entrega é a própria
// assinatura no papel, no ato, mesmo espírito de Correspondência/Oficial
// de Justiça: o SIME organiza e imprime, o cartório executa fora do
// sistema.
//
// Fonte de dado: sime_atores (mesmo cadastro/roster de sempre), filtrado
// por funcao. `junta_eleitoral` já existe no enum e no cadastro avulso de
// SIME_atores.html desde antes desta feature (nunca vem do sync do ELO,
// só cadastro manual) — nenhuma mudança de schema precisou disso.
// Valor/forma do auxílio (`sime_eleicoes.valor_auxilio_alimentacao`/
// `forma_auxilio_alimentacao`, sql/SIME_eleicoes_auxilio_alimentacao.sql)
// são editáveis pelo cartório, nunca cravados como fato — mesmo padrão já
// usado por `minutos_por_eleitor_fila` em SIME_admin.html.

let raDados = null; // { zona, eleicao, mesarios, coord, auxiliares, junta }

const RA_ORDEM_MESA = ['Presidente', '1º Mesário', '2º Mesário', '1º Secretário'];

function raEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function raFuncaoLabel(p) {
  if (p.funcao === 'mesario') return p.funcao_mesa || 'Mesário';
  if (p.funcao === 'coord_acessibilidade') return 'Coordenador(a) de Acessibilidade';
  if (p.funcao === 'auxiliar_eleicao') return 'Auxiliar de Eleição';
  if (p.funcao === 'junta_eleitoral') return 'Membro da Junta Eleitoral';
  return p.funcao || '';
}

function raFmtValor(v) {
  return `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
}

async function raCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { raDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: zona }, { data: eleicao }, { data: atores, error }] = await Promise.all([
    sb.from('sime_zonas').select('numero, municipio').eq('id', zonaId).maybeSingle(),
    sb.from('sime_eleicoes').select('id, nome, valor_auxilio_alimentacao, forma_auxilio_alimentacao')
      .eq('zona_id', zonaId).eq('ativa', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('sime_atores')
      .select('id, nome_completo, funcao, funcao_mesa, secao_id, inscricao_eleitoral')
      .eq('zona_id', zonaId).eq('ativo', true)
      .in('funcao', ['mesario', 'coord_acessibilidade', 'auxiliar_eleicao', 'junta_eleitoral']),
  ]);
  if (error) { raDados = { erro: error.message }; render(); return; }

  const secaoIds = [...new Set((atores || []).map(a => a.secao_id).filter(Boolean))];
  const { data: secoes } = secaoIds.length
    ? await sb.from('sime_secoes').select('id, numero, local_nome, municipio').in('id', secaoIds)
    : { data: [] };
  const secoesPorId = Object.fromEntries((secoes || []).map(s => [s.id, s]));
  for (const a of atores || []) a.sec = a.secao_id ? secoesPorId[a.secao_id] : null;

  raDados = {
    zona: zona || {},
    eleicao: eleicao || null,
    mesarios: (atores || []).filter(a => a.funcao === 'mesario'),
    coord: (atores || []).filter(a => a.funcao === 'coord_acessibilidade'),
    auxiliares: (atores || []).filter(a => a.funcao === 'auxiliar_eleicao'),
    junta: (atores || []).filter(a => a.funcao === 'junta_eleitoral'),
  };
  render();
}

function raCfg() {
  const hoje = new Date();
  const dataStr = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
  const valor = Number(raDados.eleicao?.valor_auxilio_alimentacao ?? 65);
  const forma = raDados.eleicao?.forma_auxilio_alimentacao || 'DINHEIRO';
  const eleicaoNome = raDados.eleicao?.nome || 'Eleição';
  const zonaTexto = raDados.zona?.numero ? `${raDados.zona.numero}ª Zona Eleitoral${raDados.zona.municipio ? ` — ${raDados.zona.municipio}` : ''}` : 'Zona Eleitoral';
  return { valor, forma, eleicaoNome, dataStr, zonaTexto };
}

// Agrupa uma lista de sime_atores por local de votação (município+local),
// mesma chave usada em todo o resto do sistema pra agrupar seções por
// prédio (sime_secoes não tem id próprio de "local"). Quem não resolveu
// secao_id (comum pra coord_acessibilidade/auxiliar_eleicao — ver
// CLAUDE.md, "Auxiliar de Eleição virou contagem por PESSOA") entra numa
// última seção própria, nunca escondido.
function raAgruparPorLocal(pessoas) {
  const grupos = {};
  const semLocal = [];
  for (const p of pessoas) {
    const item = { numero: p.sec ? p.sec.numero : null, inscricao: p.inscricao_eleitoral, nome: p.nome_completo, funcaoLabel: raFuncaoLabel(p) };
    if (!p.sec) { semLocal.push(item); continue; }
    const chave = `${p.sec.municipio}|||${p.sec.local_nome}`;
    if (!grupos[chave]) grupos[chave] = { municipio: p.sec.municipio, local_nome: p.sec.local_nome, pessoas: [] };
    grupos[chave].pessoas.push(item);
  }
  const locais = Object.values(grupos).sort((a, b) => (a.municipio + a.local_nome).localeCompare(b.municipio + b.local_nome));
  for (const loc of locais) {
    loc.pessoas.sort((a, b) => (a.numero - b.numero) || (RA_ORDEM_MESA.indexOf(a.funcaoLabel) - RA_ORDEM_MESA.indexOf(b.funcaoLabel)));
  }
  if (semLocal.length) locais.push({ municipio: '', local_nome: '⚠ Sem local definido', pessoas: semLocal });
  return locais;
}

function raListaFlatOrdenada(pessoas) {
  return [...pessoas]
    .sort((a, b) => a.nome_completo.localeCompare(b.nome_completo))
    .map(p => ({ inscricao: p.inscricao_eleitoral, nome: p.nome_completo, funcaoLabel: raFuncaoLabel(p) }));
}

// Bloco de SUBSTITUIÇÕES — mesmo formato da folha final do modelo real do
// ELO: linhas em branco (preencher com letra de forma), assinatura sempre
// em branco, pra registrar uma troca de última hora sem precisar de outro
// documento. Aparece em TODOS os modelos (mesa/coord/auxiliar/junta), não
// só na mesa receptora.
function raHtmlSubstituicoes() {
  const linhas = Array.from({ length: 6 }).map(() => '<tr><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
  return `
    <div class="ra-substituicoes">
      <div class="ra-sub-titulo">SUBSTITUIÇÕES (preencher com letra de forma):</div>
      <table class="ra-tabela ra-tabela-sub">
        <thead><tr><th>Seção</th><th>Inscrição</th><th>Nome</th><th>Função</th><th>Data</th><th>Assinatura</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>`;
}

function raHtmlRodapeTotal(localTexto, dataStr) {
  return `
    <div class="ra-rodape-total">
      <div><b>Total pago:</b> R$ ______________</div>
      <div class="ra-rodape-linha">
        <span><b>Local:</b> ${raEsc(localTexto || '')}</span>
        <span><b>Data:</b> ${dataStr ? raEsc(dataStr) : '___/___/______'}</span>
        <span><b>Suprido (carimbo e assinatura):</b> ________________________</span>
      </div>
    </div>`;
}

function raHtmlCabecalho(titulo, cfg, subtituloDia) {
  return `
    <div class="ra-cabecalho">
      <div class="ra-titulo">${raEsc(titulo)}</div>
      <div class="ra-sub">Eleição: ${raEsc(cfg.eleicaoNome)}${subtituloDia ? ` — ${raEsc(subtituloDia)}` : ''}</div>
    </div>`;
}

// Um "recibo" por LOCAL de votação — mesa receptora e coordenador de
// acessibilidade usam este formato: várias mesas/pessoas do mesmo prédio
// na mesma página (como o ELO já faz), quebra de página a cada troca de
// local, cada página com seu próprio bloco de substituições/fechamento —
// o cartório assina o "Suprido" ali mesmo, por local, não num único
// fechamento pra zona inteira.
function raHtmlPorLocal(titulo, locais, cfg) {
  return locais.map(loc => `
    <div class="ra-pagina">
      ${raHtmlCabecalho(titulo, cfg)}
      <div class="ra-linha-info">
        <span><b>Município:</b> ${raEsc(loc.municipio || '—')}</span>
        <span><b>Local de Votação:</b> ${raEsc(loc.local_nome)}</span>
        <span><b>Forma de Auxílio:</b> ${raEsc(cfg.forma)} &nbsp; <b>Valor:</b> ${raFmtValor(cfg.valor)}</span>
      </div>
      <table class="ra-tabela">
        <colgroup><col class="ra-col-secao"><col class="ra-col-insc"><col><col class="ra-col-func"><col class="ra-col-assin"></colgroup>
        <thead><tr><th>Seção</th><th>Inscrição</th><th>Nome</th><th>Função</th><th>Assinatura</th></tr></thead>
        <tbody>${loc.pessoas.map(p => `
          <tr>
            <td>${p.numero ?? '—'}</td>
            <td>${raEsc(p.inscricao || '—')}</td>
            <td>${raEsc(p.nome)}</td>
            <td>${raEsc(p.funcaoLabel)}</td>
            <td class="ra-linha-assin"></td>
          </tr>`).join('')}</tbody>
      </table>
      ${raHtmlSubstituicoes()}
      ${raHtmlRodapeTotal(loc.local_nome)}
    </div>`).join('');
}

// Lista única, sem agrupar por local — auxiliares de eleição (geral) e
// junta eleitoral: um recibo só pro grupo inteiro da zona, não por prédio.
function raHtmlListaFlat(titulo, subtituloDia, pessoas, cfg, localTexto) {
  return `
    <div class="ra-pagina">
      ${raHtmlCabecalho(titulo, cfg, subtituloDia)}
      <div class="ra-linha-info">
        <span><b>Zona:</b> ${raEsc(cfg.zonaTexto)}</span>
        <span><b>Forma de Auxílio:</b> ${raEsc(cfg.forma)} &nbsp; <b>Valor:</b> ${raFmtValor(cfg.valor)}</span>
      </div>
      <table class="ra-tabela">
        <colgroup><col class="ra-col-insc"><col><col class="ra-col-func"><col class="ra-col-assin"></colgroup>
        <thead><tr><th>Inscrição</th><th>Nome</th><th>Função</th><th>Assinatura</th></tr></thead>
        <tbody>${pessoas.map(p => `
          <tr>
            <td>${raEsc(p.inscricao || '—')}</td>
            <td>${raEsc(p.nome)}</td>
            <td>${raEsc(p.funcaoLabel)}</td>
            <td class="ra-linha-assin"></td>
          </tr>`).join('')}</tbody>
      </table>
      ${raHtmlSubstituicoes()}
      ${raHtmlRodapeTotal(localTexto)}
    </div>`;
}

async function raImprimirDocumento(html, acaoLog, quantidade) {
  const area = document.getElementById('print-area');
  area.innerHTML = html;
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log(acaoLog, '', { autor, quantidade });
  window.print();
}

async function raImprimirMesaReceptora() {
  if (!raDados.mesarios.length) { showToast('⚠ Nenhum mesário ativo pra gerar recibo'); return; }
  const locais = raAgruparPorLocal(raDados.mesarios);
  const html = raHtmlPorLocal('Recibo de Auxílio Alimentação — Mesa Receptora', locais, raCfg());
  await raImprimirDocumento(html, 'recibo_alimentacao_mesa_impresso', raDados.mesarios.length);
}

async function raImprimirCoordenadores() {
  if (!raDados.coord.length) { showToast('⚠ Nenhum coordenador de acessibilidade ativo'); return; }
  const locais = raAgruparPorLocal(raDados.coord);
  const html = raHtmlPorLocal('Recibo de Auxílio Alimentação — Coordenador(a) de Acessibilidade', locais, raCfg());
  await raImprimirDocumento(html, 'recibo_alimentacao_coord_impresso', raDados.coord.length);
}

async function raImprimirAuxiliares() {
  if (!raDados.auxiliares.length) { showToast('⚠ Nenhum auxiliar de eleição ativo'); return; }
  const pessoas = raListaFlatOrdenada(raDados.auxiliares);
  const cfg = raCfg();
  const html =
    raHtmlListaFlat('Recibo de Auxílio Alimentação — Auxiliares de Eleição', 'Sábado (D-1)', pessoas, cfg, cfg.zonaTexto) +
    raHtmlListaFlat('Recibo de Auxílio Alimentação — Auxiliares de Eleição', 'Domingo (Dia D)', pessoas, cfg, cfg.zonaTexto);
  await raImprimirDocumento(html, 'recibo_alimentacao_auxiliares_impresso', pessoas.length);
}

async function raImprimirJunta() {
  if (!raDados.junta.length) { showToast('⚠ Nenhum membro da junta eleitoral cadastrado'); return; }
  const pessoas = raListaFlatOrdenada(raDados.junta);
  const cfg = raCfg();
  const html = raHtmlListaFlat('Recibo de Auxílio Alimentação — Junta Eleitoral', null, pessoas, cfg, cfg.zonaTexto);
  await raImprimirDocumento(html, 'recibo_alimentacao_junta_impresso', pessoas.length);
}

async function raSalvarConfig() {
  if (!raDados?.eleicao?.id) { showToast('⚠ Nenhuma eleição ativa nesta zona — não há onde salvar'); return; }
  const valorTxt = document.getElementById('ra-valor').value.replace(',', '.');
  const valor = parseFloat(valorTxt);
  const forma = document.getElementById('ra-forma').value.trim().toUpperCase() || 'DINHEIRO';
  if (!(valor > 0)) { showToast('⚠ Informe um valor válido'); return; }
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_eleicoes')
    .update({ valor_auxilio_alimentacao: valor, forma_auxilio_alimentacao: forma })
    .eq('id', raDados.eleicao.id);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return; }
  raDados.eleicao.valor_auxilio_alimentacao = valor;
  raDados.eleicao.forma_auxilio_alimentacao = forma;
  await log('recibo_alimentacao_config_atualizada', '', { valor, forma });
  showToast('✓ Configuração salva');
  render();
}

function renderReciboAlimentacao() {
  const c = document.getElementById('content');
  if (!window.supabaseAtores) {
    c.innerHTML = '<div class="import-card"><div class="import-result ir-warn">Entre com a conta da equipe.</div></div>';
    return;
  }
  if (!raDados) {
    c.innerHTML = '<div class="import-card"><div class="ic-title">🍽️ Auxílio Alimentação</div><div class="ic-sub">Carregando…</div></div>';
    raCarregar();
    return;
  }
  if (raDados.erro) {
    c.innerHTML = `<div class="import-card"><div class="import-result ir-warn">⚠ ${raEsc(raDados.erro)}</div></div>`;
    return;
  }

  const cfg = raCfg();
  c.innerHTML = `
    <div class="import-card">
      <div class="ic-title">🍽️ Recibo de Auxílio Alimentação</div>
      <div class="ic-sub">Documento de distribuição do auxílio alimentação — mesmo modelo já usado pelo cartório no
        ELO (Seção/Inscrição/Nome/Função/Assinatura), com espaço em branco pra eventual substituição de última
        hora e o fechamento de "Total pago"/"Suprido". Só gera o documento — a confirmação de entrega é a própria
        assinatura no papel, no ato.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:10px">
        <div>
          <label style="font-size:.72rem;color:var(--text2);display:block;margin-bottom:2px">Valor (R$)</label>
          <input id="ra-valor" type="text" value="${cfg.valor.toFixed(2)}" style="width:100px">
        </div>
        <div>
          <label style="font-size:.72rem;color:var(--text2);display:block;margin-bottom:2px">Forma de auxílio</label>
          <input id="ra-forma" type="text" value="${raEsc(cfg.forma)}" style="width:160px">
        </div>
        <button class="btn btn-out" onclick="raSalvarConfig()">💾 Salvar</button>
      </div>
      ${!raDados.eleicao ? '<div class="import-result ir-warn" style="margin-top:8px">⚠ Nenhuma eleição ativa nesta zona — valor/forma não podem ser salvos ainda.</div>' : ''}
    </div>

    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">🗳️ Mesa Receptora (${raDados.mesarios.length})</div>
      <div class="ic-sub">Presidente + 1º/2º Mesário + 1º Secretário de cada seção, agrupado por local de votação
        — mesmo layout do ELO.</div>
      <button class="btn btn-dark" style="margin-top:8px" ${!raDados.mesarios.length ? 'disabled' : ''} onclick="raImprimirMesaReceptora()">🖨️ Imprimir recibos — Mesa Receptora</button>
    </div>

    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">♿ Coordenador(a) de Acessibilidade (${raDados.coord.length})</div>
      <div class="ic-sub">Um recibo por coordenador, agrupado por local de votação.</div>
      <button class="btn btn-dark" style="margin-top:8px" ${!raDados.coord.length ? 'disabled' : ''} onclick="raImprimirCoordenadores()">🖨️ Imprimir recibos — Coordenadores</button>
    </div>

    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">🧰 Auxiliares de Eleição (${raDados.auxiliares.length})</div>
      <div class="ic-sub">Recibo geral, em lista única (sem agrupar por local — a maioria não tem seção
        resolvida). Sai em duas folhas separadas no mesmo clique — Sábado (D-1) e Domingo (Dia D) — já que este
        grupo trabalha e recebe auxílio nos dois dias.</div>
      <button class="btn btn-dark" style="margin-top:8px" ${!raDados.auxiliares.length ? 'disabled' : ''} onclick="raImprimirAuxiliares()">🖨️ Imprimir recibos — Sábado e Domingo</button>
    </div>

    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">⚖️ Junta Eleitoral (${raDados.junta.length})</div>
      <div class="ic-sub">Recibo geral, em lista única, um único dia.</div>
      <button class="btn btn-dark" style="margin-top:8px" ${!raDados.junta.length ? 'disabled' : ''} onclick="raImprimirJunta()">🖨️ Imprimir recibo — Junta Eleitoral</button>
    </div>
  `;
}
