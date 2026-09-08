// sime_rotas_modulo.js — módulo "🗺️ Rotas" (SIME_rotas.html, 04/09/2026).
//
// Pedido direto: "vamos fazer um modulo de rotas precisa ser rota poder
// cadastrar rotas de recolhimento de midias, distribuição e recolhimento de
// urnas, rotas de instalação de seção".
//
// Contexto que faltava antes disso existir: `sime_rotas` já existia, mas sem
// nenhum jeito de dizer PRA QUE ela serve — as 35 linhas atuais da 7ª Zona (+7
// da 94ª) vieram do export do MaxLog (Sistema de Logística das Eleições do
// TRE, 31/08/2026) e — CONFIRMADO com o dono do projeto em 04/09/2026, antes
// de mexer no schema — cobrem ida (distribuição) E volta (recolhimento de
// urna) pelo MESMO trajeto físico (mesmo veículo leva a urna e traz de
// volta); `urnas_estimadas` preenchido em quase todas bate com isso, não com
// recolhimento de mídia (cartão de memória, logística bem mais leve). Ver
// sql/SIME_rotas_modulo.sql pro detalhe da migração (`sime_rotas.tipos[]` +
// tabela nova `sime_rota_secoes`).
//
// Por que uma rota pode ter mais de um tipo (array, não um valor só): as 42
// rotas atuais já são exatamente esse caso (distribuição + recolhimento de
// urna, mesmo cadastro pros dois sentidos) — um enum de valor único não
// serviria nem pro dado que já existe.
//
// Por que uma seção pode estar em MAIS de uma rota ao mesmo tempo (tabela de
// junção `sime_rota_secoes`, não mais um FK único): uma seção pode precisar
// de uma rota de instalação (D-X, convocado externo) DIFERENTE da rota de
// distribuição/recolhimento de urna (D-1/Dia D) — datas e veículos diferentes,
// não dá pra guardar num único `sime_secoes.rota_id`.
//
// `sime_secoes.rota_id`/`parada` CONTINUAM existindo e são a fonte real pra
// quem já lê direto de lá sem passar por este módulo (Motorista, Conferente,
// TV Distribuição, sime_dados.js getRotas/getSecoes) — por isso toda escrita
// aqui que mexe numa rota com tipo 'distribuicao' ou 'recolhimento_urna'
// também atualiza esses dois campos (rtRotaTemTipoLegado), pra edição feita
// aqui valer de verdade nos módulos operacionais. Pra 'recolhimento_midia' e
// 'instalacao' — que não têm consumidor legado nenhum ainda — só
// `sime_rota_secoes` é tocada.

const RT_TIPO_LABEL = {
  distribuicao: '🚚 Distribuição de urnas',
  recolhimento_urna: '🗳️ Recolhimento de urnas',
  recolhimento_midia: '📦 Recolhimento de mídias',
  instalacao: '🛠️ Instalação de seção',
};
const RT_TIPOS = Object.keys(RT_TIPO_LABEL);
// Tipos que já têm consumidor legado (sime_secoes.rota_id/parada) — decide
// se uma escrita em sime_rota_secoes precisa espelhar pra lá também.
//
// Só 'distribuicao' (04/09/2026, corrigido no mesmo dia em que foi
// escrito) — 'recolhimento_urna' foi removido daqui: recolhimento de urna
// é a rota de distribuição invertida e em OUTRO DIA (confirmado com o
// dono do projeto), não a mesma linha; como sime_secoes.rota_id é uma FK
// única por seção, não dava pra guardar os dois sentidos ali ao mesmo
// tempo. Vira cadastro próprio (rota_origem_id aponta pra rota de
// distribuição de origem, quando gerada como retorno de uma).
const RT_TIPOS_LEGADO = ['distribuicao'];

// Status operacional de Dia D/D-1 (08/09/2026, melhoria própria) — quem
// grava é o Conferente (SIME_conferente.html, embarque de urna) e quem
// mostra em telão é a TV Distribuição; sime_rotas_estado/sime_rotas_urnas
// já existiam pra isso (sql/SIME_schema.sql), só nunca eram lidas aqui. O
// módulo de Rotas é só leitura desse status — escrever continua sendo
// trabalho do Conferente (que tem o RPC sime_rota_estado_upsert/
// sime_rota_urna_toggle com fila offline própria); aqui é só um resumo pro
// cartório não precisar abrir a TV/Conferente pra saber como uma rota está
// indo. Só busca quando há eleição ativa pra zona — sem isso não existe
// "eleicao_id" nenhum pra filtrar (sime_rotas_estado é por eleição, não por
// zona direto).
const RT_STATUS_ESTADO_LABEL = {
  aguardando: '⏳ Aguardando',
  embarcando: '📦 Embarcando',
  pronta: '✅ Pronta',
  alerta: '⚠️ Alerta',
  saiu: '🚚 Saiu',
};
function rtFmtTs(ts) {
  if (!ts) return null;
  try { return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return null; }
}

// Tempo total estimado do percurso (08/09/2026, pedido direto: "quero poder
// estimar o tempo de parada para calcular o total do percurso da rota") —
// `tempo_parada_min` é minutos médios parado em CADA local de votação;
// multiplicado pelo número de paradas dá o tempo total parado. Não tenta
// estimar deslocamento entre paradas (exigiria uma API paga de rotas, fora
// do orçamento R$ 0,00/mês do projeto) — é só o tempo parado mesmo, somado
// ao horário de saída como uma estimativa mínima (o percurso real é esse
// tempo MAIS o deslocamento, que o cartório calcula por fora/no mapa).
function rtTempoTotalParadasMin(rota, totalParadas) {
  if (rota.tempo_parada_min == null || !totalParadas) return null;
  return rota.tempo_parada_min * totalParadas;
}
function rtFmtMinutos(min) {
  if (min == null) return null;
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}h${m ? ` ${m}min` : ''}` : `${m}min`;
}
function rtSomarMinutos(horaStr, minutos) {
  const h = rtFmtHora(horaStr);
  if (!h || minutos == null) return null;
  const [hh, mm] = h.split(':').map(Number);
  const total = hh * 60 + mm + minutos;
  const hFinal = Math.floor((total % (24 * 60)) / 60), mFinal = total % 60;
  return `${String(hFinal).padStart(2, '0')}:${String(mFinal).padStart(2, '0')}`;
}

// Previsão de chegada estimada (08/09/2026, pedido direto: "como o sistema
// calcula a rota pelo google maps e tempo medio de espera de 10 minutos em
// cada local conseguimos calcular automaticamente a previsão de chegada?"
// — esclarecido com o dono do projeto antes de implementar: o SIME NUNCA
// consultou o Google de verdade, só gera um LINK gratuito pra abrir no
// mapa; calcular deslocamento real exigiria a API paga do Google
// (Directions/Distance Matrix), fora do orçamento R$ 0,00/mês. Escolhida a
// opção "estimativa em linha reta": distância HAVERSINE entre as
// coordenadas já cadastradas (não segue estrada nenhuma) ÷ uma velocidade
// média FIXA assumida pra estrada de zona rural, somada ao tempo parado de
// sempre (`rtTempoTotalParadasMin`). Sempre rotulada como estimativa
// aproximada — nunca grava sozinha, só pré-preenche `#rt-hora-chegada`
// quando esse campo ainda está vazio (mesmo critério de "sugestão, nunca
// força" já usado pra ponto de partida/destino).
const RT_VELOCIDADE_MEDIA_KMH = 40; // fixo nesta v1 — não é config por rota, é só uma aproximação de estrada rural sem asfalto
function rtHaversineKm(a, b) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}
// Só calcula quando TODAS as paradas têm geo (nunca subestima em silêncio
// pulando uma perna sem coordenada) e quando já há horário de saída e
// tempo por parada preenchidos — sem os dois não tem o que somar.
function rtChegadaEstimada(rota, paradas) {
  if (!rota.horario_saida || rota.tempo_parada_min == null || !paradas.length) return null;
  if (paradas.some(s => s.latitude == null || s.longitude == null)) return null;
  let travelKm = 0;
  for (let i = 1; i < paradas.length; i++) travelKm += rtHaversineKm(paradas[i - 1], paradas[i]);
  const travelMin = Math.round(travelKm / RT_VELOCIDADE_MEDIA_KMH * 60);
  const dwellMin = rtTempoTotalParadasMin(rota, paradas.length) || 0;
  const horario = rtSomarMinutos(rota.horario_saida, travelMin + dwellMin);
  if (!horario) return null;
  return { horario, travelKm, travelMin, dwellMin };
}

// URL do Google Maps Directions (sem chave/custo) — usado tanto pro link
// "Ver rota completa no mapa" (tela) quanto pro QR code da ficha impressa
// (rtHtmlFicha). Extraído aqui pra não duplicar a lógica entre os dois
// lugares.
//
// 08/09/2026, pedido direto: "o destino deve ser incluido no mapa de
// rotas" — origem/destino SEMPRE priorizam o TEXTO digitado em "Ponto de
// partida"/"Destino" (o Google geocodifica o endereço/nome sozinho, de
// graça, ao abrir o link) — é o valor que reflete a intenção real da rota,
// que pode não ser nenhuma parada geolocalizada (ex.: "Cartório Eleitoral
// da 7ª Zona", numa rota de distribuição). Só cai pra coordenada da
// 1ª/última parada quando o campo de texto correspondente está vazio.
function rtMapsUrl(rota, paradas) {
  const comGeo = paradas.filter(s => s.latitude != null && s.longitude != null);
  const origemTexto = (rota.ponto_partida || '').trim();
  const destinoTexto = (rota.destino || '').trim();
  const origin = origemTexto ? encodeURIComponent(origemTexto) : (comGeo[0] ? `${comGeo[0].latitude},${comGeo[0].longitude}` : null);
  const destination = destinoTexto ? encodeURIComponent(destinoTexto) : (comGeo.length ? `${comGeo[comGeo.length - 1].latitude},${comGeo[comGeo.length - 1].longitude}` : null);
  if (!origin || !destination) return null;
  // Waypoints: as paradas geolocalizadas que não foram elas mesmas usadas
  // como origem/destino acima (evita repetir o mesmo ponto duas vezes).
  let meio = comGeo;
  if (!origemTexto && meio.length) meio = meio.slice(1);
  if (!destinoTexto && meio.length) meio = meio.slice(0, -1);
  const waypoints = meio.length ? `&waypoints=${meio.map(s => `${s.latitude},${s.longitude}`).join('|')}` : '';
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints}`;
}

// Mapa esquemático da rota, pra imprimir (08/09/2026, pedido direto: "em
// imprimir ficha conseguimos gerar para imprimir um mapa da rota?") — SVG
// desenhado a partir das coordenadas já cadastradas, sem depender de rede
// nem de API paga (diferente de um mapa de verdade, com ruas — isso exigiria
// um serviço de mapa estático, pago ou de terceiro). É um ESQUEMA: liga os
// pontos em linha reta, na ordem das paradas, só pra dar uma noção visual
// de onde cada seção fica em relação às outras — não segue estrada nenhuma,
// texto do rodapé deixa isso explícito. Só desenha com pelo menos 2 paradas
// geolocalizadas (1 ponto sozinho não forma mapa nenhum).
function rtSvgMinimapa(paradas) {
  const comGeo = paradas.filter(s => s.latitude != null && s.longitude != null);
  if (comGeo.length < 2) return '';
  const W = 560, H = 320, PAD = 26;
  const lats = comGeo.map(s => s.latitude), lons = comGeo.map(s => s.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const spanLat = (maxLat - minLat) || 0.001, spanLon = (maxLon - minLon) || 0.001;
  const x = lon => PAD + ((lon - minLon) / spanLon) * (W - 2 * PAD);
  const y = lat => PAD + (1 - (lat - minLat) / spanLat) * (H - 2 * PAD); // inverte: latitude maior = mais ao norte = mais acima
  const pontos = comGeo.map(s => ({ ...s, sx: x(s.longitude), sy: y(s.latitude) }));
  const linha = pontos.map(p => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(' ');
  const marcadores = pontos.map((p, i) => {
    const cor = i === 0 ? '#1a7a3c' : (i === pontos.length - 1 ? '#b3261e' : '#2a2a2a');
    return `<circle cx="${p.sx.toFixed(1)}" cy="${p.sy.toFixed(1)}" r="10" fill="${cor}" stroke="#fff" stroke-width="1.5"/>
      <text x="${p.sx.toFixed(1)}" y="${(p.sy + 3.5).toFixed(1)}" text-anchor="middle" font-size="9.5" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-weight="bold">${i + 1}</text>
      <text x="${p.sx.toFixed(1)}" y="${(p.sy + 22).toFixed(1)}" text-anchor="middle" font-size="8" fill="#000" font-family="Arial,Helvetica,sans-serif">${rtEsc(String(p.numero))}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;display:block;border:1px solid #999;background:#f5f3ee" xmlns="http://www.w3.org/2000/svg">
    <polyline points="${linha}" fill="none" stroke="#666" stroke-width="2" stroke-dasharray="6,4"/>
    ${marcadores}
  </svg>`;
}

let rtDados = null; // { rotas:[...], secoesZona:[...], secoesPorRota: Map(rota_id -> [{...secao, parada}]), zonaId }
let rtFiltroTipo = '';
let rtBusca = '';
let rtBuscaTimer = null;
let rtModalId = null; // null = fechado; '' = criando nova rota; id = editando
let rtSecaoBusca = '';
let rtSecaoBuscaTimer = null;
let rtAdicionarAberto = false; // seção "Adicionar local de votação" (busca+lista), escondida atrás do botão "+" até o cartório clicar
let rtOrfasAberto = null; // tipo (string) com a lista de seções órfãs expandida, ou null
let rtGerandoRetornoDe = null; // id da rota de distribuição de origem, enquanto a "Nova rota" aberta é um rascunho de retorno gerado a partir dela

function rtEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function rtRotaTemTipoLegado(rota) {
  return !!(rota && (rota.tipos || []).some(t => RT_TIPOS_LEGADO.includes(t)));
}

// opts.silencioso: não chama render() nem mostra erro — usado quando quem
// chamou (rtAdicionarSecao/rtRemoverSecao/rtSalvarParada) precisa recarregar
// os dados por trás de um modal que já está aberto e vai se re-renderizar
// sozinho em seguida, sem piscar a tela toda.
async function rtCarregar(opts = {}) {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) {
    if (!opts.silencioso) { rtDados = { erro: 'Conta sem zona associada' }; render(); }
    return;
  }

  const eleicaoId = window.eleicaoIdAtual ? await window.eleicaoIdAtual() : null;

  const [{ data: rotas, error: e1 }, { data: secoesZona, error: e2 }, { data: rotaSecoes, error: e3 }, { data: atores, error: e4 }, { data: estados, error: e5 }] = await Promise.all([
    sb.from('sime_rotas').select('id, codigo, nome, municipios, tipos, itinerario, urnas_estimadas, ativo, ponto_partida, destino, horario_saida, horario_chegada_previsto, responsavel_ator_id, rota_origem_id, tempo_parada_min').eq('zona_id', zonaId).order('codigo'),
    sb.from('sime_secoes').select('id, numero, local_nome, municipio, rota_id, ativo, latitude, longitude').eq('zona_id', zonaId).eq('ativo', true).order('numero'),
    sb.from('sime_rota_secoes').select('rota_id, secao_id, parada'),
    // Pro <select> de "responsável pela rota" — qualquer ator ativo da zona
    // (não só mesário; um responsável de rota pode ser motorista, apoio
    // logístico, etc., não faz sentido restringir por função aqui).
    // telefone_whatsapp junto (08/09/2026) — a ficha impressa da rota
    // (rtImprimirFicha) mostra o contato do responsável pro motorista poder
    // ligar em caso de imprevisto.
    sb.from('sime_atores').select('id, nome_completo, telefone_whatsapp').eq('zona_id', zonaId).eq('ativo', true).order('nome_completo'),
    // Status operacional de Dia D (08/09/2026, só leitura — ver comentário
    // acima de RT_STATUS_ESTADO_LABEL). Sem eleição ativa não há
    // eleicao_id pra filtrar; nesse caso nem tenta.
    eleicaoId
      ? sb.from('sime_rotas_estado').select('id, rota_id, status, conferente_nome, ts_aberta, ts_pronta, ts_saiu, alerta').eq('eleicao_id', eleicaoId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (e1 || e2 || e3 || e4 || e5) {
    if (!opts.silencioso) { rtDados = { erro: (e1 || e2 || e3 || e4 || e5).message }; render(); }
    return;
  }

  const estadoIds = (estados || []).map(e => e.id);
  const { data: urnas } = estadoIds.length
    ? await sb.from('sime_rotas_urnas').select('rota_estado_id, secao_id, embarcada').in('rota_estado_id', estadoIds)
    : { data: [] };
  const estadoPorRota = new Map((estados || []).map(e => [e.rota_id, e]));
  const urnasPorEstado = new Map();
  for (const u of urnas || []) {
    if (!urnasPorEstado.has(u.rota_estado_id)) urnasPorEstado.set(u.rota_estado_id, []);
    urnasPorEstado.get(u.rota_estado_id).push(u);
  }

  const secoesPorId = new Map((secoesZona || []).map(s => [s.id, s]));
  const porRota = new Map();
  for (const rs of rotaSecoes || []) {
    const sec = secoesPorId.get(rs.secao_id);
    if (!sec) continue; // seção de outra zona, ou inativa — RLS/filtro já resolveu, isso é só defesa extra
    if (!porRota.has(rs.rota_id)) porRota.set(rs.rota_id, []);
    porRota.get(rs.rota_id).push({ ...sec, parada: rs.parada });
  }
  for (const arr of porRota.values()) arr.sort((a, b) => (a.parada ?? 999) - (b.parada ?? 999) || a.numero - b.numero);

  rtDados = { rotas: rotas || [], secoesZona: secoesZona || [], secoesPorRota: porRota, atores: atores || [], estadoPorRota, urnasPorEstado, zonaId };
  if (!opts.silencioso) render();
}

function rtNomeAtor(id) {
  if (!id) return null;
  return rtDados.atores?.find(a => a.id === id)?.nome_completo || null;
}
function rtAtor(id) {
  if (!id) return null;
  return rtDados.atores?.find(a => a.id === id) || null;
}
// "08:30" pro <input type=time>; aceita "08:30:00" (formato que o Postgres
// devolve pra TIME) e já vem pronto assim.
function rtFmtHora(h) {
  return h ? String(h).slice(0, 5) : null;
}

// Aviso de conflito: mesma pessoa responsável por duas rotas ATIVAS com
// horário sobreposto (08/09/2026, melhoria própria — mesmo espírito do
// aviso de conflito mesário×coordenador de acessibilidade já existente no
// Dashboard de Convocação). Só calcula quando as DUAS rotas têm
// horario_saida E horario_chegada_previsto preenchidos — sem os dois não
// dá pra saber se sobrepõe, e "nunca adivinha" vale aqui também: melhor
// não avisar do que avisar errado. Compara sempre normalizado por
// rtFmtHora() (sempre "HH:MM") — comparar "08:30" com "08:30:00" direto
// (formatos que convivem entre um valor recém-salvo e um lido do Postgres)
// dá resultado errado na comparação de string.
function rtHorariosSobrepoem(a, b) {
  const aIni = rtFmtHora(a.horario_saida), aFim = rtFmtHora(a.horario_chegada_previsto);
  const bIni = rtFmtHora(b.horario_saida), bFim = rtFmtHora(b.horario_chegada_previsto);
  if (!aIni || !aFim || !bIni || !bFim) return false;
  return aIni < bFim && bIni < aFim;
}
function rtConflitosDe(rota) {
  if (!rota.responsavel_ator_id || !rota.ativo) return [];
  return rtDados.rotas.filter(r => r.id !== rota.id && r.ativo && r.responsavel_ator_id === rota.responsavel_ator_id && rtHorariosSobrepoem(rota, r));
}

// Painel de seções órfãs, por tipo (08/09/2026, melhoria própria) — quantas
// seções da zona ainda não estão em NENHUMA rota ativa de cada tipo. Só
// avisa pra um tipo se já existe pelo menos 1 rota ATIVA desse tipo
// cadastrada (`tipoEmUso`) — sem isso, um tipo ainda não iniciado (ex.:
// distribuição de urnas, que hoje não tem nenhuma rota real) apareceria
// como "175 seções sem rota", o que é esperado/conhecido, não um gap
// acionável. O aviso real de "76 seções órfãs" (recolhimento de mídia,
// documentado no CLAUDE.md) é exatamente o caso que isto cobre: um tipo já
// em uso, com cobertura parcial.
function rtSecoesOrfasPorTipo() {
  const vinculadasPorTipo = {}; const tipoEmUso = {};
  for (const t of RT_TIPOS) { vinculadasPorTipo[t] = new Set(); tipoEmUso[t] = false; }
  for (const r of rtDados.rotas) {
    if (!r.ativo) continue;
    const secoes = rtDados.secoesPorRota.get(r.id) || [];
    for (const t of (r.tipos || [])) {
      if (!(t in vinculadasPorTipo)) continue;
      tipoEmUso[t] = true;
      for (const s of secoes) vinculadasPorTipo[t].add(s.id);
    }
  }
  const orfas = {};
  for (const t of RT_TIPOS) orfas[t] = tipoEmUso[t] ? rtDados.secoesZona.filter(s => !vinculadasPorTipo[t].has(s.id)) : [];
  return orfas;
}
function rtToggleOrfas(tipo) {
  rtOrfasAberto = rtOrfasAberto === tipo ? null : tipo;
  render();
}

function rtFiltrar() {
  const q = rtBusca.trim().toLowerCase();
  return (rtDados.rotas || []).filter(r => {
    if (rtFiltroTipo && !(r.tipos || []).includes(rtFiltroTipo)) return false;
    if (q && !`${r.codigo} ${r.nome} ${(r.municipios || []).join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function rtOnBuscaInput(v) {
  rtBusca = v;
  clearTimeout(rtBuscaTimer);
  rtBuscaTimer = setTimeout(render, 250);
}

function renderRotas() {
  const c = document.getElementById('content');
  const buscaEl = document.getElementById('rt-busca');
  const buscaAtiva = document.activeElement === buscaEl;
  const buscaSelStart = buscaAtiva ? buscaEl.selectionStart : null;
  const buscaSelEnd = buscaAtiva ? buscaEl.selectionEnd : null;

  if (!rtDados) { c.innerHTML = '<div class="import-card"><div class="ic-title">🗺️ Rotas</div><div class="ic-sub">Carregando…</div></div>'; rtCarregar(); return; }
  if (rtDados.erro) { c.innerHTML = `<div class="import-card"><div class="import-result ir-err">⚠ ${rtEsc(rtDados.erro)}</div></div>`; return; }

  const lista = rtFiltrar();
  const contagem = {};
  for (const r of rtDados.rotas) for (const t of (r.tipos || [])) contagem[t] = (contagem[t] || 0) + 1;
  const orfasPorTipo = rtSecoesOrfasPorTipo();
  const tiposComOrfa = RT_TIPOS.filter(t => orfasPorTipo[t].length);

  c.innerHTML = `
    <div class="import-card">
      <div class="ic-title">🗺️ Rotas</div>
      <div class="ic-sub">Cadastro das rotas de distribuição de urnas, recolhimento de urnas, recolhimento de mídias e instalação de seção. Uma mesma rota pode servir mais de um propósito ao mesmo tempo (ex.: o mesmo veículo leva e depois traz a urna pelo mesmo trajeto).</div>
      <button class="btn btn-dark" onclick="rtAbrirNovo()">➕ Nova rota</button>
    </div>

    <div class="import-card">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <select id="rt-filtro-tipo" onchange="rtFiltroTipo=this.value;render()">
          <option value="" ${rtFiltroTipo === '' ? 'selected' : ''}>Todos os tipos (${rtDados.rotas.length})</option>
          ${RT_TIPOS.map(t => `<option value="${t}" ${rtFiltroTipo === t ? 'selected' : ''}>${RT_TIPO_LABEL[t]} (${contagem[t] || 0})</option>`).join('')}
        </select>
        <input type="text" id="rt-busca" value="${rtEsc(rtBusca)}" oninput="rtOnBuscaInput(this.value)" placeholder="Buscar por código, nome ou município…" style="flex:1;min-width:160px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
      </div>
      <div class="ic-sub" style="margin-bottom:0">${lista.length} de ${rtDados.rotas.length} rota(s)</div>
    </div>

    ${tiposComOrfa.length ? `
    <div class="import-card">
      <div class="ic-title" style="font-size:.86rem">⚠️ Seções sem rota, por tipo</div>
      <div class="ic-sub">Só considera tipos que já têm pelo menos 1 rota ativa cadastrada — um tipo ainda não iniciado não conta como lacuna.</div>
      ${tiposComOrfa.map(t => `
      <div style="margin-top:8px">
        <div style="cursor:pointer;font-size:.8rem;font-weight:700" onclick="rtToggleOrfas('${t}')">${rtOrfasAberto === t ? '▾' : '▸'} ${RT_TIPO_LABEL[t]}: ${orfasPorTipo[t].length} seção(ões) sem rota</div>
        ${rtOrfasAberto === t ? `<div class="ic-sub" style="margin:4px 0 0">${orfasPorTipo[t].map(s => `${rtEsc(String(s.numero))} — ${rtEsc(s.local_nome)}, ${rtEsc(s.municipio)}`).join(' · ')}</div>` : ''}
      </div>`).join('')}
    </div>` : ''}

    <div style="display:flex;flex-direction:column;gap:8px">
      ${lista.length ? lista.map(r => {
        const secoes = rtDados.secoesPorRota.get(r.id) || [];
        const conflitos = rtConflitosDe(r);
        const retornoGerado = rtDados.rotas.find(x => x.rota_origem_id === r.id);
        const estado = rtDados.estadoPorRota.get(r.id);
        const urnasEstado = estado ? (rtDados.urnasPorEstado.get(estado.id) || []) : [];
        const embarcadas = urnasEstado.filter(u => u.embarcada).length;
        const marcos = estado ? [
          estado.ts_aberta && `aberta ${rtFmtTs(estado.ts_aberta)}`,
          estado.ts_pronta && `pronta ${rtFmtTs(estado.ts_pronta)}`,
          estado.ts_saiu && `saiu ${rtFmtTs(estado.ts_saiu)}`,
        ].filter(Boolean).join(', ') : '';
        return `
      <div class="import-card" style="padding:12px 14px;${r.ativo ? '' : 'opacity:.6'}">
        <div style="font-weight:800;font-size:.86rem">Rota ${rtEsc(r.codigo)} — ${rtEsc(r.nome)}</div>
        <div class="ic-sub" style="margin:2px 0 0">${(r.municipios || []).map(rtEsc).join(', ') || '—'} · ${secoes.length} seção(ões) vinculada(s)</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">
          ${(r.tipos || []).map(t => `<span class="import-result ir-ok" style="margin:0;padding:3px 8px;font-size:.68rem">${RT_TIPO_LABEL[t] || t}</span>`).join('')}
        </div>
        ${r.itinerario ? `<div class="ic-sub" style="margin:6px 0 0">${rtEsc(r.itinerario)}</div>` : ''}
        ${(r.ponto_partida || r.destino) ? `<div class="ic-sub" style="margin:2px 0 0">📍 ${rtEsc(r.ponto_partida || '—')} → ${rtEsc(r.destino || '—')}</div>` : ''}
        ${(r.horario_saida || r.horario_chegada_previsto) ? `<div class="ic-sub" style="margin:2px 0 0">🕐 Sai ${rtFmtHora(r.horario_saida) || '—'} · chega (previsão) ${rtFmtHora(r.horario_chegada_previsto) || '—'}</div>` : ''}
        ${r.tempo_parada_min != null && secoes.length ? `<div class="ic-sub" style="margin:2px 0 0">⏱️ ${secoes.length} parada(s) × ${r.tempo_parada_min} min ≈ ${rtFmtMinutos(rtTempoTotalParadasMin(r, secoes.length))} parado(a)${r.horario_saida ? ` — sem contar deslocamento, libera por volta de ${rtSomarMinutos(r.horario_saida, rtTempoTotalParadasMin(r, secoes.length))}` : ''}</div>` : ''}
        ${r.responsavel_ator_id ? `<div class="ic-sub" style="margin:2px 0 0">👤 Responsável: ${rtEsc(rtNomeAtor(r.responsavel_ator_id) || '—')}</div>` : ''}
        ${conflitos.length ? `<div class="ic-sub" style="margin:2px 0 0;color:var(--red)">⚠️ ${rtEsc(rtNomeAtor(r.responsavel_ator_id))} também está escalado na Rota ${conflitos.map(c => rtEsc(c.codigo)).join(', ')} nesse horário</div>` : ''}
        ${r.urnas_estimadas != null ? `<div class="ic-sub" style="margin:2px 0 0">Urnas estimadas: ${r.urnas_estimadas}</div>` : ''}
        ${r.rota_origem_id ? `<div class="ic-sub" style="margin:2px 0 0">↩️ Recolhimento gerado a partir da Rota ${rtEsc(rtDados.rotas.find(x => x.id === r.rota_origem_id)?.codigo || '—')}</div>` : ''}
        ${retornoGerado ? `<div class="ic-sub" style="margin:2px 0 0">↩️ Já tem recolhimento gerado: Rota ${rtEsc(retornoGerado.codigo)}</div>` : ''}
        ${estado ? `<div class="ic-sub" style="margin:2px 0 0${estado.alerta ? ';color:var(--red)' : ''}">${RT_STATUS_ESTADO_LABEL[estado.status] || estado.status}${estado.alerta ? ' ⚠️' : ''} — Dia D: ${embarcadas}/${secoes.length} embarcada(s)${estado.conferente_nome ? ` · Conferente: ${rtEsc(estado.conferente_nome)}` : ''}${marcos ? ` · ${marcos}` : ''}</div>` : ''}
        ${!r.ativo ? '<div class="ic-sub" style="margin:2px 0 0;color:var(--red)">Inativa</div>' : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <button class="btn btn-out" style="font-size:.72rem;padding:6px 10px" onclick="rtAbrirEditar('${r.id}')">✏️ Editar</button>
          <button class="btn btn-out" style="font-size:.72rem;padding:6px 10px" onclick="rtImprimirFicha('${r.id}')" title="Imprime a ficha da rota (paradas em ordem, contato do responsável)">🖨️ Imprimir ficha</button>
          ${rtRotaTemTipoLegado(r) && !retornoGerado ? `<button class="btn btn-out" style="font-size:.72rem;padding:6px 10px" onclick="rtGerarRetorno('${r.id}')" title="Cria um rascunho de rota de recolhimento de urna, com as mesmas paradas ao contrário">🔄 Gerar rota de recolhimento</button>` : ''}
          <button class="btn btn-out" style="font-size:.72rem;padding:6px 10px" onclick="rtToggleAtivo('${r.id}',${!r.ativo})">${r.ativo ? '🚫 Desativar' : '✓ Reativar'}</button>
        </div>
      </div>`;
      }).join('') : '<div class="import-card"><div class="ic-sub" style="margin-bottom:0">Nenhuma rota cadastrada ainda com esse filtro.</div></div>'}
    </div>
  `;
  if (buscaAtiva) {
    const el = document.getElementById('rt-busca');
    if (el) { el.focus(); try { el.setSelectionRange(buscaSelStart, buscaSelEnd); } catch (e) { /* ignora */ } }
  }
}

// ── Modal: nova/editar rota ──
function rtAbrirNovo() { rtModalId = ''; rtAdicionarAberto = false; rtSecaoBusca = ''; rtRenderModalRota(); }
function rtAbrirEditar(id) { rtModalId = id; rtAdicionarAberto = false; rtSecaoBusca = ''; rtRenderModalRota(); }
function rtFecharModal(e) {
  if (rtModalId === null) return;
  if (!e || e.target === document.getElementById('overlay')) {
    rtModalId = null;
    rtGerandoRetornoDe = null;
    rtAdicionarAberto = false;
    rtSecaoBusca = '';
    document.getElementById('overlay')?.classList.remove('open');
  }
}

// "🔄 Gerar rota de recolhimento" (08/09/2026, melhoria própria — schema já
// previa isso desde 04/09/2026 com `rota_origem_id`, só nunca tinha sido
// construído). Recolhimento de urna é a distribuição percorrida ao
// contrário, em outro dia (já documentado no CLAUDE.md) — abre "Nova rota"
// PRÉ-PREENCHIDA com partida/destino invertidos e tipo 'recolhimento_urna',
// mas não salva sozinho: o cartório revisa (código é obrigatório e não dá
// pra adivinhar um que não colida) e confirma pelo "💾 Salvar" de sempre.
// Só as paradas (que não têm ambiguidade nenhuma — é a mesma lista, ao
// contrário) são copiadas automaticamente, depois de salvar, em
// rtSalvarRota().
function rtGerarRetorno(rotaId) {
  const origem = rtDados.rotas.find(r => r.id === rotaId);
  if (!origem) return;
  rtGerandoRetornoDe = rotaId;
  rtModalId = '';
  rtRenderModalRota();
}

// "1º/último local da rota" — nome exibido pro local de uma parada (usado
// tanto pra sugerir Partida/Destino quanto pra recalcular sob pedido).
function rtNomeLocalParada(s) {
  return s ? `${s.local_nome}, ${s.municipio}` : '';
}
// Partida/destino sugeridos a partir da lista de paradas (08/09/2026,
// pedido direto: "acho melhor o ponto de partida ser o primeiro item da
// rota, e o destino o ultimo, pegue dos locais (paradas)") — pré-preenche
// os campos sozinho a partir do 1º/último local de votação da rota, mas
// CONTINUAM sendo campos de texto livres, editáveis: uma rota de
// distribuição de urnas, por exemplo, sai de verdade do Cartório Eleitoral
// (não de um local de votação) — forçar sempre automático destruiria esse
// valor real já em produção. `rtUsarSugestaoPartida`/`rtUsarSugestaoDestino`
// deixam o cartório recalcular sob demanda (ex.: depois de reordenar as
// paradas), sem sobrescrever nada sozinho.
function rtUsarSugestaoPartida() {
  const r = rtDados.rotas.find(x => x.id === rtModalId);
  const atuais = r ? (rtDados.secoesPorRota.get(r.id) || []) : [];
  if (!atuais.length) { showToast('⚠ Nenhum local de votação cadastrado ainda'); return; }
  const el = document.getElementById('rt-partida');
  if (el) el.value = rtNomeLocalParada(atuais[0]);
}
function rtUsarSugestaoDestino() {
  const r = rtDados.rotas.find(x => x.id === rtModalId);
  const atuais = r ? (rtDados.secoesPorRota.get(r.id) || []) : [];
  if (!atuais.length) { showToast('⚠ Nenhum local de votação cadastrado ainda'); return; }
  const el = document.getElementById('rt-destino');
  if (el) el.value = rtNomeLocalParada(atuais[atuais.length - 1]);
}
// Recalcula a previsão de chegada ESTIMADA sob demanda (mesmo padrão de
// rtUsarSugestaoPartida/Destino) — lê horário de saída/tempo por parada
// DIGITADOS na hora (não só o valor salvo), pra já refletir o que a pessoa
// acabou de preencher sem precisar salvar e reabrir o modal primeiro.
function rtUsarSugestaoChegada() {
  const r = rtDados.rotas.find(x => x.id === rtModalId);
  const atuais = r ? (rtDados.secoesPorRota.get(r.id) || []) : [];
  const horario_saida = document.getElementById('rt-hora-saida')?.value || null;
  const tempoRaw = document.getElementById('rt-tempo-parada')?.value.trim();
  const tempo_parada_min = tempoRaw ? parseInt(tempoRaw, 10) : null;
  const eta = rtChegadaEstimada({ horario_saida, tempo_parada_min }, atuais);
  if (!eta) { showToast('⚠ Preencha horário de saída, tempo por parada e a geolocalização de todas as paradas primeiro'); return; }
  const el = document.getElementById('rt-hora-chegada');
  if (el) el.value = eta.horario;
}
function rtRenderModalRota() {
  const isNovo = rtModalId === '';
  const r = isNovo ? null : rtDados.rotas.find(x => x.id === rtModalId);
  // Rascunho de "rota de recolhimento" gerado a partir de uma rota de
  // distribuição (rtGerarRetorno()) — só existe enquanto isNovo; nunca
  // sobrescreve os valores de uma rota já salva (r tem sempre prioridade).
  const origem = isNovo && rtGerandoRetornoDe ? rtDados.rotas.find(x => x.id === rtGerandoRetornoDe) : null;
  const pre = origem ? {
    nome: `Recolhimento — ${origem.nome}`,
    municipios: origem.municipios || [],
    tipos: ['recolhimento_urna'],
    ponto_partida: origem.destino || '',
    destino: origem.ponto_partida || '',
  } : null;
  const tiposAtuais = r?.tipos || pre?.tipos || [];
  // Partida/destino sugeridos a partir das paradas já cadastradas (só existe
  // pra rota já salva — "Nova rota" ainda não tem onde vincular local
  // nenhum). Só entra como default quando a rota ainda não tem um valor
  // próprio salvo (nem um rascunho pré-preenchido de rtGerarRetorno) — nunca
  // sobrescreve um "Cartório Eleitoral" já digitado.
  const paradasAtuais = r ? (rtDados.secoesPorRota.get(r.id) || []) : [];
  const partidaSugerida = paradasAtuais.length ? rtNomeLocalParada(paradasAtuais[0]) : '';
  const destinoSugerido = paradasAtuais.length ? rtNomeLocalParada(paradasAtuais[paradasAtuais.length - 1]) : '';
  // Previsão de chegada estimada (08/09/2026, pedido direto — ver
  // rtChegadaEstimada) — mesmo critério de sugestão de partida/destino:
  // só entra como valor default do campo quando ele ainda está vazio,
  // nunca sobrescreve o que o cartório já digitou.
  const eta = (!isNovo && r) ? rtChegadaEstimada(r, paradasAtuais) : null;

  document.getElementById('modal-body').innerHTML = `
    <div class="m-hdr">
      <div class="m-title">${isNovo ? '➕ Nova rota' : `✏️ Editar Rota ${rtEsc(r.codigo)}`}</div>
      <button class="close-btn" aria-label="Fechar" onclick="rtFecharModal()">✕</button>
    </div>
    <div class="m-body">
      ${origem ? `<div class="import-result ir-ok" style="margin:0 0 10px">🔄 Rascunho de recolhimento gerado a partir da Rota ${rtEsc(origem.codigo)} — confira o código, os horários (é OUTRO DIA) e salve.</div>` : ''}
      <div class="form-group"><label for="rt-codigo">Código</label>
        <input type="text" id="rt-codigo" value="${rtEsc(r?.codigo || '')}" placeholder="ex.: 036" maxlength="3"></div>
      <div class="form-group"><label for="rt-nome">Nome</label>
        <input type="text" id="rt-nome" value="${rtEsc(r?.nome ?? pre?.nome ?? '')}" placeholder="ex.: Rota 036"></div>
      <div class="form-group"><label for="rt-municipios">Municípios (separados por vírgula)</label>
        <input type="text" id="rt-municipios" value="${rtEsc((r?.municipios || pre?.municipios || []).join(', '))}" placeholder="ex.: Campo Maior, Jatobá do Piauí"></div>
      <div class="form-group"><label for="rt-tipos">Tipo (Ctrl/Cmd+clique pra marcar mais de um)</label>
        <select id="rt-tipos" multiple size="${RT_TIPOS.length}" style="width:100%;padding:4px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:.85rem;font-family:inherit">
          ${RT_TIPOS.map(t => `<option value="${t}" ${tiposAtuais.includes(t) ? 'selected' : ''}>${RT_TIPO_LABEL[t]}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label for="rt-itinerario">Itinerário (observações livres, opcional)</label>
        <textarea id="rt-itinerario" rows="2" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);font-size:.85rem;color:var(--text);font-family:inherit" placeholder="ex.: vira à direita depois da ponte">${rtEsc(r?.itinerario || '')}</textarea></div>
      ${isNovo ? `
      <div class="form-group"><div class="ic-sub" style="margin:0">📍 Salve a rota primeiro pra poder cadastrar os locais de votação (com geolocalização) abaixo.${origem ? ' As paradas da rota de origem serão copiadas automaticamente, na ordem invertida.' : ''}</div></div>` : `
      <div class="form-group" style="margin-top:4px">
        <label>📍 Locais de votação (paradas)</label>
        <div id="rt-paradas-secao"></div>
      </div>`}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div class="form-group" style="flex:1;min-width:150px"><label for="rt-partida">Ponto de partida</label>
          <div style="display:flex;gap:4px">
            <input type="text" id="rt-partida" value="${rtEsc(r?.ponto_partida ?? pre?.ponto_partida ?? partidaSugerida)}" placeholder="ex.: Cartório Eleitoral da 7ª Zona" style="flex:1">
            ${!isNovo ? `<button type="button" id="rt-partida-sugerir" class="btn btn-out" style="font-size:.68rem;padding:0 8px" onclick="rtUsarSugestaoPartida()" title="Usar o 1º local de votação da lista de paradas abaixo">↻</button>` : ''}
          </div>
        </div>
        <div class="form-group" style="flex:1;min-width:150px"><label for="rt-destino">Destino</label>
          <div style="display:flex;gap:4px">
            <input type="text" id="rt-destino" value="${rtEsc(r?.destino ?? pre?.destino ?? destinoSugerido)}" placeholder="ex.: Escola A" style="flex:1">
            ${!isNovo ? `<button type="button" id="rt-destino-sugerir" class="btn btn-out" style="font-size:.68rem;padding:0 8px" onclick="rtUsarSugestaoDestino()" title="Usar o último local de votação da lista de paradas abaixo">↻</button>` : ''}
          </div>
        </div>
      </div>
      ${!isNovo && paradasAtuais.length ? `<div class="ic-sub" style="margin:-6px 0 0">📍 Sugestão a partir das paradas: 1º = ${rtEsc(partidaSugerida)} · último = ${rtEsc(destinoSugerido)} — clique em ↻ pra usar, ou digite outro valor (ex.: um endereço que não é local de votação).</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div class="form-group" style="flex:1;min-width:120px"><label for="rt-hora-saida">Horário de saída</label>
          <input type="time" id="rt-hora-saida" value="${rtFmtHora(r?.horario_saida) || ''}"></div>
        <div class="form-group" style="flex:1;min-width:120px"><label for="rt-hora-chegada">Previsão de chegada</label>
          <div style="display:flex;gap:4px">
            <input type="time" id="rt-hora-chegada" value="${rtFmtHora(r?.horario_chegada_previsto) || eta?.horario || ''}" style="flex:1">
            ${!isNovo && eta ? `<button type="button" id="rt-chegada-sugerir" class="btn btn-out" style="font-size:.68rem;padding:0 8px" onclick="rtUsarSugestaoChegada()" title="Recalcular a estimativa">↻</button>` : ''}
          </div>
        </div>
        <div class="form-group" style="flex:1;min-width:120px"><label for="rt-tempo-parada">Tempo por parada (min)</label>
          <input type="number" id="rt-tempo-parada" min="0" value="${r?.tempo_parada_min ?? ''}" placeholder="ex.: 10"></div>
      </div>
      ${!isNovo && r?.tempo_parada_min != null && paradasAtuais.length ? `<div class="ic-sub" style="margin:-6px 0 0">⏱️ Tempo total estimado parado: ${paradasAtuais.length} parada(s) × ${r.tempo_parada_min} min ≈ ${rtFmtMinutos(rtTempoTotalParadasMin(r, paradasAtuais.length))}${r.horario_saida ? ` — sem contar deslocamento, libera por volta de ${rtSomarMinutos(r.horario_saida, rtTempoTotalParadasMin(r, paradasAtuais.length))}` : ''}.</div>` : ''}
      ${!isNovo && eta ? `<div class="ic-sub" style="margin:-6px 0 0">🧭 Previsão de chegada ESTIMADA (linha reta, ~${RT_VELOCIDADE_MEDIA_KMH}km/h assumidos — não é o Google calculando de verdade, isso exigiria API paga): ~${eta.travelKm.toFixed(1)}km de deslocamento (${rtFmtMinutos(eta.travelMin)}) + ${rtFmtMinutos(eta.dwellMin)} parado(a) → chega por volta de ${eta.horario}. Pode ficar bem diferente da estrada real — ajuste o campo acima se souber melhor.</div>` : ''}
      <div class="form-group"><label for="rt-responsavel">Responsável pela rota (opcional)</label>
        <select id="rt-responsavel">
          <option value="">— sem responsável —</option>
          ${(rtDados.atores || []).map(a => `<option value="${a.id}" ${r?.responsavel_ator_id === a.id ? 'selected' : ''}>${rtEsc(a.nome_completo)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label for="rt-urnas">Urnas estimadas (opcional)</label>
        <input type="number" id="rt-urnas" min="0" value="${r?.urnas_estimadas ?? ''}"></div>
      ${!isNovo ? `
      <label style="display:flex;align-items:center;gap:6px;font-size:.8rem;cursor:pointer">
        <input type="checkbox" id="rt-ativo" ${r?.ativo ? 'checked' : ''}> Rota ativa
      </label>` : ''}
    </div>
    <div class="m-foot">
      <button class="btn btn-out" onclick="rtFecharModal()">Cancelar</button>
      <button class="btn btn-dark" onclick="rtSalvarRota()">💾 Salvar</button>
    </div>`;
  document.getElementById('overlay').classList.add('open');
  if (!isNovo) rtRenderParadas();
}

// Renderiza só o conteúdo de "📍 Locais de votação (paradas)", dentro do
// próprio modal de editar rota — escopado a #rt-paradas-secao, nunca ao
// modal inteiro (rtRenderModalRota()). Mesma lição já aprendida em
// cmSalvarTelefoneCard() (sime_contatar_mesarios.js): re-renderizar o modal
// inteiro a cada tecla digitada na busca, ou a cada seção adicionada/
// removida, perderia o que a pessoa estivesse editando ao mesmo tempo nos
// outros campos (código, nome, itinerário, horário...) — aqui a busca por
// local de votação e os demais campos da rota convivem no mesmo modal, então
// esse isolamento passou a importar de verdade.
// Botão "+" que esconde/mostra a busca+lista de "Adicionar local de votação"
// (08/09/2026, pedido direto: "substitua o Adicionar local de votação
// somente por um botão de +, ai abre para selecionar os locais") — igual à
// lista de paradas já vinculadas, fica fechado até o cartório precisar
// adicionar mais um local; fechar de novo limpa a busca (rtSecaoBusca), pra
// não reabrir com um texto de busca velho na próxima vez.
function rtToggleAdicionar() {
  rtAdicionarAberto = !rtAdicionarAberto;
  if (!rtAdicionarAberto) rtSecaoBusca = '';
  rtRenderParadas();
}

function rtRenderParadas() {
  const alvo = document.getElementById('rt-paradas-secao');
  if (!alvo) return; // modal fechado, ou é "nova rota" (ainda sem id pra vincular seção)
  const r = rtDados.rotas.find(x => x.id === rtModalId);
  if (!r) return;
  const atuais = rtDados.secoesPorRota.get(r.id) || [];
  const atuaisIds = new Set(atuais.map(s => s.id));
  // "Ver rota completa no mapa" (08/09/2026, melhoria própria, estendida no
  // mesmo dia pra incluir Partida/Destino digitados — ver rtMapsUrl).
  const mapsUrl = rtMapsUrl(r, atuais);
  const q = rtSecaoBusca.trim().toLowerCase();
  const candidatas = rtDados.secoesZona
    .filter(s => !atuaisIds.has(s.id) && (!q || `${s.numero} ${s.local_nome} ${s.municipio}`.toLowerCase().includes(q)))
    .slice(0, 30);

  const buscaEl = document.getElementById('rt-secao-busca');
  const buscaAtiva = document.activeElement === buscaEl;
  const buscaSelStart = buscaAtiva ? buscaEl.selectionStart : null;
  const buscaSelEnd = buscaAtiva ? buscaEl.selectionEnd : null;

  alvo.innerHTML = `
    <div class="ic-sub" style="margin:0 0 6px">${atuais.length} local(is) nesta rota, em ordem${rtRotaTemTipoLegado(r) ? ' — também usada por Motorista/Conferente/TV Distribuição' : ''}.</div>
    ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" rel="noopener" class="btn btn-out" style="font-size:.7rem;padding:5px 10px;display:inline-block;margin-bottom:8px;text-decoration:none" title="Usa a Partida/Destino digitados, quando preenchidos, e as paradas geolocalizadas no meio">🗺️ Ver rota completa no mapa</a>` : ''}
    <div class="m-hist">
      ${atuais.length ? atuais.map((s, idx) => `
      <div class="m-hist-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span style="display:flex;align-items:center;gap:6px">
          <span style="display:inline-flex;flex-direction:column;gap:2px">
            <button class="btn btn-out" style="font-size:.6rem;padding:1px 6px;line-height:1.4" onclick="rtMoverParada('${r.id}','${s.id}',-1)" ${idx === 0 ? 'disabled' : ''} title="Mover pra cima (mais cedo na rota)">▲</button>
            <button class="btn btn-out" style="font-size:.6rem;padding:1px 6px;line-height:1.4" onclick="rtMoverParada('${r.id}','${s.id}',1)" ${idx === atuais.length - 1 ? 'disabled' : ''} title="Mover pra baixo (mais tarde na rota)">▼</button>
          </span>
          <span><b>${idx + 1}º</b> — <b>${rtEsc(String(s.numero))}</b> — ${rtEsc(s.local_nome)}, ${rtEsc(s.municipio)}${s.latitude != null && s.longitude != null ? ` <a href="https://www.google.com/maps?q=${s.latitude},${s.longitude}" target="_blank" rel="noopener" title="Ver no mapa">📍</a>` : ''}</span>
        </span>
        <button class="btn btn-out" style="font-size:.68rem;padding:3px 8px" onclick="rtRemoverSecao('${r.id}','${s.id}')">✕</button>
      </div>`).join('') : '<div class="ic-sub" style="margin:0">Nenhum local vinculado ainda.</div>'}
    </div>
    ${rtAdicionarAberto ? `
    <div style="margin-top:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <label for="rt-secao-busca" style="font-size:.78rem;color:var(--text2)">Adicionar local de votação</label>
        <button class="btn btn-out" style="font-size:.68rem;padding:3px 8px" onclick="rtToggleAdicionar()">✕ Fechar</button>
      </div>
      <input type="text" id="rt-secao-busca" value="${rtEsc(rtSecaoBusca)}" oninput="rtOnSecaoBuscaInput(this.value)" placeholder="Buscar por número, local ou município…" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
      <div class="m-hist">
        ${candidatas.length ? candidatas.map(s => `
        <div class="m-hist-item" style="cursor:pointer" onclick="rtAdicionarSecao('${r.id}','${s.id}')">➕ <b>${rtEsc(String(s.numero))}</b> — ${rtEsc(s.local_nome)}, ${rtEsc(s.municipio)}${s.latitude != null && s.longitude != null ? ' 📍' : ''}</div>`).join('')
          : (q ? '<div class="ic-sub" style="margin:0">Nenhum local encontrado.</div>' : '')}
      </div>
    </div>` : `
    <button class="btn btn-out" style="font-size:.8rem;padding:6px 12px;margin-top:8px" onclick="rtToggleAdicionar()" title="Adicionar local de votação">+</button>`}`;
  if (buscaAtiva) {
    const el = document.getElementById('rt-secao-busca');
    if (el) { el.focus(); try { el.setSelectionRange(buscaSelStart, buscaSelEnd); } catch (e) { /* ignora */ } }
  }
}

// Copia as paradas da rota de ORIGEM pra rota nova, na ordem INVERTIDA —
// chamada só uma vez, logo depois que a rota gerada por rtGerarRetorno() é
// salva pela primeira vez. A rota gerada nasce sempre 'recolhimento_urna'
// (nunca 'distribuicao'), então não é tipo legado — não mexe em
// sime_secoes.rota_id/parada, só em sime_rota_secoes.
async function rtCopiarParadasInvertidas(origemId, novaId) {
  const sb = window.supabaseAtores;
  const paradasOrigem = rtDados.secoesPorRota.get(origemId) || [];
  if (!paradasOrigem.length) return;
  const total = paradasOrigem.length;
  const linhas = paradasOrigem.map((s, idx) => ({ rota_id: novaId, secao_id: s.id, parada: total - idx }));
  const { error } = await sb.from('sime_rota_secoes').insert(linhas);
  if (error) { showToast('⚠ Rota criada, mas falhou ao copiar as paradas: ' + error.message); return; }
  await log('rota_paradas_copiadas_retorno', '', { rota_origem_id: origemId, rota_id: novaId, quantidade: linhas.length });
}

async function rtSalvarRota() {
  const sb = window.supabaseAtores;
  const codigo = document.getElementById('rt-codigo').value.trim();
  const nome = document.getElementById('rt-nome').value.trim();
  const municipiosRaw = document.getElementById('rt-municipios').value.trim();
  const municipios = municipiosRaw ? municipiosRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const tipos = [...document.getElementById('rt-tipos').selectedOptions].map(o => o.value);
  const itinerario = document.getElementById('rt-itinerario').value.trim() || null;
  const ponto_partida = document.getElementById('rt-partida').value.trim() || null;
  const destino = document.getElementById('rt-destino').value.trim() || null;
  const horario_saida = document.getElementById('rt-hora-saida').value || null;
  const horario_chegada_previsto = document.getElementById('rt-hora-chegada').value || null;
  const responsavel_ator_id = document.getElementById('rt-responsavel').value || null;
  const urnasRaw = document.getElementById('rt-urnas').value.trim();
  const urnas_estimadas = urnasRaw ? parseInt(urnasRaw, 10) : null;
  const tempoParadaRaw = document.getElementById('rt-tempo-parada').value.trim();
  const tempo_parada_min = tempoParadaRaw ? parseInt(tempoParadaRaw, 10) : null;
  const isNovo = rtModalId === '';
  const ativoEl = document.getElementById('rt-ativo');
  const ativo = isNovo ? true : (ativoEl ? ativoEl.checked : true);

  if (!codigo) { showToast('⚠ Código obrigatório'); return; }
  if (!nome) { showToast('⚠ Nome obrigatório'); return; }
  if (!tipos.length) { showToast('⚠ Marque ao menos um tipo de rota'); return; }

  const zonaId = rtDados.zonaId;
  const rotaOrigemId = isNovo ? rtGerandoRetornoDe : null;
  const payload = { nome, municipios, tipos, itinerario, urnas_estimadas, ponto_partida, destino, horario_saida, horario_chegada_previsto, responsavel_ator_id, tempo_parada_min };
  try {
    if (isNovo) {
      const { error } = await sb.from('sime_rotas').insert({ ...payload, codigo, zona_id: zonaId, ativo: true, rota_origem_id: rotaOrigemId || null });
      if (error) {
        if (/duplicate key|unique constraint/i.test(error.message)) { showToast('⚠ Já existe uma rota com esse código nesta zona'); return; }
        showToast('⚠ ' + error.message); return;
      }
      await log('rota_criada', '', { codigo, nome, tipos, rota_origem_id: rotaOrigemId });
      // Depois de criar, reabre o MESMO modal já em modo edição da rota
      // recém-criada — pedido direto: "quero poder cadastrar a rota...
      // devendo cadastrar cada um dos locais de votação", tudo num fluxo só,
      // sem precisar fechar e reabrir pra achar onde vincular as seções.
      // Casa por código (único por zona, já garantido pela constraint acima)
      // porque o insert do Supabase aqui não devolve o id de volta.
      await rtCarregar({ silencioso: true });
      const nova = rtDados.rotas.find(x => x.codigo === codigo);
      if (nova) {
        if (rotaOrigemId) {
          await rtCopiarParadasInvertidas(rotaOrigemId, nova.id);
          await rtCarregar({ silencioso: true }); // recarrega de novo pra já trazer as paradas recém-copiadas
        }
        showToast(rotaOrigemId ? '✓ Rota de recolhimento criada, com as paradas da origem invertidas' : '✓ Rota criada — agora cadastre os locais de votação abaixo');
        rtGerandoRetornoDe = null;
        rtModalId = nova.id;
        rtRenderModalRota();
        render();
        return;
      }
      showToast('✓ Rota criada');
    } else {
      const { error } = await sb.from('sime_rotas').update({ ...payload, codigo, ativo }).eq('id', rtModalId);
      if (error) {
        if (/duplicate key|unique constraint/i.test(error.message)) { showToast('⚠ Já existe uma rota com esse código nesta zona'); return; }
        showToast('⚠ ' + error.message); return;
      }
      await log('rota_editada', '', { id: rtModalId, codigo, nome, tipos });
      showToast('✓ Rota atualizada');
    }
  } catch (e) {
    showToast('⚠ Falha ao salvar — verifique a conexão e tente de novo');
    return;
  }
  rtFecharModal();
  rtDados = null;
  render();
}

async function rtToggleAtivo(id, ativo) {
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_rotas').update({ ativo }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  await log(ativo ? 'rota_reativada' : 'rota_desativada', '', { id });
  rtDados = null;
  render();
}

// ── Locais de votação (paradas) da rota — vive dentro do modal de editar
// rota (rtRenderParadas() acima), não é mais modal próprio (04/09/2026,
// depois pedido direto de 08/09/2026: "quero poder cadastrar a rota,
// indicando o local de saída, e todos os pontos... devendo cadastrar cada
// um dos locais de votação... georreferenciamento que já consta no
// sistema" — juntar num fluxo só em vez de dois modais separados). ──
function rtOnSecaoBuscaInput(v) {
  rtSecaoBusca = v;
  clearTimeout(rtSecaoBuscaTimer);
  rtSecaoBuscaTimer = setTimeout(rtRenderParadas, 250);
}

async function rtAdicionarSecao(rotaId, secaoId) {
  const sb = window.supabaseAtores;
  const rota = rtDados.rotas.find(r => r.id === rotaId);
  const atuais = rtDados.secoesPorRota.get(rotaId) || [];
  const proximaParada = atuais.length ? Math.max(...atuais.map(s => s.parada || 0)) + 1 : 1;

  const { error } = await sb.from('sime_rota_secoes').insert({ rota_id: rotaId, secao_id: secaoId, parada: proximaParada });
  if (error) { showToast('⚠ ' + error.message); return; }

  if (rtRotaTemTipoLegado(rota)) {
    const secao = rtDados.secoesZona.find(s => s.id === secaoId);
    const jaTinhaOutraRota = secao && secao.rota_id && secao.rota_id !== rotaId;
    const { error: eLeg } = await sb.from('sime_secoes').update({ rota_id: rotaId, parada: proximaParada }).eq('id', secaoId);
    if (eLeg) {
      showToast('⚠ Seção vinculada aqui, mas falhou ao sincronizar com Distribuição/Conferente: ' + eLeg.message);
    } else if (jaTinhaOutraRota) {
      showToast('✓ Seção movida pra esta rota — estava em outra rota de distribuição/recolhimento de urna');
    }
  }

  await log('rota_secao_adicionada', '', { rota_id: rotaId, secao_id: secaoId, parada: proximaParada });
  await rtRecarregarParadas();
}

async function rtRemoverSecao(rotaId, secaoId) {
  const sb = window.supabaseAtores;
  const rota = rtDados.rotas.find(r => r.id === rotaId);
  const { error } = await sb.from('sime_rota_secoes').delete().eq('rota_id', rotaId).eq('secao_id', secaoId);
  if (error) { showToast('⚠ ' + error.message); return; }

  // Só limpa o campo legado se ele ainda apontar pra ESTA rota — nunca
  // sobrescrever uma reatribuição que já tenha acontecido por outro caminho.
  if (rtRotaTemTipoLegado(rota)) {
    await sb.from('sime_secoes').update({ rota_id: null, parada: null }).eq('id', secaoId).eq('rota_id', rotaId);
  }

  await log('rota_secao_removida', '', { rota_id: rotaId, secao_id: secaoId });
  await rtRecarregarParadas();
}

// Reposicionar parada com ▲/▼ (08/09/2026, pedido direto com print de
// produção anexado: "quero poder reposicionar os locais da rota de modo a
// fazer mais sentido" — o print mostrado tinha 3 paradas com o número "1"
// ao mesmo tempo). O campo numérico livre de antes (`rtSalvarParada`,
// digitar um número qualquer) permitia exatamente esse tipo de bagunça —
// nada impedia duas paradas com o mesmo número, ou pulos na sequência.
// `rtMoverParada` troca a POSIÇÃO na lista (não só um número solto) e
// RENUMERA TUDO sequencialmente 1..N a cada movimento — o que
// automaticamente corrige qualquer duplicata/lacuna já existente na
// primeira vez que alguém mexe naquela rota, sem precisar de migração
// própria pra dado antigo.
async function rtMoverParada(rotaId, secaoId, direcao) {
  const sb = window.supabaseAtores;
  const rota = rtDados.rotas.find(r => r.id === rotaId);
  const atuais = [...(rtDados.secoesPorRota.get(rotaId) || [])]; // já vem ordenada
  const idx = atuais.findIndex(s => s.id === secaoId);
  const novoIdx = idx + direcao;
  if (idx < 0 || novoIdx < 0 || novoIdx >= atuais.length) return; // já é a 1ª/última — nada a fazer
  [atuais[idx], atuais[novoIdx]] = [atuais[novoIdx], atuais[idx]];

  for (let i = 0; i < atuais.length; i++) {
    const novaParada = i + 1;
    if (atuais[i].parada === novaParada) continue; // já está certo, evita escrita à toa
    const { error } = await sb.from('sime_rota_secoes').update({ parada: novaParada }).eq('rota_id', rotaId).eq('secao_id', atuais[i].id);
    if (error) { showToast('⚠ ' + error.message); return; }
    if (rtRotaTemTipoLegado(rota)) {
      await sb.from('sime_secoes').update({ parada: novaParada }).eq('id', atuais[i].id).eq('rota_id', rotaId);
    }
    atuais[i] = { ...atuais[i], parada: novaParada };
  }
  rtDados.secoesPorRota.set(rotaId, atuais);
  await log('rota_secao_reordenada', '', { rota_id: rotaId, secao_id: secaoId, direcao });
  showToast('✓ Ordem atualizada');
  rtRenderParadas();
  render();
}

// rtCarregar({silencioso:true}) recarrega sem tocar na tela — rtModalId não
// muda (o modal de editar rota continua aberto na mesma pessoa), só a
// seção "📍 Locais de votação" dentro dele precisa se redesenhar em cima do
// dado novo (rtRenderParadas() já é escopada a #rt-paradas-secao, não mexe
// no resto do formulário); render() por fora redesenha a lista de rotas por
// trás (contagem de locais nos cards muda também).
async function rtRecarregarParadas() {
  await rtCarregar({ silencioso: true });
  rtRenderParadas();
  render();
}

// ── Impressão da rota pro motorista (08/09/2026, melhoria própria) ──
// Mesmo mecanismo sem popup já usado em Correspondência/Oficial de Justiça
// (sime_correspondencia.js/sime_oficial_justica.js): um #print-area oculto
// na tela, só visível via @media print, populado por innerHTML e
// window.print() chamado direto — sem window.open(), que popup blocker
// costuma barrar. Documento de apoio operacional (não uma peça oficial):
// paradas em ordem, com número/local/coordenadas quando existem, e o
// contato do responsável pra quem estiver na estrada poder ligar.
function rtHtmlFicha(rota, paradas, responsavel) {
  const hoje = new Date();
  const dataEmissao = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
  const linhas = paradas.map((s, i) => `
    <tr>
      <td class="rt-col-num">${i + 1}</td>
      <td><b>${rtEsc(String(s.numero))}</b> — ${rtEsc(s.local_nome)}</td>
      <td>${rtEsc(s.municipio)}</td>
      <td>${s.latitude != null && s.longitude != null ? `${rtEsc(String(s.latitude))}, ${rtEsc(String(s.longitude))}` : '<span class="rt-sub">sem geo</span>'}</td>
      <td class="rt-col-chegada"></td>
    </tr>`).join('');

  // Mapa (08/09/2026, pedido direto: "em imprimir ficha conseguimos gerar
  // para imprimir um mapa da rota?") — esquema desenhado das coordenadas
  // (rtSvgMinimapa) + QR pro Google Maps de verdade (rtImprimirFicha injeta
  // depois de montar este HTML) + legenda de Partida/Destino SEMPRE
  // presente (pedido direto no mesmo dia: "o destino deve ser incluido no
  // mapa de rotas" — o destino digitado pode não ser nenhuma parada
  // geolocalizada, ex. "Cartório Eleitoral da 7ª Zona" numa rota de
  // distribuição; mostrar o texto aqui não depende de coordenada nenhuma).
  const mapsUrl = rtMapsUrl(rota, paradas);
  const svgMapa = rtSvgMinimapa(paradas);
  const origemLabel = rota.ponto_partida || (paradas[0] ? rtNomeLocalParada(paradas[0]) : '—');
  const destinoLabel = rota.destino || (paradas.length ? rtNomeLocalParada(paradas[paradas.length - 1]) : '—');
  const mapaHtml = (svgMapa || mapsUrl) ? `
      <div class="rt-mapa">
        <div class="rt-mapa-titulo">🗺️ Mapa esquemático da rota</div>
        ${svgMapa || '<div class="rt-sub">Sem coordenadas suficientes (pelo menos 2 locais geolocalizados) pra desenhar o esquema — use o QR/link abaixo.</div>'}
        <div class="rt-mapa-legenda">🟢 Partida: ${rtEsc(origemLabel)} &nbsp;·&nbsp; 🔴 Destino: ${rtEsc(destinoLabel)}</div>
        ${mapsUrl ? `
        <div class="rt-mapa-qr">
          <div id="rt-ficha-qr"></div>
          <div class="rt-sub">📱 Aponte a câmera pra abrir a rota completa no Google Maps</div>
        </div>` : ''}
        <div class="rt-sub">Esquema em linha reta entre as coordenadas cadastradas — não segue estrada nenhuma. Pra navegação de verdade, use o QR/link.</div>
      </div>` : '';

  return `
    <div class="rt-pagina-ficha">
      <div class="rt-cabecalho">
        <div class="rt-titulo">Ficha de Rota — ${rtEsc(rota.codigo)} — ${rtEsc(rota.nome)}</div>
        <div class="rt-sub">${(rota.tipos || []).map(t => RT_TIPO_LABEL[t] || t).join(' · ')} · Emitida em ${dataEmissao} · ${paradas.length} local(is)</div>
      </div>
      <div class="rt-info">
        <div><b>Partida:</b> ${rtEsc(rota.ponto_partida || '—')}${rota.horario_saida ? ` — ${rtEsc(rtFmtHora(rota.horario_saida))}` : ''}</div>
        <div><b>Destino:</b> ${rtEsc(rota.destino || '—')}${rota.horario_chegada_previsto ? ` — previsão ${rtEsc(rtFmtHora(rota.horario_chegada_previsto))}` : ''}</div>
        <div><b>Responsável:</b> ${responsavel ? `${rtEsc(responsavel.nome_completo)}${responsavel.telefone_whatsapp ? ` — ${rtEsc(fmtTelefone(responsavel.telefone_whatsapp))}` : ''}` : '—'}</div>
        ${rota.municipios?.length ? `<div><b>Municípios:</b> ${rota.municipios.map(rtEsc).join(', ')}</div>` : ''}
        ${rota.urnas_estimadas != null ? `<div><b>Urnas estimadas:</b> ${rota.urnas_estimadas}</div>` : ''}
        ${rota.tempo_parada_min != null && paradas.length ? `<div><b>Tempo estimado parado:</b> ${paradas.length} × ${rota.tempo_parada_min} min ≈ ${rtFmtMinutos(rtTempoTotalParadasMin(rota, paradas.length))} (sem contar deslocamento entre paradas)</div>` : ''}
        ${rota.itinerario ? `<div><b>Observações:</b> ${rtEsc(rota.itinerario)}</div>` : ''}
      </div>
      ${mapaHtml}
      <table class="rt-tabela">
        <colgroup><col class="rt-col-num"><col class="rt-col-local"><col class="rt-col-mun"><col class="rt-col-geo"><col class="rt-col-chegada"></colgroup>
        <thead><tr>
          <th>Nº</th><th>Local</th><th>Município</th><th>Coordenadas</th><th>Chegada</th>
        </tr></thead>
        <tbody>${linhas || '<tr><td colspan="5" class="rt-sub">Nenhum local de votação vinculado ainda.</td></tr>'}</tbody>
      </table>
      <div class="rt-rodape">Documento de apoio operacional do SIME — em caso de dúvida ou imprevisto, contate o cartório.</div>
    </div>`;
}

async function rtImprimirFicha(rotaId) {
  const rota = rtDados.rotas.find(r => r.id === rotaId);
  if (!rota) return;
  const paradas = rtDados.secoesPorRota.get(rotaId) || [];
  const responsavel = rtAtor(rota.responsavel_ator_id);
  const area = document.getElementById('print-area');
  area.innerHTML = rtHtmlFicha(rota, paradas, responsavel);
  // QR gerado à parte, depois do innerHTML — a mesma lib já vendorizada
  // (vendor/qrcode.min.js) que SIME_tokens.html usa pros QR de campo,
  // offline, sem custo. `new QRCode()` desenha sozinho (canvas), síncrono.
  const mapsUrl = rtMapsUrl(rota, paradas);
  const qrEl = document.getElementById('rt-ficha-qr');
  if (qrEl && mapsUrl && window.QRCode) {
    try {
      new QRCode(qrEl, { text: mapsUrl, width: 96, height: 96, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    } catch (e) { qrEl.innerHTML = ''; }
  }
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log('rota_ficha_impressa', '', { autor, rota_id: rotaId, codigo: rota.codigo, quantidade: paradas.length });
  window.print();
}
