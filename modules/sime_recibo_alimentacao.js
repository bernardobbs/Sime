// ══════════════════════════════════════
// RECIBO DE AUXÍLIO ALIMENTAÇÃO — aba "🍽️ Auxílio Alimentação" de
// SIME_convocacao.html. Pedido direto (18/09/2026), com documentos reais
// anexados como referência: o modelo oficial do ELO ("Controle de Entrega
// de Auxílio Alimentação / Lista de presença" — Inscrição|Nome|Função|
// Assinatura, terminando com SUBSTITUIÇÕES/OBS/"Total pago"/"Suprido
// (carimbo e assinatura)") — um pra Mesa Receptora (com coluna Seção +
// "Seção Origem" nas substituições), um pra Coordenador de Acessibilidade
// e um pra Auxiliar de Serviços Eleitorais (os dois últimos SEM coluna de
// seção — Coordenador é por local, Auxiliar é uma lista geral da zona) —
// e uma planilha auxiliar de vales-alimentação de mesários.
//
// Revisado no mesmo dia, pedido direto: "quero um recibo, mais
// institucional, uma folha por seção" — Mesa Receptora deixou de agrupar
// várias mesas do mesmo prédio numa página só (como o ELO faz) e passou a
// dar uma página PRÓPRIA por seção; e ganhou timbre (marca+órgão+título+
// data/hora+paginação, ver `raHtmlTimbre()`) em todos os 4 modelos.
//
// Este módulo replica o FORMATO do ELO — mesmas colunas, mesmo bloco de
// substituições pra troca de última hora com assinatura sempre em branco
// — pros 4 grupos que o pedido cobre: mesa receptora, coordenador de
// acessibilidade, auxiliares de eleição (geral, um recibo por dia — o
// grupo trabalha sábado/D-1 e domingo/Dia D) e junta eleitoral (sem
// referência real do ELO — nunca vem do sync, é cadastro manual — usa o
// mesmo formato "lista geral" do auxiliar).
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
//
// Revisado uma 3ª vez no mesmo dia — pedido direto: "esse modelo do sime
// será o documento enviado às seções... use essa imagem como logo, não
// mencione o sime, retire [a nota de controle interno], em Eleição:
// coloque Eleições Gerais de 2026 - 1º turno e a data do 1º turno".
// Como o documento passa a ser entregue de fato às seções (não só um
// espelho interno do cartório), o timbre trocou a marca placeholder
// "SIME" pela imagem real da campanha civil "Eleições 2026
// #VotoNaDemocracia" (`assets/logo_eleicoes2026.png`, arquivo fornecido
// pelo cartório) e nenhuma menção a "SIME" aparece mais no documento
// impresso; a nota "documento de controle interno... não substitui
// documento oficial" (`raHtmlRodapeInstitucional`, existia desde a
// revisão de timbre) saiu junto — não fazia sentido continuar dizendo
// isso de um documento que passou a ser exatamente o que vai às mãos das
// mesas. A linha "Eleição:" (Mesa Receptora e Coordenador) virou
// `raEleicaoTexto()`: "Eleições Gerais de {ano} - {turno} turno
// ({data})", turno/ano/data vindos de `sime_eleicoes.turno`/`data_d`
// quando cadastrados — sem `data_d` preenchido, cai no valor real já
// documentado no CLAUDE.md pro 1º turno (04/10/2026), nunca um "a
// definir" vago, já que essa data já é certa.

let raDados = null; // { zona, eleicao, mesarios, coord, auxiliares, junta }

const RA_ORDEM_MESA = ['Presidente', '1º Mesário', '2º Mesário', '1º Secretário'];

// ── Controle de pagamento (25/09/2026, pedido direto: "essas pessoas já
// receberam o pix" → "criar um controle de pagamento no SIME") — ver
// sql/SIME_atores_auxilio_pago.sql. Estado da seção "💰 Controle de
// pagamento", separada da geração de recibo acima (que continua só
// documento, sem status). ──
let raPagBusca = '';
let raPagBuscaTimer = null;
let raPagFiltroStatus = 'pendente'; // '' (todos) | 'pago' | 'pendente' — abre em "pendente" (visão mais acionável)

function raEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Rótulos batidos contra o texto REAL da coluna "Função" nos documentos do
// ELO anexados como referência (18/09/2026) — "Coordenador de
// Acessibilidade" (sem "(a)") e "Auxiliar de Serviços Eleitorais" (não
// "Auxiliar de Eleição", que é só o nome interno da `funcao` no SIME).
// `junta_eleitoral` não tem referência do ELO (nunca vem do sync — é
// cadastro manual, ver CLAUDE.md) — mantém o rótulo próprio do SIME.
function raFuncaoLabel(p) {
  if (p.funcao === 'mesario') return p.funcao_mesa || 'Mesário';
  if (p.funcao === 'coord_acessibilidade') return 'Coordenador de Acessibilidade';
  if (p.funcao === 'auxiliar_eleicao') return 'Auxiliar de Serviços Eleitorais';
  if (p.funcao === 'junta_eleitoral') return 'Membro da Junta Eleitoral';
  return p.funcao || '';
}

// Presidente da Junta Eleitoral é, por lei (art. 36 da Lei 4.737/65 —
// Código Eleitoral), o próprio Juiz Eleitoral da zona — nunca um membro
// convocado como os demais (achado real, 18/09/2026: CARLOS MARCELLO
// SALES CAMPOS está cadastrado como `funcao_mesa='Presidente'` da junta
// da 7ª Zona, e É o juiz titular). O juiz não recebe/assina o auxílio
// alimentação que este documento organiza — esse benefício é só pra
// quem foi convocado como mesário/membro de apoio, não pra quem já
// ocupa o cargo por investidura judicial. Por isso ele nunca entra na
// contagem nem no recibo da Junta Eleitoral, nos dois pontos (tela e
// impressão) que leem `raDados.junta`.
function raEhJuizEleitoral(p) {
  return p.funcao === 'junta_eleitoral' && p.funcao_mesa === 'Presidente';
}

function raFmtValor(v) {
  return `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
}

function raFmtDataHora(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

// "AAAA-MM-DD" (formato de data do Postgres) -> "DD/MM/AAAA".
function raFmtDataISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// Texto da linha "Eleição:" — sempre "Eleições Gerais de <ano> - Nº turno",
// com a data do turno (18/09/2026, pedido direto). O ano/turno vêm de
// sime_eleicoes quando cadastrados; a data do 1º turno cai no valor
// conhecido da eleição real (04/10/2026, ver "Números da operação" no
// CLAUDE.md) quando a linha ainda não tem `data_d` preenchido — nunca um
// "a definir" vago, já que o 1º turno já tem data oficial certa.
function raEleicaoTexto(eleicao) {
  const turno = Number(eleicao?.turno) === 2 ? '2º' : '1º';
  const ano = eleicao?.data_d ? eleicao.data_d.slice(0, 4) : '2026';
  const data = raFmtDataISO(eleicao?.data_d) || (turno === '1º' ? '04/10/2026' : '');
  return `Eleições Gerais de ${ano} - ${turno} turno${data ? ` (${data})` : ''}`;
}

async function raCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { raDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: zona }, { data: eleicao }, { data: atores, error }] = await Promise.all([
    sb.from('sime_zonas').select('numero, municipio').eq('id', zonaId).maybeSingle(),
    sb.from('sime_eleicoes').select('id, nome, turno, data_d, valor_auxilio_alimentacao, forma_auxilio_alimentacao')
      .eq('zona_id', zonaId).eq('ativa', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('sime_atores')
      .select('id, nome_completo, funcao, funcao_mesa, secao_id, inscricao_eleitoral, auxilio_alimentacao_pago, auxilio_alimentacao_valor_pago, auxilio_alimentacao_pago_em')
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
    junta: (atores || []).filter(a => a.funcao === 'junta_eleitoral' && !raEhJuizEleitoral(a)),
    // Lista única pro controle de pagamento (abaixo) — mesmo critério do
    // recibo: o Juiz Eleitoral nunca entra (não recebe esse auxílio).
    todos: (atores || []).filter(a => !raEhJuizEleitoral(a)),
  };
  render();
}

function raCfg() {
  const hoje = new Date();
  const dataStr = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
  const dataHoraStr = raFmtDataHora(hoje);
  const valor = Number(raDados.eleicao?.valor_auxilio_alimentacao ?? 65);
  const forma = raDados.eleicao?.forma_auxilio_alimentacao || 'DINHEIRO';
  const eleicaoNome = raEleicaoTexto(raDados.eleicao);
  const zonaTexto = raDados.zona?.numero ? `${raDados.zona.numero}ª Zona Eleitoral${raDados.zona.municipio ? ` — ${raDados.zona.municipio}` : ''}` : 'Zona Eleitoral';
  return { valor, forma, eleicaoNome, dataStr, dataHoraStr, zonaTexto };
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

// Agrupa mesários por SEÇÃO (não por local) — "uma folha por seção"
// (18/09/2026, pedido direto, com print anexado do modelo institucional do
// ELO como referência): cada mesa receptora ganha sua própria página,
// mesmo quando duas seções compartilham o mesmo prédio (diferente de
// raAgruparPorLocal, que juntaria as duas na mesma página). Mesário sem
// secao_id nunca deveria existir na prática (mesa sem seção não faz
// sentido) — mesmo assim, por segurança, quem não resolveu fica de fora
// (não dá pra montar uma folha "de seção" sem saber qual).
function raAgruparPorSecao(pessoas) {
  const grupos = {};
  for (const p of pessoas) {
    if (!p.sec) continue;
    if (!grupos[p.secao_id]) grupos[p.secao_id] = { numero: p.sec.numero, local_nome: p.sec.local_nome, municipio: p.sec.municipio, pessoas: [] };
    grupos[p.secao_id].pessoas.push({ inscricao: p.inscricao_eleitoral, nome: p.nome_completo, funcaoLabel: raFuncaoLabel(p) });
  }
  const secoes = Object.values(grupos).sort((a, b) => a.municipio.localeCompare(b.municipio) || a.numero - b.numero);
  for (const s of secoes) s.pessoas.sort((a, b) => RA_ORDEM_MESA.indexOf(a.funcaoLabel) - RA_ORDEM_MESA.indexOf(b.funcaoLabel));
  return secoes;
}

function raListaFlatOrdenada(pessoas) {
  return [...pessoas]
    .sort((a, b) => a.nome_completo.localeCompare(b.nome_completo))
    .map(p => ({ inscricao: p.inscricao_eleitoral, nome: p.nome_completo, funcaoLabel: raFuncaoLabel(p) }));
}

// Bloco de SUBSTITUIÇÕES — mesmo formato da folha final do modelo real do
// ELO (prints anexados 18/09/2026): linhas em branco (preencher com letra
// de forma), assinatura sempre em branco, pra registrar uma troca de
// última hora sem precisar de outro documento. Aparece em TODOS os
// modelos (mesa/coord/auxiliar/junta), não só na mesa receptora.
//
// `comSecao` — a coluna "Seção Origem" (cabeçalho em duas linhas, igual
// ao modelo real da Mesa Receptora — a seção de onde o substituto de fato
// é titular, útil quando ele vem de outra seção pra cobrir esta mesa) só
// existe quando a tabela PRINCIPAL da página também tem seção — nos
// documentos de referência do coordenador/auxiliar (sem coluna Seção),
// a tabela de substituições também sai sem ela, 5 colunas em vez de 6.
function raHtmlSubstituicoes(comSecao) {
  const cols = comSecao ? 6 : 5;
  const linhaVazia = `<tr>${'<td></td>'.repeat(cols)}</tr>`;
  const linhas = Array.from({ length: 6 }).map(() => linhaVazia).join('');
  return `
    <div class="ra-substituicoes">
      <div class="ra-sub-titulo">SUBSTITUIÇÕES (preencher com letra de forma):</div>
      <table class="ra-tabela ra-tabela-sub">
        <thead><tr>${comSecao ? '<th>Seção<br>Origem</th>' : ''}<th>Inscrição</th><th>Nome</th><th>Função</th><th>Data</th><th>Assinatura</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>`;
}

// "OBS:" — linha de anotação livre entre as substituições e o fechamento,
// presente nos dois documentos reais de referência anexados (coordenador
// e auxiliar) — mantida em todos os modelos por consistência.
function raHtmlObs() {
  return '<div class="ra-obs"><b>OBS:</b><span class="ra-obs-linha"></span></div>';
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

// Timbre institucional (18/09/2026, pedido direto com print anexado do
// modelo real do ELO: "quero um recibo, mais institucional... com
// timbre"). Reproduz a ESTRUTURA do cabeçalho oficial (marca à esquerda,
// nome do órgão, título do documento, data/hora e paginação à direita,
// régua horizontal).
//
// Marca revisada em 18/09/2026, pedido direto ("use essa imagem como
// logo... não mencione o sime"): a marca placeholder "SIME" e a linha de
// texto "SIME — Sistema de Monitoramento Eleitoral" saíram — este
// documento é entregue às seções como parte da própria operação da
// eleição, não referenciando o sistema que o gerou. A marca virou a
// imagem oficial da campanha civil "Eleições 2026 #VotoNaDemocracia"
// (`assets/logo_eleicoes2026.png`, arquivo real fornecido pelo cartório —
// diferente do brasão/selo da Justiça Eleitoral, nunca reproduzido aqui,
// isto é material de campanha, não uma peça judicial).
function raHtmlTimbre(titulo, subtitulo, cfg, numeroPagina) {
  return `
    <div class="ra-timbre">
      <img class="ra-timbre-logo" src="./assets/logo_eleicoes2026.png" alt="Eleições 2026">
      <div class="ra-timbre-texto">
        <div class="ra-timbre-orgao">${raEsc(cfg.zonaTexto)}</div>
        <div class="ra-timbre-titulo">${raEsc(titulo)}</div>
        ${subtitulo ? `<div class="ra-timbre-sub">${raEsc(subtitulo)}</div>` : ''}
      </div>
      <div class="ra-timbre-data">${raEsc(cfg.dataHoraStr)}<br>${numeroPagina}</div>
    </div>
    <div class="ra-timbre-linha"></div>`;
}

// Mesa Receptora — UMA FOLHA POR SEÇÃO (18/09/2026, pedido direto: "quero
// um recibo, mais institucional, uma folha por seção"). Diferente de
// raHtmlPorLocal (usado só pelo coordenador de acessibilidade agora): aqui
// cada seção — mesmo que duas compartilhem o mesmo prédio — sai numa
// página própria, com timbre e paginação "Página N de M". Sem coluna de
// Seção na tabela principal (seria repetir o mesmo número 4 vezes na
// mesma folha) — o número já está no cabeçalho da página.
function raHtmlMesaReceptora(secoes, cfg) {
  return secoes.map((s, i) => `
    <div class="ra-pagina">
      ${raHtmlTimbre('Controle de Entrega de Auxílio Alimentação — Lista de Presença', 'Recibo — Mesa Receptora', cfg, i + 1)}
      <div class="ra-linha-info"><span><b>Eleição:</b> ${raEsc(cfg.eleicaoNome)}</span></div>
      <div class="ra-linha-info">
        <span><b>Município:</b> ${raEsc(s.municipio)}</span>
        <span><b>Local de Votação:</b> ${raEsc(s.local_nome)}</span>
        <span><b>Seção:</b> ${s.numero}</span>
        <span><b>Forma de Auxílio:</b> ${raEsc(cfg.forma)} &nbsp; <b>Valor:</b> ${raFmtValor(cfg.valor)}</span>
      </div>
      <table class="ra-tabela">
        <colgroup><col class="ra-col-insc"><col><col class="ra-col-func"><col class="ra-col-assin"></colgroup>
        <thead><tr><th>Inscrição</th><th>Nome</th><th>Função</th><th>Assinatura</th></tr></thead>
        <tbody>${s.pessoas.map(p => `
          <tr>
            <td>${raEsc(p.inscricao || '—')}</td>
            <td>${raEsc(p.nome)}</td>
            <td>${raEsc(p.funcaoLabel)}</td>
            <td class="ra-linha-assin"></td>
          </tr>`).join('')}</tbody>
      </table>
      ${raHtmlSubstituicoes(true)}
      ${raHtmlObs()}
      ${raHtmlRodapeTotal(`Seção ${s.numero} — ${s.local_nome}`)}
    </div>`).join('');
}

// Um "recibo" por LOCAL de votação — coordenador de acessibilidade
// continua neste formato (não é "por seção": um coordenador cobre o
// prédio inteiro, não uma mesa específica): várias pessoas do mesmo
// prédio na mesma página, quebra a cada troca de local, cada página com
// seu próprio bloco de substituições/fechamento.
function raHtmlPorLocal(titulo, locais, cfg) {
  return locais.map((loc, i) => `
    <div class="ra-pagina">
      ${raHtmlTimbre(titulo, null, cfg, i + 1)}
      <div class="ra-linha-info"><span><b>Eleição:</b> ${raEsc(cfg.eleicaoNome)}</span></div>
      <div class="ra-linha-info">
        <span><b>Município:</b> ${raEsc(loc.municipio || '—')}</span>
        <span><b>Local de Votação:</b> ${raEsc(loc.local_nome)}</span>
        <span><b>Forma de Auxílio:</b> ${raEsc(cfg.forma)} &nbsp; <b>Valor:</b> ${raFmtValor(cfg.valor)}</span>
      </div>
      <table class="ra-tabela">
        <colgroup><col class="ra-col-insc"><col><col class="ra-col-func"><col class="ra-col-assin"></colgroup>
        <thead><tr><th>Inscrição</th><th>Nome</th><th>Função</th><th>Assinatura</th></tr></thead>
        <tbody>${loc.pessoas.map(p => `
          <tr>
            <td>${raEsc(p.inscricao || '—')}</td>
            <td>${raEsc(p.nome)}</td>
            <td>${raEsc(p.funcaoLabel)}</td>
            <td class="ra-linha-assin"></td>
          </tr>`).join('')}</tbody>
      </table>
      ${raHtmlSubstituicoes(false)}
      ${raHtmlObs()}
      ${raHtmlRodapeTotal(loc.local_nome)}
    </div>`).join('');
}

// Lista única, sem agrupar por local — auxiliares de eleição (geral) e
// junta eleitoral: um recibo só pro grupo inteiro da zona, não por prédio.
function raHtmlListaFlat(titulo, subtituloDia, pessoas, cfg, localTexto, numeroPagina) {
  return `
    <div class="ra-pagina">
      ${raHtmlTimbre(titulo, subtituloDia, cfg, numeroPagina)}
      <div class="ra-linha-info">
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
      ${raHtmlSubstituicoes(false)}
      ${raHtmlObs()}
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
  const secoes = raAgruparPorSecao(raDados.mesarios);
  const html = raHtmlMesaReceptora(secoes, raCfg());
  await raImprimirDocumento(html, 'recibo_alimentacao_mesa_impresso', raDados.mesarios.length);
}

async function raImprimirCoordenadores() {
  if (!raDados.coord.length) { showToast('⚠ Nenhum coordenador de acessibilidade ativo'); return; }
  const locais = raAgruparPorLocal(raDados.coord);
  const html = raHtmlPorLocal('Recibo de Auxílio Alimentação — Coordenador de Acessibilidade', locais, raCfg());
  await raImprimirDocumento(html, 'recibo_alimentacao_coord_impresso', raDados.coord.length);
}

async function raImprimirAuxiliares() {
  if (!raDados.auxiliares.length) { showToast('⚠ Nenhum auxiliar de eleição ativo'); return; }
  const pessoas = raListaFlatOrdenada(raDados.auxiliares);
  const cfg = raCfg();
  const html =
    raHtmlListaFlat('Recibo de Auxílio Alimentação — Auxiliares de Eleição', 'Sábado (D-1)', pessoas, cfg, cfg.zonaTexto, 1) +
    raHtmlListaFlat('Recibo de Auxílio Alimentação — Auxiliares de Eleição', 'Domingo (Dia D)', pessoas, cfg, cfg.zonaTexto, 2);
  await raImprimirDocumento(html, 'recibo_alimentacao_auxiliares_impresso', pessoas.length);
}

async function raImprimirJunta() {
  if (!raDados.junta.length) { showToast('⚠ Nenhum membro da junta eleitoral cadastrado'); return; }
  const pessoas = raListaFlatOrdenada(raDados.junta);
  const cfg = raCfg();
  const html = raHtmlListaFlat('Recibo de Auxílio Alimentação — Junta Eleitoral', null, pessoas, cfg, cfg.zonaTexto, 1);
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

// ── Controle de pagamento (25/09/2026) — ver comentário/estado no topo do
// arquivo. Marca/desmarca `sime_atores.auxilio_alimentacao_pago` e edita o
// valor pago por pessoa — nunca mexe no documento impresso acima (são
// coisas separadas: um é o papel assinado pra prestação de contas, o outro
// é "quem já recebeu de verdade" pro cartório acompanhar). ──
function raPagFiltrar() {
  const q = raPagBusca.trim().toLowerCase();
  return (raDados.todos || []).filter(a => {
    if (raPagFiltroStatus === 'pago' && !a.auxilio_alimentacao_pago) return false;
    if (raPagFiltroStatus === 'pendente' && a.auxilio_alimentacao_pago) return false;
    if (q) {
      const secaoTxt = a.sec ? String(a.sec.numero) : '';
      if (!`${a.nome_completo} ${secaoTxt}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a, b) => a.nome_completo.localeCompare(b.nome_completo));
}
function raOnPagBuscaInput(v) {
  raPagBusca = v;
  clearTimeout(raPagBuscaTimer);
  raPagBuscaTimer = setTimeout(renderControlePagamento, 250);
}
function raPagMudarFiltroStatus(v) {
  raPagFiltroStatus = v;
  renderControlePagamento();
}
function raPagResumo() {
  const todos = raDados.todos || [];
  const pagos = todos.filter(a => a.auxilio_alimentacao_pago);
  const totalPago = pagos.reduce((s, a) => s + Number(a.auxilio_alimentacao_valor_pago || 0), 0);
  return { total: todos.length, pagos: pagos.length, totalPago };
}

// Checkbox "Pago" — marcar grava o VALOR já digitado no campo ao lado
// (nunca um valor cravado: cada função recebe um valor diferente na
// prática — mesário R$260, coordenador/auxiliar R$65, visto no lote real
// de pagamentos de 25/09/2026 — bem diferente do
// `sime_eleicoes.valor_auxilio_alimentacao` único usado só como sugestão
// inicial no campo). Desmarcar limpa a data (deixou de estar pago agora),
// mas mantém o valor no campo — é só um número de referência, não afirma
// nada sozinho sem o checkbox marcado.
async function raTogglePago(atorId, marcarPago) {
  const sb = window.supabaseAtores;
  const pessoa = (raDados.todos || []).find(a => a.id === atorId);
  if (!pessoa) return;
  const valorEl = document.getElementById(`ra-pag-valor-${atorId}`);
  const valorDigitado = valorEl ? parseFloat(String(valorEl.value).replace(',', '.')) : NaN;
  const payload = marcarPago
    ? { auxilio_alimentacao_pago: true, auxilio_alimentacao_valor_pago: (valorDigitado >= 0 ? valorDigitado : raCfg().valor), auxilio_alimentacao_pago_em: new Date().toISOString() }
    : { auxilio_alimentacao_pago: false, auxilio_alimentacao_pago_em: null };
  const { error } = await sb.from('sime_atores').update(payload).eq('id', atorId);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); renderControlePagamento(); return; }
  Object.assign(pessoa, payload);
  await log(marcarPago ? 'mesario_auxilio_alimentacao_pago' : 'mesario_auxilio_alimentacao_despago', '', { ator_id: atorId, nome: pessoa.nome_completo, valor: pessoa.auxilio_alimentacao_valor_pago });
  showToast(marcarPago ? '✓ Marcado como pago' : '↺ Voltou a pendente');
  renderControlePagamento();
}

// Valor editável independente do checkbox (onblur salva sozinho, mesmo
// padrão já usado pro campo de PIX no modal de Contatar Mesários) — dá pra
// corrigir o valor de alguém já marcado como pago sem precisar desmarcar e
// marcar de novo.
async function raSalvarValorPago(atorId, valorStr) {
  const valor = parseFloat(String(valorStr).replace(',', '.'));
  if (!(valor >= 0)) { showToast('⚠ Valor inválido'); renderControlePagamento(); return; }
  const pessoa = (raDados.todos || []).find(a => a.id === atorId);
  if (!pessoa || Number(pessoa.auxilio_alimentacao_valor_pago) === valor) return;
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_atores').update({ auxilio_alimentacao_valor_pago: valor }).eq('id', atorId);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return; }
  pessoa.auxilio_alimentacao_valor_pago = valor;
  await log('mesario_auxilio_alimentacao_valor_editado', '', { ator_id: atorId, nome: pessoa.nome_completo, valor });
}

function renderControlePagamento() {
  const alvo = document.getElementById('ra-controle-pagamento');
  if (!alvo) return;
  const buscaEl = document.getElementById('ra-pag-busca');
  const buscaAtiva = document.activeElement === buscaEl;
  const buscaSelStart = buscaAtiva ? buscaEl.selectionStart : null;
  const buscaSelEnd = buscaAtiva ? buscaEl.selectionEnd : null;

  const lista = raPagFiltrar();
  const resumo = raPagResumo();
  const cfg = raCfg();

  alvo.innerHTML = `
    <div class="ic-sub" style="margin:0 0 8px">${resumo.pagos} de ${resumo.total} já pagos — total pago: ${raFmtValor(resumo.totalPago)}.</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      <input type="text" id="ra-pag-busca" value="${raEsc(raPagBusca)}" oninput="raOnPagBuscaInput(this.value)" placeholder="Buscar por nome ou seção…" style="flex:1;min-width:160px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
      <select onchange="raPagMudarFiltroStatus(this.value)" style="padding:8px 10px;border-radius:7px">
        <option value="pendente" ${raPagFiltroStatus === 'pendente' ? 'selected' : ''}>Pendentes</option>
        <option value="pago" ${raPagFiltroStatus === 'pago' ? 'selected' : ''}>Pagos</option>
        <option value="" ${raPagFiltroStatus === '' ? 'selected' : ''}>Todos</option>
      </select>
    </div>
    <div class="m-hist" style="max-height:480px;overflow-y:auto">
      ${lista.length ? lista.map(a => `
      <div class="m-hist-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <span>
          <b>${raEsc(a.nome_completo)}</b> — ${raEsc(raFuncaoLabel(a))}${a.sec ? ` — Seção ${a.sec.numero}` : ''}
          ${a.auxilio_alimentacao_pago_em ? `<span class="ic-sub" style="margin-left:6px">pago em ${raFmtDataHora(new Date(a.auxilio_alimentacao_pago_em))}</span>` : ''}
        </span>
        <span style="display:flex;align-items:center;gap:6px">
          <span style="font-size:.75rem">R$</span>
          <input type="text" id="ra-pag-valor-${a.id}" value="${a.auxilio_alimentacao_valor_pago != null ? Number(a.auxilio_alimentacao_valor_pago).toFixed(2) : cfg.valor.toFixed(2)}" onblur="raSalvarValorPago('${a.id}', this.value)" style="width:70px">
          <label style="display:flex;align-items:center;gap:4px;font-size:.8rem;cursor:pointer">
            <input type="checkbox" ${a.auxilio_alimentacao_pago ? 'checked' : ''} onchange="raTogglePago('${a.id}', this.checked)"> Pago
          </label>
        </span>
      </div>`).join('') : '<div class="ic-sub" style="margin:0">Nenhum registro encontrado.</div>'}
    </div>`;
  if (buscaAtiva) {
    const el = document.getElementById('ra-pag-busca');
    if (el) { el.focus(); try { el.setSelectionRange(buscaSelStart, buscaSelEnd); } catch (e) { /* ignora */ } }
  }
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
      <div class="ic-sub">Presidente + 1º/2º Mesário + 1º Secretário — uma folha por seção, com timbre
        institucional, mesmo modelo do ELO.</div>
      <button class="btn btn-dark" style="margin-top:8px" ${!raDados.mesarios.length ? 'disabled' : ''} onclick="raImprimirMesaReceptora()">🖨️ Imprimir recibos — Mesa Receptora</button>
    </div>

    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">♿ Coordenador de Acessibilidade (${raDados.coord.length})</div>
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
      <div class="ic-sub">Recibo geral, em lista única, um único dia. O Presidente da Junta (o Juiz Eleitoral,
        por lei) nunca entra aqui — ele não assina esse auxílio.</div>
      <button class="btn btn-dark" style="margin-top:8px" ${!raDados.junta.length ? 'disabled' : ''} onclick="raImprimirJunta()">🖨️ Imprimir recibo — Junta Eleitoral</button>
    </div>

    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">💰 Controle de pagamento</div>
      <div class="ic-sub">Quem já recebeu o auxílio de verdade — separado do documento impresso acima (aquele é só
        o papel pra assinatura, este é o controle interno do cartório). Valor por pessoa, editável (varia por
        função — ex.: mesário e coordenador/auxiliar costumam receber valores diferentes).</div>
      <div id="ra-controle-pagamento" style="margin-top:8px"></div>
    </div>
  `;
  renderControlePagamento();
}
