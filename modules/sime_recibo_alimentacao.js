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

// Filtro por função (30/09/2026, pedido direto: "quero poder filtrar
// somente os presidentes, somente os coordenadores ou somente os
// auxiliares") + por município (mesmo pedido, "e filtrar por municipio
// também") — mesmo padrão já usado em "Contatar mesários"
// (CM_FUNCAO_FILTRO/cmFiltroMunicipio, sime_contatar_mesarios.js), dois
// filtros independentes que se combinam com o de status e a busca.
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
let raPagFiltroFuncao = '';
let raPagFiltroMunicipio = '';

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
      .select('id, nome_completo, funcao, funcao_mesa, secao_id, inscricao_eleitoral, auxilio_alimentacao_pago, auxilio_alimentacao_valor_pago, auxilio_alimentacao_pago_em, auxilio_alimentacao_documento, pix, observacao')
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

// Lista única pros MOTORISTAS de repartições (veículos à disposição) — mesmo
// padrão de raHtmlListaFlat (sem agrupar por local, sem Seção/Inscrição/
// Função, que não fazem sentido pra um veículo), com colunas próprias:
// Veículo|Placa|Motorista|Lotação|Assinatura. Sai em DUAS páginas no mesmo
// clique (Sábado D-1/Domingo Dia D), mesmo motivo de Auxiliares de Eleição —
// motorista trabalha e recebe auxílio nos dois dias.
function raHtmlListaFlatVeiculos(titulo, subtituloDia, veiculos, cfg, localTexto, numeroPagina) {
  return `
    <div class="ra-pagina">
      ${raHtmlTimbre(titulo, subtituloDia, cfg, numeroPagina)}
      <div class="ra-linha-info">
        <span><b>Forma de Auxílio:</b> ${raEsc(cfg.forma)} &nbsp; <b>Valor:</b> ${raFmtValor(cfg.valor)}</span>
      </div>
      <table class="ra-tabela">
        <colgroup><col><col class="ra-col-insc"><col><col><col class="ra-col-assin"></colgroup>
        <thead><tr><th>Veículo</th><th>Placa</th><th>Motorista</th><th>Lotação</th><th>Assinatura</th></tr></thead>
        <tbody>${veiculos.map(v => `
          <tr>
            <td>${raEsc(v.veiculo || '—')}</td>
            <td>${raEsc(v.placa || '—')}</td>
            <td>${raEsc(v.motorista_nome)}</td>
            <td>${raEsc(v.lotacao || '—')}</td>
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

// Recibo pros Motoristas de Repartições — mesmo padrão de duas páginas de
// raImprimirAuxiliares (Sábado D-1/Domingo Dia D, num único window.print()),
// pedido direto: "quero que apareça, na parte de pagamento do auxilio...
// inclusive imprimindo recibo do sabado e domingo". Motorista de veículo
// cedido trabalha nos dois dias da operação (D-1 saída do cartório, Dia D
// recolhimento), mesmo motivo já documentado pros Auxiliares de Eleição.
async function raImprimirMotoristas() {
  if (!raDadosVeiculos.length) { showToast('⚠ Nenhum motorista de repartição cadastrado'); return; }
  const veiculos = [...raDadosVeiculos].sort((a, b) => (a.motorista_nome || '').localeCompare(b.motorista_nome || '', 'pt-BR'));
  const cfg = raCfg();
  const html =
    raHtmlListaFlatVeiculos('Recibo de Auxílio Alimentação — Motoristas de Repartições', 'Sábado (D-1)', veiculos, cfg, cfg.zonaTexto, 1) +
    raHtmlListaFlatVeiculos('Recibo de Auxílio Alimentação — Motoristas de Repartições', 'Domingo (Dia D)', veiculos, cfg, cfg.zonaTexto, 2);
  await raImprimirDocumento(html, 'recibo_alimentacao_motoristas_impresso', veiculos.length);
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
// sentido) — por isso ignora deliberadamente `raPagFiltroStatus` (que na
// tela pode estar em "Pendentes") e aplica só função/município/busca, que
// continuam valendo pra deixar o relatório restrito ao recorte que o
// cartório já tiver filtrado na tela antes de imprimir.
function raListaPagosRelatorio() {
  const q = raPagBusca.trim().toLowerCase();
  return (raDados.todos || []).filter(a => {
    if (!a.auxilio_alimentacao_pago) return false;
    if (raPagFiltroFuncao && a.funcao !== raPagFiltroFuncao) return false;
    if (raPagFiltroMunicipio && (a.sec?.municipio || '') !== raPagFiltroMunicipio) return false;
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
    if (raPagFiltroFuncao && a.funcao !== raPagFiltroFuncao) return false;
    if (raPagFiltroMunicipio && (a.sec?.municipio || '') !== raPagFiltroMunicipio) return false;
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
function raPagMudarFiltroFuncao(v) {
  raPagFiltroFuncao = v;
  renderControlePagamento();
}
function raPagMudarFiltroMunicipio(v) {
  raPagFiltroMunicipio = v;
  renderControlePagamento();
}
function raPagResumo() {
  const todos = raDados.todos || [];
  const pagos = todos.filter(a => a.auxilio_alimentacao_pago);
  const totalPago = pagos.reduce((s, a) => s + Number(a.auxilio_alimentacao_valor_pago || 0), 0);
  const conflitos = todos.filter(a => raOutrosPapeis(a).length > 0).length;
  return { total: todos.length, pagos: pagos.length, totalPago, conflitos };
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
  renderControlePagamento();
}

async function raModalTogglePago(atorId, marcarPago) {
  const valorEl = document.getElementById('ra-modal-valor');
  const valorDigitado = valorEl ? parseFloat(String(valorEl.value).replace(',', '.')) : NaN;
  await raTogglePagoCore(atorId, marcarPago, valorDigitado);
  renderControlePagamento();
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
  if (!(valor >= 0)) { showToast('⚠ Valor inválido'); renderControlePagamento(); return; }
  await raSalvarValorPagoCore(atorId, valor);
}

async function raModalSalvarValorPago(atorId, valorStr) {
  const valor = parseFloat(String(valorStr).replace(',', '.'));
  if (!(valor >= 0)) { showToast('⚠ Valor inválido'); if (raModalId === atorId) raRenderModal(); return; }
  await raSalvarValorPagoCore(atorId, valor);
  renderControlePagamento();
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
      <button class="btn btn-out" style="margin-top:8px" onclick="raImprimirMotoristas()">🖨️ Imprimir recibos — Sábado e Domingo</button>
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

// ── Sub-abas: Impressão × Controle de pagamento (29/09/2026, pedido
// direto: "melhore a aba de auxilio alimentação, com uma parte separada só
// para impressão"). Antes, os 4 cards de gerar recibo e o card de controle
// de pagamento ficavam todos numa coluna só, sem separação — a lista de
// pagamento (que pode ter dezenas de linhas) empurrava os botões de
// impressão pra bem longe de onde a aba abre. Virou um alternador de 2
// botões (`.btn-dark`/`.btn-out`, mesmo par já usado em toda ação de status
// rápido do projeto — não reaproveita `.tab`/`.tabs`, que é controlado por
// `goTab()`/`document.querySelectorAll('.tab')` das abas PRINCIPAIS da
// página; usar a mesma classe aqui faria esse seletor pegar estes botões
// também) — nasce em "Impressão" (`raSubTab`), o mesmo comportamento de
// sempre pra quem nunca trocou de sub-aba. ──
let raSubTab = 'impressao'; // 'impressao' | 'pagamento'

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

function raHtmlSecaoPagamento() {
  return `
    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">💰 Controle de pagamento</div>
      <div class="ic-sub">Quem já recebeu o auxílio de verdade — separado do documento impresso na aba
        "🖨️ Impressão" (aquele é só o papel pra assinatura, este é o controle interno do cartório). Da mesa
        receptora, só o Presidente recebe pagamento direto (R$260 — repassa aos outros 3 da mesa fora do sistema,
        por isso só ele aparece aqui). Auxiliar de eleição recebe por dia trabalhado (R$65 só domingo, R$130
        sábado + domingo — use o seletor 🗓️ ao lado do valor). Valor sempre editável, nunca travado.</div>
      <div style="margin-top:8px">
        <button class="btn btn-out" onclick="raImprimirRelatorioPagamentos()">🖨️ Imprimir relatório (valores pagos + documentos)</button>
        <div class="ic-sub" style="margin-top:4px">Imprime só quem já está marcado como pago — respeita os filtros de função/município/busca abaixo, ignora o de status.</div>
      </div>
      <div id="ra-controle-pagamento" style="margin-top:8px"></div>
    </div>`;
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
  const contagemFuncao = {};
  for (const a of raDados.todos || []) contagemFuncao[a.funcao] = (contagemFuncao[a.funcao] || 0) + 1;
  const municipios = [...new Set((raDados.todos || []).map(a => a.sec?.municipio).filter(Boolean))].sort();

  alvo.innerHTML = `
    <div class="ic-sub" style="margin:0 0 8px">${resumo.pagos} de ${resumo.total} já pagos — total pago: ${raFmtValor(resumo.totalPago)}.${resumo.conflitos ? ` <b style="color:var(--red)">⚠️ ${resumo.conflitos} com papel duplicado — confira antes de marcar como pago.</b>` : ''}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      <input type="text" id="ra-pag-busca" value="${raEsc(raPagBusca)}" oninput="raOnPagBuscaInput(this.value)" placeholder="Buscar por nome ou seção…" style="flex:1;min-width:160px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
      <select onchange="raPagMudarFiltroStatus(this.value)" style="padding:8px 10px;border-radius:7px">
        <option value="pendente" ${raPagFiltroStatus === 'pendente' ? 'selected' : ''}>Pendentes</option>
        <option value="pago" ${raPagFiltroStatus === 'pago' ? 'selected' : ''}>Pagos</option>
        <option value="" ${raPagFiltroStatus === '' ? 'selected' : ''}>Todos</option>
      </select>
      <select onchange="raPagMudarFiltroFuncao(this.value)" style="padding:8px 10px;border-radius:7px">
        ${RA_FUNCAO_FILTRO.map(f => `<option value="${f.valor}" ${raPagFiltroFuncao === f.valor ? 'selected' : ''}>${f.label}${f.valor ? ` (${contagemFuncao[f.valor] || 0})` : ` (${(raDados.todos || []).length})`}</option>`).join('')}
      </select>
      <select onchange="raPagMudarFiltroMunicipio(this.value)" style="padding:8px 10px;border-radius:7px">
        <option value="" ${raPagFiltroMunicipio === '' ? 'selected' : ''}>Todos os municípios</option>
        ${municipios.map(m => `<option value="${raEsc(m)}" ${raPagFiltroMunicipio === m ? 'selected' : ''}>${raEsc(m)}</option>`).join('')}
      </select>
    </div>
    <div class="m-hist" style="max-height:480px;overflow-y:auto">
      ${lista.length ? lista.map(a => {
        const outros = raOutrosPapeis(a);
        return `
      <div class="m-hist-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
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
      </div>`;
      }).join('') : '<div class="ic-sub" style="margin:0">Nenhum registro encontrado.</div>'}
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
  const resumoPag = raPagResumo();
  c.innerHTML = `
    <div class="import-card">
      <div class="ic-title">🍽️ Auxílio Alimentação</div>
      <div class="ic-sub">Gerar os recibos pra assinatura no papel (aba "🖨️ Impressão") é uma coisa; saber quem já
        recebeu o auxílio de verdade (aba "💰 Controle de pagamento") é outra — as duas ficam separadas pra não
        misturar o documento com o acompanhamento do cartório.</div>
    </div>

    <div class="import-card" style="padding:10px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn ${raSubTab === 'impressao' ? 'btn-dark' : 'btn-out'}" style="flex:1;min-width:180px" onclick="raMudarSubTab('impressao')">🖨️ Impressão</button>
        <button class="btn ${raSubTab === 'pagamento' ? 'btn-dark' : 'btn-out'}" style="flex:1;min-width:180px" onclick="raMudarSubTab('pagamento')">💰 Controle de pagamento — ${resumoPag.pagos}/${resumoPag.total}${resumoPag.conflitos ? ' ⚠️' : ''}</button>
      </div>
    </div>

    ${raSubTab === 'pagamento' ? raHtmlSecaoPagamento() : raHtmlSecaoImpressao(cfg)}
    ${raSubTab === 'pagamento' ? raHtmlSecaoVeiculos() : ''}
  `;
  if (raSubTab === 'pagamento') renderControlePagamento();
  if (raSubTab === 'pagamento') renderControleVeiculos();
}
