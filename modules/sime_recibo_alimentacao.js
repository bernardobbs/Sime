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

// ── Controle de pagamento + frequência/devolução, UNIFICADOS (08/10/2026,
// pedido direto: "quero unificar o controle de pagamento e frequencia e
// devolução") — até aqui eram duas sub-abas separadas ("💰 Controle de
// pagamento", 25/09/2026, e "📋 Frequência e Devolução", 05-06/10/2026),
// cada uma com sua própria busca/filtro/lista, mas iterando exatamente o
// MESMO `raDados.todos` — a mesma pessoa aparecia nas duas abas, pra marcar
// pix/valor numa e frequência/devolução noutra. Virou uma lista só, com os
// dois grupos de controle na mesma linha (ver `raHtmlSecaoControle`/
// `renderControleUnificado` mais abaixo) — estado único, nunca duplicado.
let raCtlBusca = '';
let raCtlBuscaTimer = null;
let raCtlFiltroPago = 'pendente'; // '' (todos) | 'pago' | 'pendente' — abre em "pendente" (visão mais acionável)
let raCtlFiltroSituacao = ''; // '' | 'presente' | 'deve_devolver' | 'devolvido' | 'sem_marcar' | 'recibo_ausente'

// Filtro por função (30/09/2026, pedido direto: "quero poder filtrar
// somente os presidentes, somente os coordenadores ou somente os
// auxiliares") + por município (mesmo pedido, "e filtrar por municipio
// também") — mesmo padrão já usado em "Contatar mesários"
// (CM_FUNCAO_FILTRO/cmFiltroMunicipio, sime_contatar_mesarios.js), filtros
// independentes que se combinam entre si e com a busca.
// "Presidente" continua sendo o rótulo, não "Mesário" — `raDados.todos`
// já filtra a mesa receptora só pro Presidente (ver raCarregar()), então
// todo registro `funcao==='mesario'` aqui É um Presidente.
const RA_FUNCAO_FILTRO = [
  { valor: '', label: 'Todas as funções' },
  { valor: 'mesario', label: 'Presidente (Mesa Receptora)' },
  { valor: 'coord_acessibilidade', label: 'Coordenador(a) de Acessibilidade' },
  { valor: 'auxiliar_eleicao', label: 'Auxiliar de Serviços Eleitorais' },
  { valor: 'junta_eleitoral', label: 'Membro da Junta Eleitoral' },
];
let raCtlFiltroFuncao = '';
let raCtlFiltroMunicipio = '';

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
    sb.from('sime_eleicoes').select('id, nome, turno, data_d, valor_auxilio_alimentacao, forma_auxilio_alimentacao, pix_devolucao_chave, pix_devolucao_nome')
      .eq('zona_id', zonaId).eq('ativa', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('sime_atores')
      .select('id, nome_completo, funcao, funcao_mesa, secao_id, inscricao_eleitoral, auxilio_alimentacao_pago, auxilio_alimentacao_valor_pago, auxilio_alimentacao_pago_em, auxilio_alimentacao_documento, auxilio_alimentacao_frequencia, auxilio_alimentacao_devolvido, auxilio_alimentacao_devolvido_em, auxilio_alimentacao_devolucao_documento, auxilio_alimentacao_recibo_ausente, pix, observacao')
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
    // recibo quanto ao Juiz Eleitoral (nunca entra, não recebe esse
    // auxílio), MAIS uma regra própria (25/09/2026, pedido direto: "só
    // faremos pagamento para os presidente... que se encarregará de
    // repassar os outros membros da mesa"): da mesa receptora, só o
    // PRESIDENTE recebe pagamento direto do cartório — 1º/2º Mesário e 1º
    // Secretário nunca aparecem aqui (o presidente repassa em mãos, fora do
    // sistema). Coordenador de acessibilidade e auxiliar de eleição
    // continuam todos, sem essa restrição — o pedido foi só sobre a mesa.
    todos: (atores || []).filter(a => !raEhJuizEleitoral(a) && (a.funcao !== 'mesario' || a.funcao_mesa === 'Presidente')),
  };
  raDados.conflitosPorTitulo = raCalcularConflitosPorTitulo(raDados.todos);
  raDados.presidentePorLocal = raCalcularPresidentePorLocal(raDados.mesarios);
  await raCarregarVeiculos(zonaId); // 🚙 Motoristas de Repartições — nunca lança, ver raCarregarVeiculos
  render();
}

// Mapa local (município+local_nome) -> Presidente da seção de MENOR número
// ali (01/10/2026, pedido direto: "o pix dos coordenadores de
// acessibilidade que não foram feitos ainda, deve ser feito para o
// presidente da seção de menor numero do local" — mesmo critério já usado
// no relatório de pendências de PIX gerado antes, agora embutido direto no
// Controle de Pagamento). Calculado uma vez a partir dos mesários já
// carregados em raCarregar() — nunca uma consulta nova. Só considera
// `funcao_mesa==='Presidente'` (os outros 3 cargos de mesa nunca entram
// neste controle, ver `raDados.todos` acima) e só quem resolveu seção.
function raCalcularPresidentePorLocal(mesarios) {
  const melhorPorLocal = {};
  for (const m of mesarios) {
    if (m.funcao_mesa !== 'Presidente' || !m.sec) continue;
    const chave = `${m.sec.municipio}|||${m.sec.local_nome}`;
    const atual = melhorPorLocal[chave];
    if (!atual || m.sec.numero < atual.sec.numero) melhorPorLocal[chave] = m;
  }
  return melhorPorLocal;
}

// "1074 - SECRETARIA MUNICIPAL DE EDUCAÇÃO" -> "SECRETARIA MUNICIPAL DE
// EDUCAÇÃO" — só pra exibição/descrição do PIX (nunca usado como chave de
// agrupamento, que continua sendo local_nome completo com código, mesma
// convenção de sempre). O código do TSE não interessa pra quem só quer ler
// o nome do prédio na tela do banco.
function raNomeLocalSemCodigo(localNome) {
  return String(localNome || '').replace(/^\d+\s*-\s*/, '').trim();
}

// Decide a chave/nome/descrição PIX que o QR do Controle de Pagamento deve
// usar. Coordenador(a) de Acessibilidade: SEMPRE o Presidente da seção de
// menor número do local (`raCalcularPresidentePorLocal` acima) — mesmo
// quando o próprio coordenador já tem PIX cadastrado (nunca usado pra
// pagar este cargo, ver nota em `raCarregar`). Sem local resolvido, ou sem
// nenhum Presidente ativo encontrado pra ele, não há destino — nunca
// inventa um substituto. Demais funções continuam pagas na própria chave,
// sem mudança nenhuma.
function raDestinoPix(p) {
  if (p.funcao === 'coord_acessibilidade' && p.sec) {
    const chave = `${p.sec.municipio}|||${p.sec.local_nome}`;
    const presidente = raDados.presidentePorLocal?.[chave];
    if (presidente && presidente.pix) {
      const localSemCodigo = raNomeLocalSemCodigo(p.sec.local_nome);
      return {
        chavePix: presidente.pix,
        nomeDestinatario: presidente.nome_completo,
        descricao: `Eleições 2026 - Coordenador de Acessibilidade${localSemCodigo ? ` - ${localSemCodigo}` : ''}`,
        viaPresidente: true,
        presidenteNome: presidente.nome_completo,
        presidenteSecao: presidente.sec.numero,
      };
    }
  }
  return { chavePix: p.pix, nomeDestinatario: p.nome_completo, descricao: raPixDescricao(p), viaPresidente: false };
}

// Mesma pessoa (mesmo título de eleitor) segurando mais de um papel ATIVO
// ao mesmo tempo no universo de pagamento (26/09/2026, achado real em
// auditoria): Adriana Paz Oliveira é Presidente de uma seção E
// Coordenadora de Acessibilidade de outra ao mesmo tempo — sem nenhum
// aviso cruzado entre as duas linhas, dava pra marcar as duas como pagas
// sem perceber que é a mesma pessoa recebendo por um trabalho que só vai
// fazer uma vez (fisicamente não dá pra presidir mesa fixa e circular como
// coordenador ao mesmo tempo — mesmo "conflito de papel" que o Dashboard
// de Convocação já sinaliza como alerta, `rsConflitoMesarioComoCoord`).
// Diferente do caso de Anita Alves de Oliveira/Luiz Carlos Santiago
// Junior, que legitimamente acumulam Presidente + Auxiliar de Eleição e
// são pagos nos dois de propósito (a própria planilha original do lote
// real de pagamentos já separava os dois cargos) — nunca bloqueia aqui,
// só avisa; o cartório decide qual papel de fato paga.
function raCalcularConflitosPorTitulo(todos) {
  const porTitulo = {};
  for (const a of todos) {
    if (!a.inscricao_eleitoral) continue;
    (porTitulo[a.inscricao_eleitoral] = porTitulo[a.inscricao_eleitoral] || []).push(a);
  }
  const conflitos = {};
  for (const [titulo, lista] of Object.entries(porTitulo)) {
    if (lista.length > 1) conflitos[titulo] = lista;
  }
  return conflitos;
}

// Outros papéis ATIVOS da MESMA pessoa (mesmo título) no universo de
// pagamento, exceto o próprio — [] quando não há nenhum conflito.
function raOutrosPapeis(a) {
  if (!a.inscricao_eleitoral) return [];
  const lista = raDados.conflitosPorTitulo?.[a.inscricao_eleitoral];
  if (!lista) return [];
  return lista.filter(o => o.id !== a.id);
}

function raCfg() {
  const hoje = new Date();
  const dataStr = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
  const dataHoraStr = raFmtDataHora(hoje);
  const valor = Number(raDados.eleicao?.valor_auxilio_alimentacao ?? 65);
  const forma = raDados.eleicao?.forma_auxilio_alimentacao || 'DINHEIRO';
  const eleicaoNome = raEleicaoTexto(raDados.eleicao);
  const zonaTexto = raDados.zona?.numero ? `${raDados.zona.numero}ª Zona Eleitoral${raDados.zona.municipio ? ` — ${raDados.zona.municipio}` : ''}` : 'Zona Eleitoral';
  // Destino do PIX de devolução (06/10/2026) — chave/nome configuráveis pelo
  // cartório (ver "⚙️ Configuração do auxílio"), nunca cravados: sem chave
  // cadastrada, nenhum QR de devolução é desenhado (nem no modal, nem nos
  // recibos impressos) — nunca inventa um destino.
  const pixDevolucaoChave = raDados.eleicao?.pix_devolucao_chave || '';
  const pixDevolucaoNome = raDados.eleicao?.pix_devolucao_nome || '';
  return { valor, forma, eleicaoNome, dataStr, dataHoraStr, zonaTexto, pixDevolucaoChave, pixDevolucaoNome };
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
// Bloco impresso do QR de devolução (06/10/2026, pedido direto: "nos
// recibos um qrcode para a devolução do valor pago") — só existe quando há
// destino configurado (ver raSalvarConfigDevolucao); sem isso, a página sai
// EXATAMENTE como antes, sem o bloco, sem nenhuma mudança de layout.
// `qrOut` (array compartilhado por todas as páginas de um mesmo documento)
// recebe o payload no índice `idSuffix` — `raImprimirDocumento` desenha os
// canvases depois que o HTML inteiro já estiver no DOM (`new QRCode()`
// precisa do elemento já presente na página).
function raHtmlBlocoQrDevolucaoImpresso(cfg, descricao, idSuffix, qrOut) {
  const payload = raPayloadDevolucao(cfg, descricao);
  if (qrOut) qrOut[idSuffix] = payload;
  if (!payload) return '';
  return `
    <div class="ra-qr-dev-impresso">
      <div id="ra-qr-dev-canvas-${idSuffix}" class="ra-qr-dev-canvas"></div>
      <div class="ra-qr-dev-label">📲 PIX para devolução (se houver falta) — ${raEsc(descricao)}</div>
    </div>`;
}

function raHtmlMesaReceptora(secoes, cfg, qrOut) {
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
      ${raHtmlBlocoQrDevolucaoImpresso(cfg, `Eleições 2026 - Devolução - Seção ${s.numero}`, i, qrOut)}
      ${raHtmlRodapeTotal(`Seção ${s.numero} — ${s.local_nome}`)}
    </div>`).join('');
}

// Um "recibo" por LOCAL de votação — coordenador de acessibilidade
// continua neste formato (não é "por seção": um coordenador cobre o
// prédio inteiro, não uma mesa específica): várias pessoas do mesmo
// prédio na mesma página, quebra a cada troca de local, cada página com
// seu próprio bloco de substituições/fechamento.
function raHtmlPorLocal(titulo, locais, cfg, qrOut) {
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
      ${raHtmlBlocoQrDevolucaoImpresso(cfg, `Eleições 2026 - Devolução - ${raNomeLocalSemCodigo(loc.local_nome)}`, i, qrOut)}
      ${raHtmlRodapeTotal(loc.local_nome)}
    </div>`).join('');
}

// Lista única, sem agrupar por local — auxiliares de eleição (geral) e
// junta eleitoral: um recibo só pro grupo inteiro da zona, não por prédio.
function raHtmlListaFlat(titulo, subtituloDia, pessoas, cfg, localTexto, numeroPagina, idSuffix, qrOut) {
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
      ${raHtmlBlocoQrDevolucaoImpresso(cfg, `Eleições 2026 - Devolução - ${localTexto}`, idSuffix ?? 0, qrOut)}
      ${raHtmlRodapeTotal(localTexto)}
    </div>`;
}

async function raImprimirDocumento(html, acaoLog, quantidade, qrPayloads) {
  const area = document.getElementById('print-area');
  area.innerHTML = html;
  // QR de devolução (06/10/2026) — desenhado AQUI, depois do HTML inteiro
  // já estar no DOM (`new QRCode()` precisa do elemento `#ra-qr-dev-canvas-N`
  // já presente). Sem nenhum payload configurado (zona sem destino de
  // devolução cadastrado), o array vem cheio de `null`/vazio e este laço
  // não desenha nada — impressão sai idêntica a antes desta feature.
  if (Array.isArray(qrPayloads) && window.QRCode) {
    qrPayloads.forEach((payload, i) => {
      if (!payload) return;
      const el = document.getElementById(`ra-qr-dev-canvas-${i}`);
      if (!el) return;
      el.innerHTML = '';
      try { new QRCode(el, { text: payload, width: 90, height: 90, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M }); } catch (e) { /* nunca trava a impressão por causa do QR */ }
    });
  }
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log(acaoLog, '', { autor, quantidade });
  window.print();
}

async function raImprimirMesaReceptora() {
  if (!raDados.mesarios.length) { showToast('⚠ Nenhum mesário ativo pra gerar recibo'); return; }
  const secoes = raAgruparPorSecao(raDados.mesarios);
  const qrPayloads = [];
  const html = raHtmlMesaReceptora(secoes, raCfg(), qrPayloads);
  await raImprimirDocumento(html, 'recibo_alimentacao_mesa_impresso', raDados.mesarios.length, qrPayloads);
}

async function raImprimirCoordenadores() {
  if (!raDados.coord.length) { showToast('⚠ Nenhum coordenador de acessibilidade ativo'); return; }
  const locais = raAgruparPorLocal(raDados.coord);
  const qrPayloads = [];
  const html = raHtmlPorLocal('Recibo de Auxílio Alimentação — Coordenador de Acessibilidade', locais, raCfg(), qrPayloads);
  await raImprimirDocumento(html, 'recibo_alimentacao_coord_impresso', raDados.coord.length, qrPayloads);
}

async function raImprimirAuxiliares() {
  if (!raDados.auxiliares.length) { showToast('⚠ Nenhum auxiliar de eleição ativo'); return; }
  const pessoas = raListaFlatOrdenada(raDados.auxiliares);
  const cfg = raCfg();
  const qrPayloads = [];
  const html =
    raHtmlListaFlat('Recibo de Auxílio Alimentação — Auxiliares de Eleição', 'Sábado (D-1)', pessoas, cfg, cfg.zonaTexto, 1, 0, qrPayloads) +
    raHtmlListaFlat('Recibo de Auxílio Alimentação — Auxiliares de Eleição', 'Domingo (Dia D)', pessoas, cfg, cfg.zonaTexto, 2, 1, qrPayloads);
  await raImprimirDocumento(html, 'recibo_alimentacao_auxiliares_impresso', pessoas.length, qrPayloads);
}

async function raImprimirJunta() {
  if (!raDados.junta.length) { showToast('⚠ Nenhum membro da junta eleitoral cadastrado'); return; }
  const pessoas = raListaFlatOrdenada(raDados.junta);
  const cfg = raCfg();
  const qrPayloads = [];
  const html = raHtmlListaFlat('Recibo de Auxílio Alimentação — Junta Eleitoral', null, pessoas, cfg, cfg.zonaTexto, 1, 0, qrPayloads);
  await raImprimirDocumento(html, 'recibo_alimentacao_junta_impresso', pessoas.length, qrPayloads);
}

// ── Relatório de pagamentos (01/10/2026, pedido direto: "gere um relatorio
// no sime para a impressão dos valores pagos e os documentos atribuidos")
// — depois de uma conferência manual do extrato bancário (fora do SIME)
// atribuir `auxilio_alimentacao_documento` (nº do Pix no extrato) a cada
// pessoa já marcada como paga, faltava um jeito de IMPRIMIR essa lista —
// até aqui só dava pra ver na tela (aba "💰 Controle de pagamento"), sem
// nenhum documento pra guardar/levar fisicamente. Mesmo mecanismo
// `#print-area`/`window.print()` de sempre; reaproveita `.ra-pagina`/
// `.ra-tabela`/`raHtmlTimbre()` já usados pelos 4 recibos de assinatura
// acima (landscape, pautado) — é só mais um layout dentro do mesmo
// documento, não um formulário de assinatura (sem SUBSTITUIÇÕES/OBS/
// "Suprido" — aqui ninguém assina, é relatório de conferência).
//
// Sempre só quem JÁ está `auxilio_alimentacao_pago=true` — nunca lista
// pendente (imprimir "valores pagos" de quem não foi pago não faz
// sentido) — por isso ignora deliberadamente `raCtlFiltroPago` (que na
// tela pode estar em "Pendentes") e aplica só função/município/busca, que
// continuam valendo pra deixar o relatório restrito ao recorte que o
// cartório já tiver filtrado na tela antes de imprimir.
function raListaPagosRelatorio() {
  const q = raCtlBusca.trim().toLowerCase();
  return (raDados.todos || []).filter(a => {
    if (!a.auxilio_alimentacao_pago) return false;
    if (raCtlFiltroFuncao && a.funcao !== raCtlFiltroFuncao) return false;
    if (raCtlFiltroMunicipio && (a.sec?.municipio || '') !== raCtlFiltroMunicipio) return false;
    if (q) {
      const secaoTxt = a.sec ? String(a.sec.numero) : '';
      if (!`${a.nome_completo} ${secaoTxt}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a, b) => a.nome_completo.localeCompare(b.nome_completo));
}

function raHtmlRelatorioPagamentos(lista, cfg) {
  const total = lista.reduce((s, a) => s + Number(a.auxilio_alimentacao_valor_pago || 0), 0);
  return `
    <div class="ra-pagina">
      ${raHtmlTimbre('Relatório de Pagamentos — Auxílio Alimentação', 'Controle interno do cartório — valores pagos e documentos atribuídos', cfg, 1)}
      <table class="ra-tabela">
        <colgroup><col class="ra-col-insc"><col><col class="ra-col-func"><col style="width:10%"><col style="width:12%"><col style="width:14%"></colgroup>
        <thead><tr><th>Inscrição</th><th>Nome</th><th>Função</th><th>Seção</th><th>Valor</th><th>Documento</th></tr></thead>
        <tbody>${lista.map(p => `
          <tr>
            <td>${raEsc(p.inscricao_eleitoral || '—')}</td>
            <td>${raEsc(p.nome_completo)}</td>
            <td>${raEsc(raFuncaoLabel(p))}</td>
            <td>${p.sec ? p.sec.numero : '—'}</td>
            <td>${raFmtValor(p.auxilio_alimentacao_valor_pago)}</td>
            <td>${raEsc(p.auxilio_alimentacao_documento || '—')}</td>
          </tr>`).join('')}</tbody>
      </table>
      <div class="ra-rodape-total">
        <div><b>Total pago:</b> ${raFmtValor(total)} &nbsp; (${lista.length} pagamento${lista.length === 1 ? '' : 's'})</div>
      </div>
    </div>`;
}

async function raImprimirRelatorioPagamentos() {
  const lista = raListaPagosRelatorio();
  if (!lista.length) { showToast('⚠ Nenhum pagamento registrado pra imprimir (confira os filtros aplicados na tela)'); return; }
  const html = raHtmlRelatorioPagamentos(lista, raCfg());
  await raImprimirDocumento(html, 'recibo_alimentacao_relatorio_pagamentos_impresso', lista.length);
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

// Destino do PIX de devolução (06/10/2026) — campo próprio, nunca misturado
// com valor/forma acima: é opcional (nunca bloqueia nada enquanto ninguém
// preenche) e some sozinho do modal/dos recibos impressos até ser
// configurado, mesma filosofia de "nunca inventa destino" de sempre.
async function raSalvarConfigDevolucao() {
  if (!raDados?.eleicao?.id) { showToast('⚠ Nenhuma eleição ativa nesta zona — não há onde salvar'); return; }
  const chave = document.getElementById('ra-pix-dev-chave').value.trim();
  const nome = document.getElementById('ra-pix-dev-nome').value.trim();
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_eleicoes')
    .update({ pix_devolucao_chave: chave || null, pix_devolucao_nome: nome || null })
    .eq('id', raDados.eleicao.id);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return; }
  raDados.eleicao.pix_devolucao_chave = chave || null;
  raDados.eleicao.pix_devolucao_nome = nome || null;
  await log('recibo_alimentacao_pix_devolucao_atualizado', '', { chave: chave || null, nome: nome || null });
  showToast('✓ Destino da devolução salvo');
  render();
}

// ── Janela unificada: agrupamento por cidade/local de votação (06/10/2026,
// pedido direto: "uma pagina unificada... agrupado por cidade, local de
// votação e seção") — compartilhado pelas duas listas interativas (Controle
// de pagamento e Frequência e Devolução). Quem não resolveu seção
// (coordenador sem local, auxiliar de eleição, junta eleitoral) vai pro
// grupo "Sem local definido", sempre por ÚLTIMO — nunca escondido, só sem
// como agrupar por prédio.
function raGrupoChave(a) {
  return a.sec ? `${a.sec.municipio}|||${a.sec.local_nome}` : '~~SEM LOCAL~~';
}
function raGrupoLabel(a) {
  return a.sec ? `${a.sec.municipio} — ${raNomeLocalSemCodigo(a.sec.local_nome)}` : '⚠ Sem local definido';
}
function raOrdenarAgrupado(lista) {
  return lista.slice().sort((a, b) => {
    const semA = !a.sec, semB = !b.sec;
    if (semA !== semB) return semA ? 1 : -1;
    if (a.sec && b.sec) {
      const cmpMun = a.sec.municipio.localeCompare(b.sec.municipio);
      if (cmpMun) return cmpMun;
      const cmpLocal = a.sec.local_nome.localeCompare(b.sec.local_nome);
      if (cmpLocal) return cmpLocal;
      if (a.sec.numero !== b.sec.numero) return a.sec.numero - b.sec.numero;
    }
    return a.nome_completo.localeCompare(b.nome_completo);
  });
}
// Monta a lista HTML com um cabeçalho de grupo (`.ra-grupo-cabecalho`) toda
// vez que a chave de agrupamento muda — a lista já vem ORDENADA por
// `raOrdenarAgrupado`, então só precisa detectar a transição, sem reagrupar
// em memória (mantém o mesmo formato plano de sempre, só injeta divisores).
function raHtmlListaComGrupos(lista, renderItem) {
  if (!lista.length) return '<div class="ic-sub" style="margin:0">Nenhum registro encontrado.</div>';
  let html = '';
  let grupoAtual = null;
  for (const a of lista) {
    const chave = raGrupoChave(a);
    if (chave !== grupoAtual) {
      grupoAtual = chave;
      html += `<div class="ra-grupo-cabecalho">${raEsc(raGrupoLabel(a))}</div>`;
    }
    html += renderItem(a);
  }
  return html;
}

// ── Controle de pagamento (25/09/2026) — ver comentário/estado no topo do
// arquivo. Marca/desmarca `sime_atores.auxilio_alimentacao_pago` e edita o
// valor pago por pessoa — nunca mexe no documento impresso acima (são
// coisas separadas: um é o papel assinado pra prestação de contas, o outro
// é "quem já recebeu de verdade" pro cartório acompanhar). ──
// Filtro combinado do controle unificado (08/10/2026) — cada condição é
// independente e se combina com as demais (AND): status de pagamento,
// situação de frequência/devolução, função, município e busca. Depende de
// `raDeveDevolver`/`raMesaTodosPresentes`/`raMesaNenhumMarcado`/
// `raMesaReciboAusente`, todas declaradas mais abaixo no arquivo — hoisting
// de `function` garante que já estão disponíveis em qualquer chamada em
// tempo de execução, não importa a ordem textual.
function raCtlFiltrar() {
  const q = raCtlBusca.trim().toLowerCase();
  const filtrados = (raDados.todos || []).filter(a => {
    if (raCtlFiltroPago === 'pago' && !a.auxilio_alimentacao_pago) return false;
    if (raCtlFiltroPago === 'pendente' && a.auxilio_alimentacao_pago) return false;
    if (raCtlFiltroFuncao && a.funcao !== raCtlFiltroFuncao) return false;
    if (raCtlFiltroMunicipio && (a.sec?.municipio || '') !== raCtlFiltroMunicipio) return false;
    if (raCtlFiltroSituacao === 'presente') {
      const ok = a.funcao === 'mesario' ? raMesaTodosPresentes(a.secao_id) : a.auxilio_alimentacao_frequencia === 'presente';
      if (!ok) return false;
    }
    if (raCtlFiltroSituacao === 'deve_devolver' && !raDeveDevolver(a)) return false;
    if (raCtlFiltroSituacao === 'devolvido' && !a.auxilio_alimentacao_devolvido) return false;
    if (raCtlFiltroSituacao === 'sem_marcar') {
      const ok = a.funcao === 'mesario' ? raMesaNenhumMarcado(a.secao_id) : !a.auxilio_alimentacao_frequencia;
      if (!ok) return false;
    }
    if (raCtlFiltroSituacao === 'recibo_ausente' && !(a.funcao === 'mesario' && raMesaReciboAusente(a.secao_id))) return false;
    if (q) {
      const secaoTxt = a.sec ? String(a.sec.numero) : '';
      if (!`${a.nome_completo} ${secaoTxt}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  return raOrdenarAgrupado(filtrados);
}
function raOnCtlBuscaInput(v) {
  raCtlBusca = v;
  clearTimeout(raCtlBuscaTimer);
  raCtlBuscaTimer = setTimeout(renderControleUnificado, 250);
}
function raCtlMudarFiltroPago(v) {
  raCtlFiltroPago = v;
  renderControleUnificado();
}
function raCtlMudarFiltroSituacao(v) {
  raCtlFiltroSituacao = v;
  renderControleUnificado();
}
function raCtlMudarFiltroFuncao(v) {
  raCtlFiltroFuncao = v;
  renderControleUnificado();
}
function raCtlMudarFiltroMunicipio(v) {
  raCtlFiltroMunicipio = v;
  renderControleUnificado();
}
// Resumo combinado — campos de pagamento (pagos/totalPago/conflitos) e de
// frequência/devolução (deveDevolver/jaDevolveram/semMarcar/reciboAusente),
// usado tanto no cabeçalho da aba (`renderReciboAlimentacao`) quanto na
// linha de resumo da lista (`renderControleUnificado`).
function raCtlResumo() {
  const todos = raDados.todos || [];
  const pagos = todos.filter(a => a.auxilio_alimentacao_pago);
  const totalPago = pagos.reduce((s, a) => s + Number(a.auxilio_alimentacao_valor_pago || 0), 0);
  const conflitos = todos.filter(a => raOutrosPapeis(a).length > 0).length;
  const deveDevolverLista = todos.filter(raDeveDevolver);
  const jaDevolveramLista = todos.filter(a => a.auxilio_alimentacao_devolvido);
  return {
    total: todos.length, pagos: pagos.length, totalPago, conflitos,
    deveDevolver: deveDevolverLista.length,
    totalADevolver: deveDevolverLista.reduce((s, a) => s + raValorADevolver(a), 0),
    jaDevolveram: jaDevolveramLista.length,
    totalDevolvido: jaDevolveramLista.reduce((s, a) => s + raValorADevolver(a), 0),
    semMarcar: todos.filter(a => a.funcao === 'mesario' ? raMesaNenhumMarcado(a.secao_id) : !a.auxilio_alimentacao_frequencia).length,
    reciboAusente: todos.filter(a => a.funcao === 'mesario' && raMesaReciboAusente(a.secao_id)).length,
  };
}

// Valor SUGERIDO no campo (só um ponto de partida — o valor de fato salvo é
// sempre o que está no input na hora, nunca cravado). Regra real (25/09/2026,
// pedido direto): Presidente R$260 (repassa aos outros da mesa, que por isso
// nem aparecem aqui — ver filtro de `todos` em raCarregar); Auxiliar de
// Eleição R$65 por dia trabalhado — sugestão parte de 1 dia (só domingo),
// o seletor 🗓️ ao lado ajusta pra R$130 (sábado + domingo) quando for o
// caso; Coordenador de Acessibilidade continua no valor único configurado
// em `sime_eleicoes.valor_auxilio_alimentacao` (nunca teve distinção de dia
// nem de cargo, diferente dos outros dois).
const RA_VALOR_AUXILIAR_1_DIA = 65;
const RA_VALOR_AUXILIAR_2_DIAS = 130;
function raValorSugerido(a, cfg) {
  if (a.funcao === 'mesario') return 260; // só Presidente chega aqui
  if (a.funcao === 'auxiliar_eleicao') return RA_VALOR_AUXILIAR_1_DIA;
  return cfg.valor; // coordenador de acessibilidade
}

// Checkbox "Pago" — marcar grava o VALOR já digitado no campo ao lado
// (nunca um valor cravado: cada função recebe um valor diferente na
// prática — mesário R$260, coordenador/auxiliar R$65, visto no lote real
// de pagamentos de 25/09/2026 — bem diferente do
// `sime_eleicoes.valor_auxilio_alimentacao` único usado só como sugestão
// inicial no campo). Desmarcar limpa a data (deixou de estar pago agora),
// mas mantém o valor no campo — é só um número de referência, não afirma
// nada sozinho sem o checkbox marcado.
//
// Núcleo compartilhado (29/09/2026) entre a linha da lista e o modal de
// detalhe (raAbrirModal) — cada um só resolve QUAL input de valor ler
// (ids diferentes, pra não colidir com o elemento da lista escondida atrás
// do overlay) e QUANDO re-renderizar o quê.
async function raTogglePagoCore(atorId, marcarPago, valorDigitado) {
  const sb = window.supabaseAtores;
  const pessoa = (raDados.todos || []).find(a => a.id === atorId);
  if (!pessoa) return false;
  const payload = marcarPago
    ? { auxilio_alimentacao_pago: true, auxilio_alimentacao_valor_pago: (valorDigitado >= 0 ? valorDigitado : raCfg().valor), auxilio_alimentacao_pago_em: new Date().toISOString() }
    : { auxilio_alimentacao_pago: false, auxilio_alimentacao_pago_em: null };
  const { error } = await sb.from('sime_atores').update(payload).eq('id', atorId);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return false; }
  Object.assign(pessoa, payload);
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log(marcarPago ? 'mesario_auxilio_alimentacao_pago' : 'mesario_auxilio_alimentacao_despago', '', { ator_id: atorId, nome: pessoa.nome_completo, valor: pessoa.auxilio_alimentacao_valor_pago, autor });
  showToast(marcarPago ? '✓ Marcado como pago' : '↺ Voltou a pendente');
  return true;
}

async function raTogglePago(atorId, marcarPago) {
  const valorEl = document.getElementById(`ra-pag-valor-${atorId}`);
  const valorDigitado = valorEl ? parseFloat(String(valorEl.value).replace(',', '.')) : NaN;
  await raTogglePagoCore(atorId, marcarPago, valorDigitado);
  renderControleUnificado();
}

async function raModalTogglePago(atorId, marcarPago) {
  const valorEl = document.getElementById('ra-modal-valor');
  const valorDigitado = valorEl ? parseFloat(String(valorEl.value).replace(',', '.')) : NaN;
  await raTogglePagoCore(atorId, marcarPago, valorDigitado);
  renderControleUnificado();
  if (raModalId === atorId) raRenderModal();
}

// Valor editável independente do checkbox (onblur salva sozinho, mesmo
// padrão já usado pro campo de PIX no modal de Contatar Mesários) — dá pra
// corrigir o valor de alguém já marcado como pago sem precisar desmarcar e
// marcar de novo.
async function raSalvarValorPagoCore(atorId, valor) {
  const pessoa = (raDados.todos || []).find(a => a.id === atorId);
  if (!pessoa || Number(pessoa.auxilio_alimentacao_valor_pago) === valor) return;
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_atores').update({ auxilio_alimentacao_valor_pago: valor }).eq('id', atorId);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return; }
  pessoa.auxilio_alimentacao_valor_pago = valor;
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log('mesario_auxilio_alimentacao_valor_editado', '', { ator_id: atorId, nome: pessoa.nome_completo, valor, autor });
}

async function raSalvarValorPago(atorId, valorStr) {
  const valor = parseFloat(String(valorStr).replace(',', '.'));
  if (!(valor >= 0)) { showToast('⚠ Valor inválido'); renderControleUnificado(); return; }
  await raSalvarValorPagoCore(atorId, valor);
}

async function raModalSalvarValorPago(atorId, valorStr) {
  const valor = parseFloat(String(valorStr).replace(',', '.'));
  if (!(valor >= 0)) { showToast('⚠ Valor inválido'); if (raModalId === atorId) raRenderModal(); return; }
  await raSalvarValorPagoCore(atorId, valor);
  renderControleUnificado();
  if (raModalId === atorId) raRenderModal(); // redesenha o QR com o valor novo
}

// Seletor "🗓️ dias…" do auxiliar de eleição — atalho que só preenche e
// salva o campo de valor (65 ou 130), nunca guarda "quantos dias" como um
// dado à parte: o valor em si já é a fonte de verdade (mesmo critério de
// "nunca um valor cravado" de tudo isso). Reaproveita raSalvarValorPago
// pra não duplicar a lógica de gravação/log.
function raPagAplicarDias(atorId, dias) {
  if (!dias) return;
  const valor = dias === '2' ? RA_VALOR_AUXILIAR_2_DIAS : RA_VALOR_AUXILIAR_1_DIA;
  const el = document.getElementById(`ra-pag-valor-${atorId}`);
  if (el) el.value = valor.toFixed(2);
  raSalvarValorPago(atorId, String(valor));
}

function raModalAplicarDias(atorId, dias) {
  if (!dias) return;
  const valor = dias === '2' ? RA_VALOR_AUXILIAR_2_DIAS : RA_VALOR_AUXILIAR_1_DIA;
  const el = document.getElementById('ra-modal-valor');
  if (el) el.value = valor.toFixed(2);
  raModalSalvarValorPago(atorId, String(valor));
}

// ── Modal de detalhe por pessoa (29/09/2026, pedido direto: "quero poder
// clicar no nome do mesário, para verificar o pix, informar se o pix foi
// feito, o valor e uma observação") — reaproveita o overlay/#modal-body
// compartilhado por toda SIME_convocacao.html (mesmo padrão de
// cmAbrirModal/vlRenderModal/rsAbrirVoluntarios). PIX e observação usam os
// MESMOS campos (`sime_atores.pix`/`observacao`) e a MESMA ação de log
// (`mesario_editar_pix`/`mesario_observacao_adicionada`) já usadas em
// "Contatar mesários" — uma edição feita por aqui aparece certinho na
// timeline daquele modal também, sem duplicar rótulo nenhum. Duplicado (não
// importado) porque este arquivo tem seu próprio cache em memória
// (`raDados.todos`), diferente de `cmDados.pessoas` — mesmo critério "nunca
// compartilha estado entre módulos" já documentado alhures no projeto. ──
let raModalId = null;

function raPessoaModal() {
  return (raDados?.todos || []).find(a => a.id === raModalId) || null;
}

function raParseObservacoes(texto) {
  if (!texto) return [];
  return texto.split(/(?=\[\d{4}-\d{2}-\d{2})/).map(s => s.trim()).filter(Boolean);
}

async function raAppendObservacao(id, texto) {
  const sb = window.supabaseAtores;
  const p = (raDados.todos || []).find(x => x.id === id);
  if (!p) return false;
  const [{ data: ts }, autor] = await Promise.all([
    sb.rpc('sime_now'),
    window.nomeDoUsuario ? window.nomeDoUsuario() : 'Cartório',
  ]);
  const carimbo = `[${String(ts).slice(0, 16).replace('T', ' ')}] ${autor} (cartório): ${texto}`;
  const nova = p.observacao ? `${p.observacao}\n${carimbo}` : carimbo;
  const { error } = await sb.from('sime_atores').update({ observacao: nova }).eq('id', id);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return false; }
  p.observacao = nova;
  await log('mesario_observacao_adicionada', '', { ator_id: id, autor });
  return true;
}

async function raAdicionarObservacaoModal(id) {
  const campo = document.getElementById('ra-modal-obs-nova');
  const texto = (campo?.value || '').trim();
  if (!texto) { showToast('⚠ Digite algo antes de adicionar'); return; }
  const ok = await raAppendObservacao(id, texto);
  if (!ok) return;
  campo.value = '';
  showToast('✓ Observação adicionada');
  if (raModalId === id) raRenderModal();
}

// Mesmo padrão onblur-salva-sozinho já usado pro campo de PIX no modal de
// Contatar Mesários (`cmSalvarPix`) — mesma coluna, mesma ação de log.
async function raSalvarPix(id) {
  const campo = document.getElementById('ra-modal-pix');
  if (!campo) return;
  const pix = campo.value.trim();
  const p = raPessoaModal();
  if (!p || pix === (p.pix || '')) return;
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_atores').update({ pix: pix || null }).eq('id', id);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return; }
  p.pix = pix || null;
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log('mesario_editar_pix', '', { ator_id: id, pix: p.pix, autor });
  showToast('✓ Chave PIX salva');
  if (raModalId === id) raRenderModal(); // redesenha o QR com a chave nova
}

// ── QR Code do PIX (30/09/2026, pedido direto: "conseguiriamos gerar o
// qrcode do pix ao abrir o modal com o valor preenchido e informação
// Auxilio alimentação eleições 2026 seção XXX?") — BR Code (o payload
// "Pix Copia e Cola" padrão EMVCo/Bacen) montado inteiramente no cliente,
// sem nenhum serviço externo (mesmo offline-first de sempre): CRC16
// calculado na mão, desenhado com o MESMO `vendor/qrcode.min.js` já usado
// em SIME_tokens.html/SIME_rotas.html (`<script>` novo em
// SIME_convocacao.html). Só aparece quando a pessoa já tem uma chave PIX
// cadastrada — sem chave não há o que codificar, nunca inventa uma.
//
// Não testado contra um app de banco de verdade (sandbox sem acesso a
// rede/celular) — o formato segue o Manual de Padrões do Bacen à risca
// (mesma estrutura de qualquer QR Pix estático real já visto em produção:
// GUI "br.gov.bcb.pix" minúsculo, CRC16-CCITT com polinômio 0x1021 e
// semente 0xFFFF), mas vale o cartório escanear um de teste antes de
// confiar nele em massa. ──

function raCrc16Ccitt(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= (str.charCodeAt(i) & 0xFF) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function raEmvTLV(id, valor) {
  const v = String(valor);
  return `${id}${String(v.length).padStart(2, '0')}${v}`;
}

// O BR Code só aceita ASCII (sem acento) nos campos de texto livre —
// maiúsculas por convenção (não é exigência do padrão, mas é o que a
// maioria dos apps de banco mostra). Nunca aplicado à CHAVE em si (essa
// precisa ficar exatamente como cadastrada).
function raPixAscii(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .toUpperCase().trim();
}

function raPixDescricao(p) {
  return `Auxílio Alimentação Eleições 2026${p.sec ? ` - Seção ${p.sec.numero}` : ''}`;
}

// Validação real do dígito verificador de CPF (algoritmo padrão) — usada
// só pra DESAMBIGUAR um número de 11 dígitos (ver `raPixChaveNormalizada`
// abaixo): CPF e telefone com DDD têm o mesmo tamanho, mas só um dos dois
// passa nessa conta.
function raCpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false; // 11 dígitos repetidos nunca é CPF de verdade
  const calcDv = (tamBase) => {
    let soma = 0;
    for (let i = 0; i < tamBase; i++) soma += Number(cpf[i]) * (tamBase + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calcDv(9) === Number(cpf[9]) && calcDv(10) === Number(cpf[10]);
}

// A chave como o cartório digitou raramente já está no formato EXATO que
// o DICT (registro de chaves do Bacen) exige — achado real, reportado
// pelo cartório escaneando um QR de produção com "chave não encontrada":
// um telefone digitado sem o "+55" (ex.: "86981083472") nunca bate com
// nenhuma chave registrada, porque o formato oficial de chave-telefone é
// sempre E.164 completo ("+5586981083472"); o mesmo vale pra CPF digitado
// com pontuação ("072.580.733-45" em vez de "07258073345" — a chave
// registrada nunca tem ponto/traço). Normaliza só o que dá pra decidir
// com segurança — e-mail, chave aleatória (UUID) e qualquer coisa que já
// comece com "+" nunca são tocados; um número de 11 dígitos só vira
// telefone quando NÃO passa na validação de CPF (`raCpfValido`), nunca
// adivinha o contrário. NUNCA reescreve `sime_atores.pix` em si — só o
// valor usado pra montar o payload do QR, o dado salvo continua
// exatamente como o cartório digitou.
function raPixChaveNormalizada(chaveOriginal) {
  const bruta = String(chaveOriginal || '').trim();
  if (!bruta) return bruta;
  if (bruta.includes('@')) return bruta; // e-mail — nunca mexe
  if (bruta.startsWith('+')) return bruta; // já em E.164 — nunca mexe
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(bruta)) return bruta; // chave aleatória (UUID) — nunca mexe

  const digitos = bruta.replace(/\D/g, '');
  if (digitos.length === 14) return digitos; // CNPJ — só dígitos, sem pontuação
  if (digitos.length === 11 && raCpfValido(digitos)) return digitos; // CPF de verdade — só dígitos
  if (digitos.length === 10 || digitos.length === 11) return `+55${digitos}`; // telefone com DDD, sem "+55" — mesma premissa de DDD único do PI já usada alhures pra WhatsApp
  return bruta; // não bate com nenhum padrão conhecido — devolve exatamente como digitado
}

// Monta o payload completo (com CRC), pronto pra virar QR ou ser colado
// como "Pix Copia e Cola". `chave` já deve vir normalizada
// (`raPixChaveNormalizada`) — esta função nunca reformata, só monta o TLV.
function raPixPayload(chave, nome, cidade, valor, descricao) {
  const chaveTrim = String(chave || '').trim();
  if (!chaveTrim) return null;

  const guiField = raEmvTLV('00', 'br.gov.bcb.pix');
  const chaveField = raEmvTLV('01', chaveTrim);
  // "Informação adicional" (subcampo 02) — texto mostrado ao pagador. O
  // campo 26 inteiro é limitado a 99 bytes (prefixo de tamanho de 2
  // dígitos), então a descrição é cortada dinamicamente pra sempre sobrar
  // espaço pro GUI + chave, nunca estourando o payload por causa de uma
  // chave mais longa (e-mail, chave aleatória).
  const maxDesc = Math.max(0, 99 - guiField.length - chaveField.length - 4);
  const descAscii = raPixAscii(descricao).slice(0, maxDesc);
  const descField = descAscii ? raEmvTLV('02', descAscii) : '';
  const merchantAccount = raEmvTLV('26', guiField + chaveField + descField);

  const nomeField = raEmvTLV('59', raPixAscii(nome).slice(0, 25) || 'AUXILIO ALIMENTACAO');
  const cidadeField = raEmvTLV('60', raPixAscii(cidade).slice(0, 15) || 'BRASIL');
  const valorField = valor > 0 ? raEmvTLV('54', Number(valor).toFixed(2)) : '';
  const addData = raEmvTLV('62', raEmvTLV('05', '***'));

  const semCrc =
    raEmvTLV('00', '01') +
    merchantAccount +
    '52040000' +
    '5303986' +
    valorField +
    '5802BR' +
    nomeField +
    cidadeField +
    addData +
    '6304';

  return semCrc + raCrc16Ccitt(semCrc);
}

// Desenha (ou limpa) o QR dentro do `#ra-modal-qr` já presente no HTML do
// modal — chamado logo depois de `raRenderModal()` montar o innerHTML
// (elemento já existe no DOM nesse ponto, síncrono).
function raRenderModalQr(p, valorAtual) {
  const el = document.getElementById('ra-modal-qr');
  if (!el) return;
  el.innerHTML = '';
  const destino = raDestinoPix(p);
  if (!destino.chavePix || !window.QRCode) return;
  const payload = raPixPayload(raPixChaveNormalizada(destino.chavePix), destino.nomeDestinatario, raDados?.zona?.municipio, valorAtual, destino.descricao);
  if (!payload) return;
  try {
    new QRCode(el, { text: payload, width: 190, height: 190, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  } catch (e) { /* payload malformado — nunca trava o modal por causa do QR */ }
}

// Payload do PIX de DEVOLUÇÃO (06/10/2026, pedido direto: "nos recibos um
// qrcode para a devolução do valor pago, constando a informação do pix
// eleições 2026, devolução seção xxx") — compartilhado pelo modal unificado
// e pelos 4 recibos impressos. Sempre em ABERTO (sem valor pré-preenchido —
// quem devolve digita o valor na hora, e a fração a devolver varia por
// pessoa/seção). Sem destino configurado (ver "⚙️ Configuração do
// auxílio"), devolve `null` — nunca inventa pra quem.
function raPayloadDevolucao(cfg, descricao) {
  if (!cfg.pixDevolucaoChave) return null;
  return raPixPayload(raPixChaveNormalizada(cfg.pixDevolucaoChave), cfg.pixDevolucaoNome || 'Cartório Eleitoral', raDados?.zona?.municipio, 0, descricao);
}

// Desenha (ou não) o QR de devolução dentro do modal — só existe
// `#ra-modal-qr-dev` no DOM quando a seção "deve devolver"/"já devolveu" E
// há destino configurado (ver `raHtmlModalFrequenciaDevolucao`); nos demais
// casos o elemento simplesmente não existe, e esta função não faz nada.
function raRenderModalQrDevolucao(p, cfg) {
  const el = document.getElementById('ra-modal-qr-dev');
  if (!el || !window.QRCode) return;
  el.innerHTML = '';
  const descricao = `Eleições 2026 - Devolução${p.sec ? ` - Seção ${p.sec.numero}` : ''}`;
  const payload = raPayloadDevolucao(cfg, descricao);
  if (!payload) return;
  try {
    new QRCode(el, { text: payload, width: 160, height: 160, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  } catch (e) { /* nunca trava o modal por causa do QR */ }
}

async function raAbrirModal(id) {
  raModalId = id;
  document.getElementById('overlay')?.classList.add('open');
  if (!raDados || !raDados.todos) { await raCarregar(); if (raModalId !== id) return; }
  raRenderModal();
}

function raFecharModal(e) {
  if (!e || e.target === document.getElementById('overlay')) {
    document.getElementById('overlay')?.classList.remove('open');
    raModalId = null;
  }
}

function raRenderModal() {
  const modal = document.getElementById('modal-body');
  if (!modal) return;
  modal.classList.remove('cm-modal-wide'); // defensivo — #modal-body é compartilhado com o modal de Contatar Mesários
  const p = raPessoaModal();
  if (!p) { modal.innerHTML = ''; return; }
  const cfg = raCfg();
  const outros = raOutrosPapeis(p);
  const observacoes = raParseObservacoes(p.observacao);
  const blocoObs = observacoes.length
    ? [...observacoes].reverse().map(txt => `<div class="m-hist-item">${raEsc(txt)}</div>`).join('')
    : '<div class="ic-sub" style="margin:0">Nenhuma observação registrada ainda.</div>';
  const valorAtual = p.auxilio_alimentacao_valor_pago != null ? Number(p.auxilio_alimentacao_valor_pago) : raValorSugerido(p, cfg);
  const destino = raDestinoPix(p);
  const chaveQr = destino.chavePix ? raPixChaveNormalizada(destino.chavePix) : '';
  const chaveQrMudou = destino.chavePix && chaveQr !== String(destino.chavePix).trim();

  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div>
        <div style="font-weight:800">${raEsc(p.nome_completo)}</div>
        <div class="ic-sub" style="margin-bottom:0">${raEsc(raFuncaoLabel(p))}${p.sec ? ` — Seção ${p.sec.numero} (${raEsc(p.sec.local_nome || '')}, ${raEsc(p.sec.municipio || '')})` : ''}</div>
      </div>
      <button onclick="raFecharModal()" aria-label="Fechar" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text2);line-height:1">✕</button>
    </div>
    ${outros.length ? `<div class="import-result ir-warn" style="margin-top:8px">⚠️ mesma pessoa também está em: ${outros.map(o => raEsc(raFuncaoLabel(o) + (o.sec ? ` (Seção ${o.sec.numero})` : ''))).join(', ')} — confira qual papel de fato paga antes de marcar os dois.</div>` : ''}

    <div class="form-group" style="margin-top:12px">
      <label>Chave PIX${destino.viaPresidente ? ' (do próprio coordenador — informativo)' : ''}</label>
      <input id="ra-modal-pix" type="text" value="${raEsc(p.pix || '')}" placeholder="CPF, telefone, e-mail ou chave aleatória" onblur="raSalvarPix('${p.id}')">
      ${destino.viaPresidente ? `<div class="ic-sub" style="margin:4px 0 0">ℹ️ Coordenador(a) de Acessibilidade: o pagamento deste cargo vai pro PIX do <b>Presidente de Mesa</b> da seção de menor número do local — este campo não é usado no QR abaixo.</div>` : ''}
    </div>

    <div style="margin-top:8px">
      <label style="font-size:.72rem;color:var(--text2);display:block;margin-bottom:2px">Documento de envio (nº do Pix/comprovante)</label>
      <input id="ra-modal-doc-envio" type="text" value="${raEsc(p.auxilio_alimentacao_documento || '')}" placeholder="opcional" onblur="raSalvarDocumentoEnvio('${p.id}')" style="width:220px">
    </div>

    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin:12px 0">
      ${p.funcao === 'auxiliar_eleicao' ? `
      <select onchange="raModalAplicarDias('${p.id}', this.value)" style="font-size:.78rem;padding:7px 8px;border-radius:6px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)" title="Só ajusta o campo de valor abaixo — o que vale de verdade é o valor, não esta escolha">
        <option value="">🗓️ dias…</option>
        <option value="1">Só domingo (R$65)</option>
        <option value="2">Sáb. + dom. (R$130)</option>
      </select>` : ''}
      <label style="font-size:.72rem;color:var(--text2)">Valor
        <div style="display:flex;align-items:center;gap:4px;margin-top:2px">
          <span style="font-size:.85rem">R$</span>
          <input id="ra-modal-valor" type="text" value="${valorAtual.toFixed(2)}" onblur="raModalSalvarValorPago('${p.id}', this.value)" style="width:90px;padding:7px 8px;border-radius:6px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
        </div>
      </label>
      <label style="display:flex;align-items:center;gap:4px;font-size:.85rem;cursor:pointer">
        <input type="checkbox" ${p.auxilio_alimentacao_pago ? 'checked' : ''} onchange="raModalTogglePago('${p.id}', this.checked)"> PIX feito
      </label>
    </div>
    ${p.auxilio_alimentacao_pago_em ? `<div class="ic-sub" style="margin:0 0 10px">Pago em ${raFmtDataHora(new Date(p.auxilio_alimentacao_pago_em))}</div>` : ''}

    <div style="margin-top:4px;text-align:center" id="ra-modal-qr-wrap">
      <label style="font-size:.72rem;color:var(--text2);display:block;margin-bottom:6px">📱 QR Code do PIX${destino.viaPresidente ? ' — pago via Presidente' : ''}</label>
      <div id="ra-modal-qr" style="display:inline-block;background:#fff;padding:8px;border-radius:8px"></div>
      ${destino.chavePix
        ? `<div class="ic-sub" style="margin:6px 0 0">${raEsc(raFmtValor(valorAtual))} — ${raEsc(destino.descricao)}</div>
           ${destino.viaPresidente ? `<div class="ic-sub" style="margin:2px 0 0">💰 Destinatário: <b>${raEsc(destino.presidenteNome)}</b> — Presidente, Seção ${destino.presidenteSecao}</div>` : ''}
           ${chaveQrMudou ? `<div class="ic-sub" style="margin:2px 0 0">🔧 chave usada no QR: <b>${raEsc(chaveQr)}</b> — ajustada pro formato que o banco reconhece</div>` : ''}`
        : (p.funcao === 'coord_acessibilidade'
            ? `<div class="ic-sub" style="margin:6px 0 0">${p.sec ? 'Nenhum Presidente ativo encontrado pra este local — não dá pra gerar o QR automaticamente.' : 'Sem local de votação definido — não dá pra aplicar a regra do Presidente automaticamente.'}</div>`
            : '<div class="ic-sub" style="margin:6px 0 0">Cadastre uma chave PIX acima pra gerar o QR Code.</div>')}
    </div>

    ${raHtmlModalFrequenciaDevolucao(p, cfg)}

    <div style="margin-top:12px">
      <label style="font-size:.72rem;color:var(--text2);display:block;margin-bottom:3px">📝 Observação</label>
      <textarea id="ra-modal-obs-nova" rows="2" placeholder="Anotação livre sobre o pagamento…" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);font:inherit"></textarea>
      <button class="btn btn-out" style="margin-top:6px" onclick="raAdicionarObservacaoModal('${p.id}')">➕ Adicionar observação</button>
      <div class="m-hist" style="margin-top:10px">${blocoObs}</div>
    </div>

    <div style="margin-top:16px;text-align:right">
      <button class="btn btn-out" onclick="raFecharModal()">Fechar</button>
    </div>
  `;
  raRenderModalQr(p, valorAtual);
  raRenderModalQrDevolucao(p, cfg);
}

// Documento de envio (nº do Pix/comprovante que o cartório já mandou) —
// MESMA coluna já usada pelo Relatório de Pagamentos (`auxilio_alimentacao_
// documento`, populado até aqui só por conferência manual de extrato via
// SQL Editor/MCP), agora editável direto no modal (06/10/2026, pedido
// direto: "poderá ver as informações pix do presidente, data de envio do
// pix, documento de envio"). Mesmo padrão onblur-salva-sozinho de sempre.
async function raSalvarDocumentoEnvio(id) {
  const campo = document.getElementById('ra-modal-doc-envio');
  if (!campo) return;
  const doc = campo.value.trim();
  const p = raPessoaModal();
  if (!p || doc === (p.auxilio_alimentacao_documento || '')) return;
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_atores').update({ auxilio_alimentacao_documento: doc || null }).eq('id', id);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return; }
  p.auxilio_alimentacao_documento = doc || null;
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log('mesario_auxilio_alimentacao_documento_envio', '', { ator_id: id, documento: p.auxilio_alimentacao_documento, autor });
  showToast('✓ Documento de envio salvo');
}

// Documento da devolução (nº do comprovante de quem devolveu o valor) —
// coluna nova, texto livre (nunca validado — mesmo critério de
// uc_equatorial/codigo_rastreio/pix). Só aparece no modal quando a pessoa
// deve devolver ou já devolveu (ver `raHtmlModalFrequenciaDevolucao`).
async function raSalvarDocumentoDevolucao(id) {
  const campo = document.getElementById('ra-modal-doc-devolucao');
  if (!campo) return;
  const doc = campo.value.trim();
  const p = raPessoaModal();
  if (!p || doc === (p.auxilio_alimentacao_devolucao_documento || '')) return;
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_atores').update({ auxilio_alimentacao_devolucao_documento: doc || null }).eq('id', id);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return; }
  p.auxilio_alimentacao_devolucao_documento = doc || null;
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log('mesario_auxilio_alimentacao_devolucao_documento', '', { ator_id: id, documento: p.auxilio_alimentacao_devolucao_documento, autor });
  showToast('✓ Documento da devolução salvo');
}

// Wrappers de frequência/devolução pro modal unificado (06/10/2026) —
// reaproveitam o MESMO núcleo (`raMarcarFrequenciaCore`/
// `raToggleDevolvidoCore`) já usado pela aba "📋 Frequência e Devolução",
// só redesenhando também a lista daquela aba (se estiver aberta) e o
// próprio modal (pra refletir o valor a devolver/QR de devolução na hora,
// sem precisar fechar e reabrir).
async function raModalMarcarFrequencia(atorId, frequencia) {
  await raMarcarFrequenciaCore(atorId, frequencia);
  renderControleUnificado();
  if (raModalId === atorId) raRenderModal();
}
async function raModalToggleDevolvido(atorId, marcarDevolvido) {
  await raToggleDevolvidoCore(atorId, marcarDevolvido);
  renderControleUnificado();
  if (raModalId === atorId) raRenderModal();
}

// Bloco "📋 Frequência e devolução" dentro do modal unificado por pessoa
// (06/10/2026, pedido direto: "cada modal ao abrir poderá ver... frequencia
// da mesa receptora, caso haja ausencia poder marcar o ausente, o valor a
// ser devolvido pela mesa. se ja foi devolvido o documento da devolução").
// Pra mesário (Presidente, com mesa), a frequência dos 4 cargos continua
// sendo editada pelo modal dedicado "❌ Faltou" (`raAbrirModalFalta` —
// batch já testado e em produção, não refeito aqui) — este bloco só mostra
// o resumo e um botão que pivota pra lá. Pras demais funções (pagamento
// individual, sem mesa), os botões Presente/Faltou ficam direto aqui.
function raHtmlModalFrequenciaDevolucao(p, cfg) {
  const ehMesa = p.funcao === 'mesario' && p.secao_id;
  const deve = raDeveDevolver(p);
  const valorDevolver = raValorADevolver(p);
  const qtdFaltantes = ehMesa ? raQtdFaltantesMesa(p.secao_id) : 0;
  const mostrarDevolucao = deve || p.auxilio_alimentacao_devolvido;
  return `
    <div class="m-section" style="margin-top:14px">
      <div class="m-section-hdr">📋 Frequência e devolução</div>
      ${ehMesa
        ? `${raHtmlResumoMesa(p.secao_id) || '<div class="ic-sub" style="margin:0 0 6px">Frequência da mesa ainda não marcada.</div>'}
           <button class="btn btn-out" style="margin-top:6px" onclick="raAbrirModalFalta('${p.secao_id}')">❌ Marcar quem faltou / recibo ausente</button>`
        : `<div style="display:flex;gap:8px;flex-wrap:wrap">
             <button class="btn ${p.auxilio_alimentacao_frequencia === 'presente' ? 'btn-dark' : 'btn-out'}" style="padding:6px 10px;font-size:.8rem" onclick="raModalMarcarFrequencia('${p.id}', 'presente')">✅ Presente</button>
             <button class="btn ${p.auxilio_alimentacao_frequencia === 'faltou' ? 'btn-dark' : 'btn-out'}" style="padding:6px 10px;font-size:.8rem" onclick="raModalMarcarFrequencia('${p.id}', 'faltou')">❌ Faltou</button>
           </div>`}
      ${deve ? `<div class="import-result ir-warn" style="margin-top:8px">⚠️ ${ehMesa ? `${qtdFaltantes} de 4 membro(s) da mesa faltou(aram)` : 'Faltou e já recebeu'} — deve devolver ${raEsc(raFmtValor(valorDevolver))}${ehMesa ? ` (${raEsc(raFmtValor(raValorPorMembroMesa(p)))} por membro)` : ''}.</div>` : ''}
      ${mostrarDevolucao ? `
        <div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:4px;font-size:.85rem;cursor:pointer">
            <input type="checkbox" ${p.auxilio_alimentacao_devolvido ? 'checked' : ''} onchange="raModalToggleDevolvido('${p.id}', this.checked)"> Já devolveu
          </label>
          ${p.auxilio_alimentacao_devolvido_em ? `<span class="ic-sub" style="margin:0">devolvido em ${raFmtDataHora(new Date(p.auxilio_alimentacao_devolvido_em))}</span>` : ''}
        </div>
        <div style="margin-top:6px">
          <label style="font-size:.72rem;color:var(--text2);display:block;margin-bottom:2px">Documento da devolução</label>
          <input id="ra-modal-doc-devolucao" type="text" value="${raEsc(p.auxilio_alimentacao_devolucao_documento || '')}" placeholder="nº do comprovante/Pix recebido" onblur="raSalvarDocumentoDevolucao('${p.id}')" style="width:220px">
        </div>
        <div style="margin-top:10px;text-align:center">
          <label style="font-size:.72rem;color:var(--text2);display:block;margin-bottom:6px">📲 QR Code — PIX de devolução</label>
          ${cfg.pixDevolucaoChave
            ? '<div id="ra-modal-qr-dev" style="display:inline-block;background:#fff;padding:8px;border-radius:8px"></div>'
            : '<div class="ic-sub" style="margin:0">Cadastre o destino do PIX de devolução em "⚙️ Configuração do auxílio" (aba Impressão) pra gerar o QR Code.</div>'}
        </div>
      ` : ''}
    </div>`;
}

// ── 🚙 Motoristas de Repartições (04/10/2026) — controle de pagamento do
// auxílio alimentação dos motoristas dos veículos cedidos por órgãos
// públicos (`sime_veiculos_disposicao`, mesmo cadastro do módulo 🚙
// Veículos à Disposição). Só CONTROLE DE PAGAMENTO — nenhum recibo
// impresso. Card próprio, logo abaixo do controle de pagamento por pessoa
// (sime_atores), que continua intacto: estado, funções e ids próprios
// (prefixo `raVd`/`ra-vd-`), nunca reaproveitando `raDados.todos`/
// `raModalId` — só as funções puras de PIX/QR (raPixPayload,
// raPixChaveNormalizada, raFmtValor...) são compartilhadas. Veículo sem
// motorista cadastrado fica de fora (não há a quem pagar). PIX é texto
// livre, salvo exatamente como digitado (mesma convenção de
// `sime_atores.pix`) — só o valor usado no QR passa por
// `raPixChaveNormalizada`. ──
let raDadosVeiculos = []; // linhas de sime_veiculos_disposicao (ativas, com motorista)
let raBuscaVeiculos = '';
let raBuscaVeiculosTimer = null;
let raModalVeiculoId = null;

// Nunca lança — uma falha aqui (tabela/coluna indisponível, rede) só deixa a
// lista de motoristas vazia, sem derrubar o carregamento do resto da aba.
async function raCarregarVeiculos(zonaId) {
  raDadosVeiculos = [];
  try {
    const sb = window.supabaseAtores;
    if (!sb || !zonaId) return;
    const { data, error } = await sb.from('sime_veiculos_disposicao')
      .select('id, municipio, veiculo, placa, lotacao, motorista_nome, motorista_telefone, pix, auxilio_alimentacao_pago, auxilio_alimentacao_valor_pago, auxilio_alimentacao_pago_em')
      .eq('zona_id', zonaId).eq('ativo', true)
      .order('municipio').order('lotacao');
    if (error) return;
    // Filtro "tem motorista" no cliente (equivale a .not('motorista_nome','is',null)),
    // ignorando também nome em branco.
    raDadosVeiculos = (data || []).filter(v => v.motorista_nome && String(v.motorista_nome).trim());
  } catch (e) { raDadosVeiculos = []; }
}

function raVeiculoPorId(id) {
  return (raDadosVeiculos || []).find(v => v.id === id) || null;
}

function raVdValorSugerido(v, cfg) {
  return cfg.valor; // sem regra própria pra motorista — parte do valor único configurado, sempre editável
}

function raVdValorAtual(v, cfg) {
  return v.auxilio_alimentacao_valor_pago != null ? Number(v.auxilio_alimentacao_valor_pago) : raVdValorSugerido(v, cfg);
}

function raVdDescricao(v) {
  return `Auxílio Eleições 2026 - Motorista${v.lotacao ? ` - ${v.lotacao}` : ''}`;
}

function raVdFiltrar() {
  const q = raBuscaVeiculos.trim().toLowerCase();
  const lista = raDadosVeiculos || [];
  if (!q) return lista;
  return lista.filter(v => `${v.motorista_nome || ''} ${v.placa || ''} ${v.veiculo || ''} ${v.lotacao || ''} ${v.municipio || ''}`.toLowerCase().includes(q));
}

function raVdResumo() {
  const lista = raDadosVeiculos || [];
  const pagos = lista.filter(v => v.auxilio_alimentacao_pago);
  const totalPago = pagos.reduce((s, v) => s + Number(v.auxilio_alimentacao_valor_pago || 0), 0);
  return { total: lista.length, pagos: pagos.length, totalPago };
}

function raOnBuscaVeiculosInput(v) {
  raBuscaVeiculos = v;
  clearTimeout(raBuscaVeiculosTimer);
  raBuscaVeiculosTimer = setTimeout(renderControleVeiculos, 250);
}

function raVdLinkWhatsApp(v) {
  if (!v.motorista_telefone || typeof linkWhatsApp !== 'function') return '';
  const url = linkWhatsApp(v.motorista_telefone, '');
  if (!url) return '';
  const rotulo = typeof fmtTelefone === 'function' ? fmtTelefone(v.motorista_telefone) : v.motorista_telefone;
  return `<a href="${raEsc(url)}" target="_blank" rel="noopener" title="Abrir conversa no WhatsApp">💬 ${raEsc(rotulo)}</a>`;
}

function raHtmlSecaoVeiculos() {
  return `
    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">🚙 Motoristas de Repartições</div>
      <div class="ic-sub">Motoristas dos veículos cedidos por órgãos públicos (cadastro do módulo 🚙 Veículos à
        Disposição) — mesmo controle de "quem já recebeu" usado acima, à parte do cadastro de mesários. Veículo sem
        motorista cadastrado não aparece. Valor sempre editável, nunca travado.</div>
      <div id="ra-controle-veiculos" style="margin-top:8px"></div>
    </div>`;
}

function renderControleVeiculos() {
  const alvo = document.getElementById('ra-controle-veiculos');
  if (!alvo) return;
  const buscaEl = document.getElementById('ra-vd-busca');
  const buscaAtiva = document.activeElement === buscaEl;
  const buscaSelStart = buscaAtiva ? buscaEl.selectionStart : null;
  const buscaSelEnd = buscaAtiva ? buscaEl.selectionEnd : null;

  const lista = raVdFiltrar();
  const resumo = raVdResumo();
  const cfg = raCfg();

  alvo.innerHTML = `
    <div class="ic-sub" style="margin:0 0 8px">🚙 Motoristas de Repartições — ${resumo.pagos} pago(s) de ${resumo.total} — total pago: ${raFmtValor(resumo.totalPago)}.</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      <input type="text" id="ra-vd-busca" value="${raEsc(raBuscaVeiculos)}" oninput="raOnBuscaVeiculosInput(this.value)" placeholder="Buscar por motorista, placa, veículo, lotação ou município…" style="flex:1;min-width:160px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
    </div>
    <div class="m-hist" style="max-height:480px;overflow-y:auto">
      ${lista.length ? lista.map(v => {
        const wa = raVdLinkWhatsApp(v);
        return `
      <div class="m-hist-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <span>
          <b style="cursor:pointer;text-decoration:underline" onclick="raAbrirModalVeiculo('${v.id}')" title="Clique pra ver PIX e marcar pagamento">${raEsc(v.motorista_nome)}</b>
          — ${raEsc(v.veiculo || 'Veículo')}${v.placa ? ` · Placa <b class="mono">${raEsc(v.placa)}</b>` : ''}
          <div class="ic-sub" style="margin:2px 0 0">${raEsc(v.lotacao || '—')} · ${raEsc(v.municipio || '—')}${wa ? ` · ${wa}` : ''}</div>
          ${v.auxilio_alimentacao_pago_em ? `<span class="ic-sub" style="margin-left:0">pago em ${raFmtDataHora(new Date(v.auxilio_alimentacao_pago_em))}</span>` : ''}
        </span>
        <span style="display:flex;align-items:center;gap:6px">
          <span style="font-size:.75rem">R$</span>
          <input type="text" id="ra-vd-valor-${v.id}" value="${raVdValorAtual(v, cfg).toFixed(2)}" onblur="raSalvarValorPagoVeiculo('${v.id}', this.value)" style="width:70px">
          <label style="display:flex;align-items:center;gap:4px;font-size:.8rem;cursor:pointer">
            <input type="checkbox" ${v.auxilio_alimentacao_pago ? 'checked' : ''} onchange="raTogglePagoVeiculo('${v.id}', this.checked)"> Pago
          </label>
        </span>
      </div>`;
      }).join('') : `<div class="ic-sub" style="margin:0">${(raDadosVeiculos || []).length ? 'Nenhum motorista encontrado.' : 'Nenhum veículo à disposição com motorista cadastrado nesta zona.'}</div>`}
    </div>`;
  if (buscaAtiva) {
    const el = document.getElementById('ra-vd-busca');
    if (el) { el.focus(); try { el.setSelectionRange(buscaSelStart, buscaSelEnd); } catch (e) { /* ignora */ } }
  }
}

// Mesma semântica de raTogglePagoCore: marcar grava o valor JÁ DIGITADO +
// data (via sime_now); desmarcar limpa só a data, o valor fica como
// referência.
async function raTogglePagoVeiculoCore(id, marcarPago, valorDigitado) {
  const sb = window.supabaseAtores;
  const v = raVeiculoPorId(id);
  if (!v) return false;
  let payload;
  if (marcarPago) {
    let ts = null;
    try { const { data } = await sb.rpc('sime_now'); ts = data || null; } catch (e) { ts = null; }
    payload = { auxilio_alimentacao_pago: true, auxilio_alimentacao_valor_pago: (valorDigitado >= 0 ? valorDigitado : raCfg().valor), auxilio_alimentacao_pago_em: ts };
  } else {
    payload = { auxilio_alimentacao_pago: false, auxilio_alimentacao_pago_em: null };
  }
  const { error } = await sb.from('sime_veiculos_disposicao').update(payload).eq('id', id);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return false; }
  Object.assign(v, payload);
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log(marcarPago ? 'veiculo_disposicao_auxilio_pago' : 'veiculo_disposicao_auxilio_despago', '', { veiculo_id: id, motorista: v.motorista_nome, placa: v.placa, valor: v.auxilio_alimentacao_valor_pago, autor });
  showToast(marcarPago ? '✓ Marcado como pago' : '↺ Voltou a pendente');
  return true;
}

async function raTogglePagoVeiculo(id, marcarPago) {
  const valorEl = document.getElementById(`ra-vd-valor-${id}`);
  const valorDigitado = valorEl ? parseFloat(String(valorEl.value).replace(',', '.')) : NaN;
  await raTogglePagoVeiculoCore(id, marcarPago, valorDigitado);
  renderControleVeiculos();
}

async function raModalTogglePagoVeiculo(id, marcarPago) {
  const valorEl = document.getElementById('ra-vd-modal-valor');
  const valorDigitado = valorEl ? parseFloat(String(valorEl.value).replace(',', '.')) : NaN;
  await raTogglePagoVeiculoCore(id, marcarPago, valorDigitado);
  renderControleVeiculos();
  raRerenderModalVeiculoSeAberto(id);
}

async function raSalvarValorPagoVeiculoCore(id, valor) {
  const v = raVeiculoPorId(id);
  if (!v || Number(v.auxilio_alimentacao_valor_pago) === valor) return;
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_veiculos_disposicao').update({ auxilio_alimentacao_valor_pago: valor }).eq('id', id);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return; }
  v.auxilio_alimentacao_valor_pago = valor;
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log('veiculo_disposicao_auxilio_valor_editado', '', { veiculo_id: id, motorista: v.motorista_nome, placa: v.placa, valor, autor });
}

async function raSalvarValorPagoVeiculo(id, valorStr) {
  const valor = parseFloat(String(valorStr).replace(',', '.'));
  if (!(valor >= 0)) { showToast('⚠ Valor inválido'); renderControleVeiculos(); return; }
  await raSalvarValorPagoVeiculoCore(id, valor);
}

async function raModalSalvarValorPagoVeiculo(id, valorStr) {
  const valor = parseFloat(String(valorStr).replace(',', '.'));
  if (!(valor >= 0)) { showToast('⚠ Valor inválido'); raRerenderModalVeiculoSeAberto(id); return; }
  await raSalvarValorPagoVeiculoCore(id, valor);
  renderControleVeiculos();
  raRerenderModalVeiculoSeAberto(id); // redesenha o QR com o valor novo
}

// PIX salvo exatamente como digitado (mesma convenção de sime_atores.pix).
async function raSalvarPixVeiculo(id) {
  const campo = document.getElementById('ra-vd-modal-pix');
  if (!campo) return;
  const pix = campo.value.trim();
  const v = raVeiculoPorId(id);
  if (!v || pix === (v.pix || '')) return;
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_veiculos_disposicao').update({ pix: pix || null }).eq('id', id);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return; }
  v.pix = pix || null;
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log('veiculo_disposicao_pix_editado', '', { veiculo_id: id, motorista: v.motorista_nome, pix: v.pix, autor });
  showToast('✓ Chave PIX salva');
  raRerenderModalVeiculoSeAberto(id); // redesenha o QR com a chave nova
}

// #modal-body é compartilhado por vários modais da página — só redesenha o
// modal do motorista se ELE ainda é o que está aberto (marcador no próprio
// HTML; outro modal, ao abrir, substitui o innerHTML e o marcador some).
function raRerenderModalVeiculoSeAberto(id) {
  if (raModalVeiculoId !== id) return;
  const marcador = document.getElementById('ra-vd-modal-marker');
  const overlayAberto = document.getElementById('overlay')?.classList.contains('open');
  if (!marcador || marcador.dataset.id !== id || !overlayAberto) return;
  raRenderModalVeiculo();
}

function raAbrirModalVeiculo(id) {
  raModalId = null; // garante que um salvamento pendente do modal por pessoa não redesenhe por cima deste
  raModalVeiculoId = id;
  document.getElementById('overlay')?.classList.add('open');
  raRenderModalVeiculo();
}

function raFecharModalVeiculo(e) {
  if (!e || e.target === document.getElementById('overlay')) {
    document.getElementById('overlay')?.classList.remove('open');
    raModalVeiculoId = null;
  }
}

function raRenderModalQrVeiculo(v, valorAtual) {
  const el = document.getElementById('ra-vd-modal-qr');
  if (!el) return;
  el.innerHTML = '';
  if (!v.pix || !window.QRCode) return;
  const payload = raPixPayload(raPixChaveNormalizada(v.pix), v.motorista_nome, raDados?.zona?.municipio, valorAtual, raVdDescricao(v));
  if (!payload) return;
  try {
    new QRCode(el, { text: payload, width: 190, height: 190, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  } catch (e) { /* payload malformado — nunca trava o modal por causa do QR */ }
}

function raRenderModalVeiculo() {
  const modal = document.getElementById('modal-body');
  if (!modal) return;
  modal.classList.remove('cm-modal-wide'); // defensivo — #modal-body é compartilhado
  const v = raVeiculoPorId(raModalVeiculoId);
  if (!v) { modal.innerHTML = ''; return; }
  const cfg = raCfg();
  const valorAtual = raVdValorAtual(v, cfg);
  const chaveQr = v.pix ? raPixChaveNormalizada(v.pix) : '';
  const chaveQrMudou = v.pix && chaveQr !== String(v.pix).trim();
  const wa = raVdLinkWhatsApp(v);

  modal.innerHTML = `
    <div id="ra-vd-modal-marker" data-id="${raEsc(v.id)}" style="display:none"></div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div>
        <div style="font-weight:800">${raEsc(v.motorista_nome)}</div>
        <div class="ic-sub" style="margin-bottom:0">Motorista de repartição — ${raEsc(v.veiculo || 'Veículo')}${v.placa ? ` · Placa <b class="mono">${raEsc(v.placa)}</b>` : ''}</div>
        <div class="ic-sub" style="margin-bottom:0">${raEsc(v.lotacao || '—')} · ${raEsc(v.municipio || '—')}</div>
        <div class="ic-sub" style="margin-bottom:0">Telefone: ${v.motorista_telefone ? (wa || raEsc(v.motorista_telefone)) : '—'}</div>
      </div>
      <button onclick="raFecharModalVeiculo()" aria-label="Fechar" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text2);line-height:1">✕</button>
    </div>

    <div class="form-group" style="margin-top:12px">
      <label>Chave PIX</label>
      <input id="ra-vd-modal-pix" type="text" value="${raEsc(v.pix || '')}" placeholder="CPF, telefone, e-mail ou chave aleatória" onblur="raSalvarPixVeiculo('${v.id}')">
    </div>

    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin:12px 0">
      <label style="font-size:.72rem;color:var(--text2)">Valor
        <div style="display:flex;align-items:center;gap:4px;margin-top:2px">
          <span style="font-size:.85rem">R$</span>
          <input id="ra-vd-modal-valor" type="text" value="${valorAtual.toFixed(2)}" onblur="raModalSalvarValorPagoVeiculo('${v.id}', this.value)" style="width:90px;padding:7px 8px;border-radius:6px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
        </div>
      </label>
      <label style="display:flex;align-items:center;gap:4px;font-size:.85rem;cursor:pointer">
        <input type="checkbox" ${v.auxilio_alimentacao_pago ? 'checked' : ''} onchange="raModalTogglePagoVeiculo('${v.id}', this.checked)"> PIX feito
      </label>
    </div>
    ${v.auxilio_alimentacao_pago_em ? `<div class="ic-sub" style="margin:0 0 10px">Pago em ${raFmtDataHora(new Date(v.auxilio_alimentacao_pago_em))}</div>` : ''}

    <div style="margin-top:4px;text-align:center">
      <label style="font-size:.72rem;color:var(--text2);display:block;margin-bottom:6px">📱 QR Code do PIX</label>
      <div id="ra-vd-modal-qr" style="display:inline-block;background:#fff;padding:8px;border-radius:8px"></div>
      ${v.pix
        ? `<div class="ic-sub" style="margin:6px 0 0">${raEsc(raFmtValor(valorAtual))} — ${raEsc(raVdDescricao(v))}</div>
           ${chaveQrMudou ? `<div class="ic-sub" style="margin:2px 0 0">🔧 chave usada no QR: <b>${raEsc(chaveQr)}</b> — ajustada pro formato que o banco reconhece</div>` : ''}`
        : '<div class="ic-sub" style="margin:6px 0 0">Cadastre uma chave PIX acima pra gerar o QR Code.</div>'}
    </div>

    <div style="margin-top:16px;text-align:right">
      <button class="btn btn-out" onclick="raFecharModalVeiculo()">Fechar</button>
    </div>
  `;
  raRenderModalQrVeiculo(v, valorAtual);
}

// ── Sub-abas: Impressão × Controle de pagamento e frequência (29/09/2026,
// pedido direto: "melhore a aba de auxilio alimentação, com uma parte
// separada só para impressão"). Antes, os 4 cards de gerar recibo e o card
// de controle de pagamento ficavam todos numa coluna só, sem separação — a
// lista de pagamento (que pode ter dezenas de linhas) empurrava os botões
// de impressão pra bem longe de onde a aba abre. Virou um alternador de 2
// botões (`.btn-dark`/`.btn-out`, mesmo par já usado em toda ação de status
// rápido do projeto — não reaproveita `.tab`/`.tabs`, que é controlado por
// `goTab()`/`document.querySelectorAll('.tab')` das abas PRINCIPAIS da
// página; usar a mesma classe aqui faria esse seletor pegar estes botões
// também) — nasce em "Impressão" (`raSubTab`), o mesmo comportamento de
// sempre pra quem nunca trocou de sub-aba.
//
// Era 3 sub-abas até 08/10/2026 ("Impressão"/"Controle de pagamento"/
// "Frequência e Devolução") — as duas últimas foram UNIFICADAS numa só
// (pedido direto: "quero unificar o controle de pagamento e frequencia e
// devolução", ver comentário na declaração de `raCtlBusca` acima). ──
let raSubTab = 'impressao'; // 'impressao' | 'controle'

function raMudarSubTab(t) {
  raSubTab = t;
  renderReciboAlimentacao();
}

function raHtmlSecaoImpressao(cfg) {
  return `
    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">⚙️ Configuração do auxílio</div>
      <div class="ic-sub">Documento de distribuição do auxílio alimentação — mesmo modelo já usado pelo cartório no
        ELO (Seção/Inscrição/Nome/Função/Assinatura), com espaço em branco pra eventual substituição de última hora
        e o fechamento de "Total pago"/"Suprido". Só gera o documento — a confirmação de entrega é a própria
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
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border2)">
        <div class="ic-sub" style="margin-bottom:8px">📲 Destino do PIX de devolução (06/10/2026) — pra quem faltou e precisa devolver o valor. Aparece como QR Code no modal da pessoa e nos recibos impressos. Sem chave cadastrada, nenhum QR de devolução é desenhado em lugar nenhum.</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div>
            <label style="font-size:.72rem;color:var(--text2);display:block;margin-bottom:2px">Chave PIX de devolução</label>
            <input id="ra-pix-dev-chave" type="text" value="${raEsc(cfg.pixDevolucaoChave)}" placeholder="CPF, telefone, e-mail ou chave aleatória" style="width:220px">
          </div>
          <div>
            <label style="font-size:.72rem;color:var(--text2);display:block;margin-bottom:2px">Nome do destinatário</label>
            <input id="ra-pix-dev-nome" type="text" value="${raEsc(cfg.pixDevolucaoNome)}" placeholder="ex.: Cartório Eleitoral" style="width:200px">
          </div>
          <button class="btn btn-out" onclick="raSalvarConfigDevolucao()">💾 Salvar</button>
        </div>
      </div>
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
    </div>`;
}

function raHtmlSecaoControle() {
  return `
    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">💰📋 Controle de pagamento e frequência</div>
      <div class="ic-sub">Quem já recebeu o auxílio de verdade, quem compareceu e quem faltou (e precisa devolver
        o valor) — tudo numa lista só, separada do documento impresso na aba "🖨️ Impressão" (aquele é só o papel
        pra assinatura, este é o controle interno do cartório). Da mesa receptora, só o Presidente recebe
        pagamento direto (R$260 — repassa aos outros 3 da mesa fora do sistema, por isso só ele aparece aqui);
        "❌ Faltou" nele abre um modal pra indicar qual(is) dos 4 cargos faltou e calcula a devolução sozinho
        (valor pago ÷ 4 × quantos faltaram). Auxiliar de eleição recebe por dia trabalhado (R$65 só domingo,
        R$130 sábado + domingo — use o seletor 🗓️ ao lado do valor). Valor sempre editável, nunca travado.</div>
      <div style="margin-top:8px">
        <button class="btn btn-out" onclick="raImprimirRelatorioPagamentos()">🖨️ Imprimir relatório (valores pagos + documentos)</button>
        <div class="ic-sub" style="margin-top:4px">Imprime só quem já está marcado como pago — respeita os filtros de função/município/busca abaixo, ignora os de status de pagamento/situação.</div>
      </div>
      <div id="ra-controle-unificado" style="margin-top:8px"></div>
    </div>`;
}

// Lista única, combinando o que antes eram duas listas (Controle de
// pagamento / Frequência e Devolução) iterando a MESMA `raDados.todos` —
// cada linha mostra os dois grupos de controle (pagamento em cima,
// frequência/devolução embaixo), com um resumo mesa (`raHtmlResumoMesa`)
// quando aplicável.
function renderControleUnificado() {
  const alvo = document.getElementById('ra-controle-unificado');
  if (!alvo) return;
  const buscaEl = document.getElementById('ra-ctl-busca');
  const buscaAtiva = document.activeElement === buscaEl;
  const buscaSelStart = buscaAtiva ? buscaEl.selectionStart : null;
  const buscaSelEnd = buscaAtiva ? buscaEl.selectionEnd : null;

  const lista = raCtlFiltrar();
  const resumo = raCtlResumo();
  const cfg = raCfg();
  const contagemFuncao = {};
  for (const a of raDados.todos || []) contagemFuncao[a.funcao] = (contagemFuncao[a.funcao] || 0) + 1;
  const municipios = [...new Set((raDados.todos || []).map(a => a.sec?.municipio).filter(Boolean))].sort();

  alvo.innerHTML = `
    <div class="ic-sub" style="margin:0 0 8px">
      ${resumo.pagos} de ${resumo.total} já pagos — total pago: ${raFmtValor(resumo.totalPago)}.${resumo.conflitos ? ` <b style="color:var(--red)">⚠️ ${resumo.conflitos} com papel duplicado — confira antes de marcar como pago.</b>` : ''}<br>
      ${resumo.deveDevolver ? `<b style="color:var(--red)">⚠️ ${resumo.deveDevolver} deve${resumo.deveDevolver === 1 ? '' : 'm'} devolver — ${raFmtValor(resumo.totalADevolver)}</b> · ` : ''}${resumo.jaDevolveram} já devolve${resumo.jaDevolveram === 1 ? 'u' : 'ram'} (${raFmtValor(resumo.totalDevolvido)}) · ${resumo.semMarcar} sem frequência marcada ainda${resumo.reciboAusente ? ` · <b style="color:var(--text2)">📄 ${resumo.reciboAusente} com recibo ausente</b> (mesa completa, só falta o papel)` : ''}.
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      <input type="text" id="ra-ctl-busca" value="${raEsc(raCtlBusca)}" oninput="raOnCtlBuscaInput(this.value)" placeholder="Buscar por nome ou seção…" style="flex:1;min-width:160px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
      <select onchange="raCtlMudarFiltroPago(this.value)" style="padding:8px 10px;border-radius:7px">
        <option value="pendente" ${raCtlFiltroPago === 'pendente' ? 'selected' : ''}>Pagamento: Pendentes</option>
        <option value="pago" ${raCtlFiltroPago === 'pago' ? 'selected' : ''}>Pagamento: Pagos</option>
        <option value="" ${raCtlFiltroPago === '' ? 'selected' : ''}>Pagamento: Todos</option>
      </select>
      <select onchange="raCtlMudarFiltroFuncao(this.value)" style="padding:8px 10px;border-radius:7px">
        ${RA_FUNCAO_FILTRO.map(f => `<option value="${f.valor}" ${raCtlFiltroFuncao === f.valor ? 'selected' : ''}>${f.label}${f.valor ? ` (${contagemFuncao[f.valor] || 0})` : ` (${(raDados.todos || []).length})`}</option>`).join('')}
      </select>
      <select onchange="raCtlMudarFiltroMunicipio(this.value)" style="padding:8px 10px;border-radius:7px">
        <option value="" ${raCtlFiltroMunicipio === '' ? 'selected' : ''}>Todos os municípios</option>
        ${municipios.map(m => `<option value="${raEsc(m)}" ${raCtlFiltroMunicipio === m ? 'selected' : ''}>${raEsc(m)}</option>`).join('')}
      </select>
      <select onchange="raCtlMudarFiltroSituacao(this.value)" style="padding:8px 10px;border-radius:7px">
        ${RA_DEV_SITUACAO_FILTRO.map(f => `<option value="${f.valor}" ${raCtlFiltroSituacao === f.valor ? 'selected' : ''}>${f.label}</option>`).join('')}
      </select>
    </div>
    <div class="m-hist" style="max-height:480px;overflow-y:auto">
      ${raHtmlListaComGrupos(lista, a => {
        const outros = raOutrosPapeis(a);
        const deve = raDeveDevolver(a);
        const ehMesa = a.funcao === 'mesario' && a.secao_id;
        const valorDevolver = raValorADevolver(a);
        const qtdFaltantes = ehMesa ? raQtdFaltantesMesa(a.secao_id) : 0;
        return `
      <div class="m-hist-item" style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <span>
            <b style="cursor:pointer;text-decoration:underline" onclick="raAbrirModal('${a.id}')" title="Clique pra ver PIX, marcar pagamento e anotar observação">${raEsc(a.nome_completo)}</b> — ${raEsc(raFuncaoLabel(a))}${a.sec ? ` — Seção ${a.sec.numero}` : ''}
            ${a.auxilio_alimentacao_pago_em ? `<span class="ic-sub" style="margin-left:6px">pago em ${raFmtDataHora(new Date(a.auxilio_alimentacao_pago_em))}</span>` : ''}
            ${outros.length ? `<div class="import-result ir-warn" style="margin-top:4px;display:inline-block;font-size:.76rem">⚠️ mesma pessoa também está em: ${outros.map(o => raEsc(raFuncaoLabel(o) + (o.sec ? ` (Seção ${o.sec.numero})` : ''))).join(', ')} — confira qual papel de fato paga antes de marcar os dois.</div>` : ''}
          </span>
          <span style="display:flex;align-items:center;gap:6px">
            ${a.funcao === 'auxiliar_eleicao' ? `
            <select onchange="raPagAplicarDias('${a.id}', this.value)" style="font-size:.72rem;padding:4px 6px;border-radius:6px" title="Só ajusta o campo de valor ao lado — o que vale de verdade é o valor, não esta escolha">
              <option value="">🗓️ dias…</option>
              <option value="1">Só domingo (R$65)</option>
              <option value="2">Sáb. + dom. (R$130)</option>
            </select>` : ''}
            <span style="font-size:.75rem">R$</span>
            <input type="text" id="ra-pag-valor-${a.id}" value="${a.auxilio_alimentacao_valor_pago != null ? Number(a.auxilio_alimentacao_valor_pago).toFixed(2) : raValorSugerido(a, cfg).toFixed(2)}" onblur="raSalvarValorPago('${a.id}', this.value)" style="width:70px">
            <label style="display:flex;align-items:center;gap:4px;font-size:.8rem;cursor:pointer">
              <input type="checkbox" ${a.auxilio_alimentacao_pago ? 'checked' : ''} onchange="raTogglePago('${a.id}', this.checked)"> Pago
            </label>
          </span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <span>
            ${deve ? `<div class="import-result ir-warn" style="display:inline-block;font-size:.76rem">⚠️ ${ehMesa ? `${qtdFaltantes} de 4 membro(s) da mesa faltou(aram)` : 'Faltou e já recebeu'} — deve devolver ${raFmtValor(valorDevolver)}${ehMesa ? ` (${raFmtValor(raValorPorMembroMesa(a))} por membro)` : ''}.</div>` : ''}
            ${a.auxilio_alimentacao_devolvido ? `<span class="ic-sub">✅ Devolvido${a.auxilio_alimentacao_devolvido_em ? ` em ${raFmtDataHora(new Date(a.auxilio_alimentacao_devolvido_em))}` : ''}</span>` : ''}
          </span>
          <span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            ${!ehMesa ? `<button class="btn ${a.auxilio_alimentacao_frequencia === 'presente' ? 'btn-dark' : 'btn-out'}" style="padding:5px 9px;font-size:.78rem" onclick="raMarcarFrequencia('${a.id}', 'presente')">✅ Presente</button>
            <button class="btn ${a.auxilio_alimentacao_frequencia === 'faltou' ? 'btn-dark' : 'btn-out'}" style="padding:5px 9px;font-size:.78rem" onclick="raMarcarFrequencia('${a.id}', 'faltou')">❌ Faltou</button>` : ''}
            ${ehMesa ? `<button class="btn btn-out" style="padding:5px 9px;font-size:.78rem" onclick="raMarcarPresencaMesa('${a.secao_id}')" title="Marca presente os 4 cargos da mesa desta seção de uma vez (nunca mexe no recibo)">👥 Todos presentes</button>
            <button class="btn btn-out" style="padding:5px 9px;font-size:.78rem" onclick="raAbrirModalFalta('${a.secao_id}')" title="Indicar quem faltou e não foi substituído, ou marcar que só o recibo ficou faltando">❌ Faltou</button>` : ''}
            ${deve ? `<button class="btn btn-dark" style="padding:5px 9px;font-size:.78rem" onclick="raToggleDevolvido('${a.id}', true)">✅ Marcar devolvido</button>` : ''}
            ${a.auxilio_alimentacao_devolvido ? `<button class="btn btn-out" style="padding:5px 9px;font-size:.78rem" onclick="raToggleDevolvido('${a.id}', false)">↺ Desfazer devolução</button>` : ''}
          </span>
        </div>
        ${ehMesa ? raHtmlResumoMesa(a.secao_id) : ''}
      </div>`;
      })}
    </div>`;
  if (buscaAtiva) {
    const el = document.getElementById('ra-ctl-busca');
    if (el) { el.focus(); try { el.setSelectionRange(buscaSelStart, buscaSelEnd); } catch (e) { /* ignora */ } }
  }
}

// ── Frequência (comparecimento) + devolução (05/10/2026, pedido direto:
// "quero agora uma forma de controlar, em cada seção a frequencia para
// marcar quais devem devolver o valor e controlar se se ja foi
// devolvido") — ver sql/SIME_atores_frequencia_devolucao.sql. Até
// 08/10/2026 vivia numa sub-aba própria ("📋 Frequência e Devolução"),
// separada de "💰 Controle de pagamento" — as duas foram unificadas numa
// lista só (ver `raCtlBusca`/`renderControleUnificado` mais acima), então
// o estado de filtro já é o `raCtl*` compartilhado; só a lógica de
// cálculo (mesa/devolução) continua aqui.
//
// "Deve devolver" nunca é uma flag própria gravada no banco — é sempre
// DERIVADO (frequência='faltou' E já pago E ainda não devolveu), pra
// nunca divergir se o pagamento ou a frequência mudarem depois (ex.:
// desmarcar "pago" por engano não deixaria uma flag "deve devolver"
// órfã por aí). Lista ordenada por SEÇÃO (o pedido foi explícito "em
// cada seção a frequência") e depois por nome — quem não tem seção
// resolvida (coordenador sem local, auxiliar de eleição, junta) vai pro
// fim da lista, nunca escondido. ──

// Modal "❌ Faltou" da mesa (06/10/2026) — estado só dele, separado de
// `raModalId`/`raModalVeiculoId` (os outros dois modais que já dividem o
// mesmo #modal-body). `raModalFaltaSelecionados` guarda, por id de ator,
// se o checkbox "faltou" está marcado NA SESSÃO DO MODAL — só grava no
// banco quando o cartório confirma, pra dar pra marcar vários de uma vez
// (e cancelar) sem ficar disparando update a cada clique.
let raModalFaltaSecaoId = null;
let raModalFaltaSelecionados = {};
let raModalFaltaReciboAusente = false;

// Mesa receptora é um caso especial — só o Presidente recebe o pagamento
// (R$260, pra repassar aos outros 3 em mãos — ver `raDados.todos` em
// `raCarregar`), mas qualquer um dos 4 cargos pode faltar isoladamente
// (05/10/2026, pedido direto: "pode faltar algum dos membros da mesa,
// devemos indicar quem faltou, se foi 1, 2 ou 3 membros para indicar o
// valor a ser devolvido"). Por isso a frequência de CADA um dos 4 cargos é
// marcada na própria linha dele em `sime_atores` (coluna já existe em toda
// linha, não só na do Presidente) — `raDados.mesarios` (lista cheia, não
// filtrada) é quem resolve "quem são os 4 desta seção". O valor a devolver
// nunca é o R$260 inteiro automaticamente: é dividido pelos 4 cargos
// (R$65 cada, o mesmo valor-padrão usado pros demais papéis) e multiplicado
// só pela quantidade de quem de fato faltou.
function raMesaMembros(secaoId) {
  return (raDados.mesarios || []).filter(m => m.secao_id === secaoId);
}
function raMesaTodosPresentes(secaoId) {
  const membros = raMesaMembros(secaoId);
  return membros.length > 0 && membros.every(m => m.auxilio_alimentacao_frequencia === 'presente');
}
function raMesaNenhumMarcado(secaoId) {
  return raMesaMembros(secaoId).every(m => !m.auxilio_alimentacao_frequencia);
}
function raQtdFaltantesMesa(secaoId) {
  return raMesaMembros(secaoId).filter(m => m.auxilio_alimentacao_frequencia === 'faltou').length;
}
function raMesaPresidente(secaoId) {
  return raMesaMembros(secaoId).find(m => m.funcao_mesa === 'Presidente');
}
// "Recibo ausente" (06/10/2026, pedido direto: "tambem pode acontecer de
// faltar o recibo e a mesa funcionar completa") — flag independente da
// frequência: a folha física de assinatura não foi recolhida, mesmo com os
// 4 cargos presentes. Gravada só na linha do Presidente (mesma linha que já
// carrega pix/documento da seção) — nunca afeta `raDeveDevolver`, é só uma
// pendência de documentação.
function raMesaReciboAusente(secaoId) {
  return !!raMesaPresidente(secaoId)?.auxilio_alimentacao_recibo_ausente;
}
// Valor por membro é sempre o pago ao Presidente ÷ 4 cargos — não ÷ pelo
// nº de membros efetivamente cadastrados, pra não inflar o valor por
// membro se por acaso um cargo não tiver linha própria em `sime_atores`.
function raValorPorMembroMesa(presidenteRow) {
  return Number(presidenteRow.auxilio_alimentacao_valor_pago || 0) / 4;
}
function raValorADevolverMesa(presidenteRow) {
  if (!presidenteRow.secao_id || !presidenteRow.auxilio_alimentacao_pago) return 0;
  const qtd = raQtdFaltantesMesa(presidenteRow.secao_id);
  return qtd ? raValorPorMembroMesa(presidenteRow) * qtd : 0;
}

function raAcharAtorQualquer(atorId) {
  return (raDados.mesarios || []).find(a => a.id === atorId)
    || (raDados.coord || []).find(a => a.id === atorId)
    || (raDados.auxiliares || []).find(a => a.id === atorId)
    || (raDados.junta || []).find(a => a.id === atorId);
}

// "Deve devolver" continua sempre DERIVADO (nunca uma flag gravada) — só
// que pra mesário o valor-base não é o pagamento inteiro, é a fração dos
// cargos que faltaram (`raValorADevolverMesa`); pras demais funções
// (coordenador/auxiliar/junta — pagamento individual de verdade, sem mesa)
// continua sendo a lógica binária de sempre.
function raDeveDevolver(a) {
  if (!a.auxilio_alimentacao_pago || a.auxilio_alimentacao_devolvido) return false;
  if (a.funcao === 'mesario') return raValorADevolverMesa(a) > 0;
  return a.auxilio_alimentacao_frequencia === 'faltou';
}
function raValorADevolver(a) {
  return a.funcao === 'mesario' ? raValorADevolverMesa(a) : Number(a.auxilio_alimentacao_valor_pago || 0);
}

// Marcar frequência — toque único (presente/faltou), mesmo padrão de toda
// ação rápida do projeto. Marcar "presente" nunca desfaz uma devolução já
// registrada (histórico) — só deixa de contar como "deve devolver" porque
// `raDeveDevolver`/`raValorADevolverMesa` exigem alguém marcado 'faltou'.
async function raMarcarFrequenciaCore(atorId, frequencia) {
  const sb = window.supabaseAtores;
  // Busca em TODO o cadastro carregado (não só `raDados.todos`) — os 3
  // cargos de mesa que não recebem pagamento direto (1º/2º Mesário, 1º
  // Secretário) também precisam ter a própria frequência marcada, e eles
  // só existem em `raDados.mesarios`, nunca em `todos`.
  const pessoa = raAcharAtorQualquer(atorId);
  if (!pessoa) return false;
  const { error } = await sb.from('sime_atores').update({ auxilio_alimentacao_frequencia: frequencia }).eq('id', atorId);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return false; }
  pessoa.auxilio_alimentacao_frequencia = frequencia;
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log('mesario_auxilio_alimentacao_frequencia', '', { ator_id: atorId, nome: pessoa.nome_completo, frequencia, autor });
  showToast(frequencia === 'presente' ? '✓ Marcado como presente' : '✓ Marcado como faltou');
  return true;
}
async function raMarcarFrequencia(atorId, frequencia) {
  await raMarcarFrequenciaCore(atorId, frequencia);
  renderControleUnificado();
}

// "Presença de toda a mesa" (05/10/2026, pedido direto) — a lista de
// Frequência e Devolução só mostra o Presidente por seção (herda o mesmo
// filtro de pagamento de `raDados.todos`: 1º/2º Mesário e 1º Secretário
// nunca aparecem aqui, ver nota em `raCarregar`). Marcar frequência um a
// um exigiria abrir os outros 3 cargos em outra tela — este botão marca
// os 4 cargos da mesma seção de uma vez, lendo de `raDados.mesarios`
// (lista cheia, não filtrada) em vez de `raDados.todos`.
async function raMarcarPresencaMesa(secaoId) {
  const membros = (raDados.mesarios || []).filter(a => a.secao_id === secaoId);
  if (!membros.length) return;
  const sb = window.supabaseAtores;
  const ids = membros.map(a => a.id);
  const { error } = await sb.from('sime_atores').update({ auxilio_alimentacao_frequencia: 'presente' }).in('id', ids);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return; }
  for (const m of membros) m.auxilio_alimentacao_frequencia = 'presente';
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log('mesario_auxilio_alimentacao_frequencia_mesa', '', { secao_id: secaoId, quantidade: membros.length, autor });
  showToast(`✓ Mesa inteira marcada como presente (${membros.length})`);
  renderControleUnificado();
}

// Modal "❌ Faltou" (06/10/2026, pedido direto: "quando marcar em faltou,
// deve abrir um modal para indicar qual membro da mesa faltou e não foi
// substituido" + "tambem pode acontecer de faltar o recibo e a mesa
// funcionar completa") — ponto único pra editar a frequência dos 4 cargos
// E o recibo ausente de uma seção, em vez de 4 pares de botão solto
// (ver `raHtmlResumoMesa`, que virou só leitura). Reaproveita o mesmo
// #overlay/#modal-body compartilhado da página (`raAbrirModal`/
// `raAbrirModalVeiculo` já usam o mesmo elemento).
function raAbrirModalFalta(secaoId) {
  raModalId = null; // garante que um salvamento pendente do modal por pessoa não redesenhe por cima deste
  raModalVeiculoId = null;
  raModalFaltaSecaoId = secaoId;
  const membros = raMesaMembros(secaoId);
  raModalFaltaSelecionados = {};
  for (const m of membros) raModalFaltaSelecionados[m.id] = m.auxilio_alimentacao_frequencia === 'faltou';
  raModalFaltaReciboAusente = raMesaReciboAusente(secaoId);
  document.getElementById('overlay')?.classList.add('open');
  raRenderModalFalta();
}

function raFecharModalFalta(e) {
  if (!e || e.target === document.getElementById('overlay')) {
    document.getElementById('overlay')?.classList.remove('open');
    raModalFaltaSecaoId = null;
  }
}

function raModalFaltaToggleMembro(atorId, checked) {
  raModalFaltaSelecionados[atorId] = checked;
}
function raModalFaltaToggleRecibo(checked) {
  raModalFaltaReciboAusente = checked;
}

function raRenderModalFalta() {
  const modal = document.getElementById('modal-body');
  if (!modal) return;
  modal.classList.remove('cm-modal-wide'); // defensivo — #modal-body é compartilhado
  const secaoId = raModalFaltaSecaoId;
  const membros = raMesaMembros(secaoId)
    .slice()
    .sort((x, y) => RA_ORDEM_MESA.indexOf(x.funcao_mesa) - RA_ORDEM_MESA.indexOf(y.funcao_mesa));
  if (!membros.length) { modal.innerHTML = ''; return; }
  const sec = membros[0].sec;

  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div>
        <div style="font-weight:800">Frequência da mesa${sec ? ` — Seção ${sec.numero}` : ''}</div>
        <div class="ic-sub" style="margin-bottom:0">${sec ? `${raEsc(sec.local_nome || '')}, ${raEsc(sec.municipio || '')}` : ''}</div>
      </div>
      <button onclick="raFecharModalFalta()" aria-label="Fechar" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text2);line-height:1">✕</button>
    </div>
    <div class="ic-sub" style="margin-top:8px">Marque quem faltou e não foi substituído — o valor a devolver é
      calculado sozinho (valor pago ÷ 4 × quantos ficarem marcados aqui). Quem não for marcado é considerado
      presente.</div>

    <div class="form-group" style="margin-top:10px">
      ${membros.map(m => `
        <label style="display:flex;align-items:center;gap:8px;padding:7px 0;cursor:pointer">
          <input type="checkbox" ${raModalFaltaSelecionados[m.id] ? 'checked' : ''} onchange="raModalFaltaToggleMembro('${m.id}', this.checked)">
          <span>${raEsc(m.funcao_mesa || raFuncaoLabel(m))} — ${raEsc(m.nome_completo)}</span>
        </label>`).join('')}
    </div>

    <div style="margin:10px 0 4px;padding-top:10px;border-top:1px solid var(--border2)">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" ${raModalFaltaReciboAusente ? 'checked' : ''} onchange="raModalFaltaToggleRecibo(this.checked)">
        <span>📄 Recibo não foi assinado/recolhido (mesmo com a mesa completa)</span>
      </label>
      <div class="ic-sub" style="margin:4px 0 0 26px">Nunca gera devolução — é só uma pendência de documentação, independente de quem compareceu.</div>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-out" onclick="raFecharModalFalta()">Cancelar</button>
      <button class="btn btn-dark" onclick="raConfirmarModalFalta()">💾 Salvar</button>
    </div>`;
}

async function raConfirmarModalFalta() {
  const secaoId = raModalFaltaSecaoId;
  if (!secaoId) return;
  const sb = window.supabaseAtores;
  const membros = raMesaMembros(secaoId);
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';

  // Frequência — só grava quem de fato mudou (nunca reescreve à toa quem já
  // estava marcado igual), um UPDATE por pessoa (mesmo caminho/log de
  // `raMarcarFrequenciaCore`, pra entrar certinho em "📜 Atualizações").
  for (const m of membros) {
    const faltou = !!raModalFaltaSelecionados[m.id];
    const nova = faltou ? 'faltou' : 'presente';
    if (m.auxilio_alimentacao_frequencia !== nova) {
      const ok = await raMarcarFrequenciaCore(m.id, nova);
      if (!ok) return; // erro já mostrado pelo toast de dentro; mantém o modal aberto pra tentar de novo
    }
  }

  // Recibo ausente só é gravado na linha do Presidente (mesma linha que já
  // carrega pix/documento/valor_pago da seção) — nunca grava quando não
  // mudou, mesmo critério de sempre.
  const presidente = membros.find(m => m.funcao_mesa === 'Presidente');
  if (presidente && !!presidente.auxilio_alimentacao_recibo_ausente !== raModalFaltaReciboAusente) {
    const { error } = await sb.from('sime_atores').update({ auxilio_alimentacao_recibo_ausente: raModalFaltaReciboAusente }).eq('id', presidente.id);
    if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return; }
    presidente.auxilio_alimentacao_recibo_ausente = raModalFaltaReciboAusente;
    await log('mesario_auxilio_alimentacao_recibo_ausente', '', { ator_id: presidente.id, secao_id: secaoId, recibo_ausente: raModalFaltaReciboAusente, autor });
  }

  showToast('✓ Frequência da mesa atualizada');
  raFecharModalFalta();
  renderControleUnificado();
}

// Devolução — grava a data/hora da devolução; desmarcar limpa a data mas
// nunca apaga `frequencia`/`pago` (são sinais independentes).
async function raToggleDevolvidoCore(atorId, marcarDevolvido) {
  const sb = window.supabaseAtores;
  const pessoa = (raDados.todos || []).find(a => a.id === atorId);
  if (!pessoa) return false;
  // Valor logado é sempre o calculado NO MOMENTO (fração por faltantes pra
  // mesário, valor pago inteiro pros demais) — nunca o `valor_pago` cru,
  // que pra mesário é o R$260 inteiro do Presidente, não o que de fato
  // precisa ser devolvido.
  const valor = raValorADevolver(pessoa);
  const payload = marcarDevolvido
    ? { auxilio_alimentacao_devolvido: true, auxilio_alimentacao_devolvido_em: new Date().toISOString() }
    : { auxilio_alimentacao_devolvido: false, auxilio_alimentacao_devolvido_em: null };
  const { error } = await sb.from('sime_atores').update(payload).eq('id', atorId);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return false; }
  Object.assign(pessoa, payload);
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log(marcarDevolvido ? 'mesario_auxilio_alimentacao_devolvido' : 'mesario_auxilio_alimentacao_devolvido_desfeito', '', { ator_id: atorId, nome: pessoa.nome_completo, valor, autor });
  showToast(marcarDevolvido ? '✓ Devolução registrada' : '↺ Devolução desfeita');
  return true;
}
async function raToggleDevolvido(atorId, marcarDevolvido) {
  await raToggleDevolvidoCore(atorId, marcarDevolvido);
  renderControleUnificado();
}

const RA_DEV_SITUACAO_FILTRO = [
  { valor: '', label: 'Todas as situações' },
  { valor: 'deve_devolver', label: '⚠️ Deve devolver' },
  { valor: 'devolvido', label: '✅ Já devolveu' },
  { valor: 'presente', label: 'Presente' },
  { valor: 'sem_marcar', label: 'Sem frequência marcada' },
  { valor: 'recibo_ausente', label: '📄 Recibo ausente (mesa completa)' },
];

// Resumo SÓ LEITURA dos 4 cargos da mesa — editar quem faltou é sempre pelo
// modal (06/10/2026, pedido direto: "quando marcar em faltou, deve abrir um
// modal para indicar qual membro da mesa faltou e não foi substituido").
// Antes disso cada cargo tinha seu próprio par de botões Presente/Faltou
// sempre visível aqui embaixo — virou um botão só (❌ Faltou, na linha do
// Presidente) que abre o modal com os 4 de uma vez; esta função só mostra o
// que já foi marcado, pra não precisar reabrir o modal só pra conferir.
// Mostrada SEMPRE abaixo da linha do Presidente (ele também aparece aqui,
// como qualquer outro cargo — a linha de cima só existe porque é a que
// carrega o pagamento/PIX/recibo).
function raHtmlResumoMesa(secaoId) {
  const membros = raMesaMembros(secaoId)
    .slice()
    .sort((x, y) => RA_ORDEM_MESA.indexOf(x.funcao_mesa) - RA_ORDEM_MESA.indexOf(y.funcao_mesa));
  if (!membros.length) return '';
  const reciboAusente = raMesaReciboAusente(secaoId);
  if (raMesaNenhumMarcado(secaoId) && !reciboAusente) return '';
  return `
    <div style="display:flex;flex-direction:column;gap:3px;margin-top:6px;padding:7px 9px;background:var(--bg2);border-radius:7px">
      ${membros.map(m => `
        <div style="display:flex;align-items:center;gap:6px;font-size:.76rem">
          <span>${m.auxilio_alimentacao_frequencia === 'faltou' ? '❌' : m.auxilio_alimentacao_frequencia === 'presente' ? '✅' : '➖'}</span>
          <span>${raEsc(m.funcao_mesa || raFuncaoLabel(m))} — ${raEsc(m.nome_completo)}${m.auxilio_alimentacao_frequencia === 'faltou' ? ' (faltou, não substituído)' : ''}</span>
        </div>`).join('')}
      ${reciboAusente ? `<div style="font-size:.76rem;color:var(--text2)">📄 Recibo não foi assinado/recolhido — mesa funcionou completa.</div>` : ''}
    </div>`;
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
  const resumo = raCtlResumo();
  c.innerHTML = `
    <div class="import-card">
      <div class="ic-title">🍽️ Auxílio Alimentação</div>
      <div class="ic-sub">Gerar os recibos pra assinatura no papel (aba "🖨️ Impressão") é uma coisa; controlar
        pagamento, frequência e devolução (aba "💰📋 Controle de pagamento e frequência") é outra — as duas ficam
        separadas pra não misturar o documento com o controle do cartório.</div>
    </div>

    <div class="import-card" style="padding:10px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn ${raSubTab === 'impressao' ? 'btn-dark' : 'btn-out'}" style="flex:1;min-width:180px" onclick="raMudarSubTab('impressao')">🖨️ Impressão</button>
        <button class="btn ${raSubTab === 'controle' ? 'btn-dark' : 'btn-out'}" style="flex:1;min-width:180px" onclick="raMudarSubTab('controle')">💰📋 Controle de pagamento e frequência — ${resumo.pagos}/${resumo.total}${resumo.conflitos ? ' ⚠️' : ''}${resumo.deveDevolver ? ` · ⚠️ ${resumo.deveDevolver} a devolver` : ''}</button>
      </div>
    </div>

    ${raSubTab === 'controle' ? raHtmlSecaoControle() : raHtmlSecaoImpressao(cfg)}
    ${raSubTab === 'controle' ? raHtmlSecaoVeiculos() : ''}
  `;
  if (raSubTab === 'controle') renderControleUnificado();
  if (raSubTab === 'controle') renderControleVeiculos();
}
