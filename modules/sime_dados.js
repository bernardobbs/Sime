// modules/sime_dados.js
// Camada de dados única, zona-scoped, compartilhada pelos módulos HTML do SIME.
// ES module nativo (sem bundler) — cada módulo importa via <script type="module">
// e injeta seu próprio client supabase-js (já autenticado) com initSimeDados().
//
// Não filtra por zona explicitamente: sime_secoes/sime_rotas/sime_zonas já têm
// RLS por zona_id (ver sql/SIME_schema.sql, sime_zona_visivel()) — uma consulta
// autenticada já retorna só a zona de quem chama. Cada getter aceita um
// `fallback` (o array hardcoded que já existia naquele módulo) usado só quando
// a consulta falhar ou vier vazia — mesmo padrão já existente em
// SIME_tv_distribuicao.html (`ROTAS_FALLBACK`).

let _client = null;
const _cache = new Map();

export function initSimeDados(supabaseClient) {
  _client = supabaseClient;
  _cache.clear();
}

export function clearSimeDadosCache() {
  _cache.clear();
}

async function withFallback(cacheKey, fetcher, fallback) {
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);
  try {
    if (!_client) throw new Error('sime_dados: initSimeDados(client) não foi chamado');
    const data = await fetcher(_client);
    if (data == null || (Array.isArray(data) && data.length === 0)) throw new Error('resposta vazia');
    _cache.set(cacheKey, data);
    return data;
  } catch (e) {
    console.warn(`sime_dados: fallback para "${cacheKey}" (${e.message})`);
    return fallback;
  }
}

// -> [{id, numero, local_nome, municipio, aptos, rota_codigo, parada}]
// `id` (UUID de sime_secoes) é necessário pra quem for GRAVAR em
// sime_mesa_estado/sime_midias (FK secao_id) — os módulos de campo (Fase 4)
// resolvem numero→id via este campo em vez de fazer uma consulta separada.
export async function getSecoes({ fallback = [] } = {}) {
  return withFallback('secoes', async (c) => {
    const { data, error } = await c
      .from('sime_secoes')
      .select('id, numero, local_nome, municipio, eleitores, parada, sime_rotas(codigo)')
      .eq('ativo', true)
      .order('numero');
    if (error) throw error;
    return data.map((s) => ({
      id: s.id,
      numero: s.numero,
      local_nome: s.local_nome,
      municipio: s.municipio,
      aptos: s.eleitores,
      rota_codigo: s.sime_rotas?.codigo ?? null,
      parada: s.parada ?? null,
    }));
  }, fallback);
}

// -> [{id, codigo, nome, tipos:[...], municipios:[...], itinerario, urnas_estimadas, paradas:[{ordem, local_nome, secoes:[numero,...]}]}]
// `id` (UUID de sime_rotas) é necessário pra quem for GRAVAR em
// sime_rotas_estado (FK rota_id) — Conferente de Embarque (Fase 4).
// `paradas` continua resolvida por `sime_secoes.rota_id`/`parada` — o espelho
// legado que só é escrito pra rota de tipo 'distribuicao' (ver módulo 🗺️
// Rotas, RT_TIPOS_LEGADO em sime_rotas_modulo.js) — então pra qualquer outro
// tipo (`instalacao`/`recolhimento_urna`/`recolhimento_midia`) `paradas` vem
// vazio aqui, mesmo com seções cadastradas em `sime_rota_secoes`. `tipos` é
// exposto pra quem precisar filtrar por tipo sem duplicar essa decisão (ex.:
// SIME_tokens.html, escolhendo qual rota oferecer pra token de Instalador);
// quem precisar da lista de seções de verdade, de qualquer tipo, usa
// getRotaSecoesMap() abaixo, que lê `sime_rota_secoes` direto.
export async function getRotas({ fallback = [] } = {}) {
  return withFallback('rotas', async (c) => {
    const { data: rotas, error: errR } = await c
      .from('sime_rotas')
      .select('id, codigo, nome, tipos, municipios, itinerario, urnas_estimadas')
      .eq('ativo', true)
      .order('codigo');
    if (errR) throw errR;
    const { data: secoes, error: errS } = await c
      .from('sime_secoes')
      .select('numero, local_nome, rota_id, parada')
      .eq('ativo', true)
      .not('rota_id', 'is', null)
      .order('parada');
    if (errS) throw errS;

    return rotas.map((r) => {
      const paradasPorOrdem = new Map();
      for (const s of secoes.filter((s) => s.rota_id === r.id)) {
        const ordem = s.parada ?? 0;
        if (!paradasPorOrdem.has(ordem)) {
          paradasPorOrdem.set(ordem, { ordem, local_nome: s.local_nome, secoes: [] });
        }
        paradasPorOrdem.get(ordem).secoes.push(s.numero);
      }
      return {
        id: r.id,
        codigo: r.codigo,
        nome: r.nome,
        tipos: r.tipos || [],
        municipios: r.municipios || [],
        itinerario: r.itinerario || null,
        urnas_estimadas: r.urnas_estimadas ?? null,
        paradas: [...paradasPorOrdem.values()].sort((a, b) => a.ordem - b.ordem),
      };
    });
  }, fallback);
}

// -> {rotaId: [numeroSecao,...]} — seções de CADA rota via `sime_rota_secoes`,
// a fonte de verdade pra qualquer tipo de rota (diferente de getRotas().paradas,
// que só reflete o espelho legado de rota tipo 'distribuicao'). Usado por
// SIME_tokens.html pra resolver o escopo real de um token de Instalador (que
// lê `secoes`, nunca `rotas`, ver SIME_instalador.html) a partir da rota de
// tipo 'instalacao' escolhida no formulário.
export async function getRotaSecoesMap({ fallback = {} } = {}) {
  return withFallback('rota_secoes_map', async (c) => {
    const { data, error } = await c
      .from('sime_rota_secoes')
      .select('rota_id, parada, sime_secoes(numero)')
      .order('parada');
    if (error) throw error;
    const map = {};
    for (const row of data) {
      const numero = row.sime_secoes?.numero;
      if (numero == null) continue;
      if (!map[row.rota_id]) map[row.rota_id] = [];
      map[row.rota_id].push(numero);
    }
    return map;
  }, fallback);
}

// -> [{id, nome, rotas:[rotaId,...]}] — empresas de transporte de urnas.
// Usado por SIME_admin.html pra resolver o escopo real do Coord. de
// Motoristas (perfil='coord_motoristas') a partir de sime_empresas.rotas,
// em vez da lista de seções digitada à mão (dívida técnica da Fase 3).
export async function getEmpresas({ fallback = [] } = {}) {
  return withFallback('empresas', async (c) => {
    const { data, error } = await c
      .from('sime_empresas')
      .select('id, nome, rotas')
      .eq('ativo', true)
      .order('nome');
    if (error) throw error;
    return data.map((e) => ({ id: e.id, nome: e.nome, rotas: e.rotas || [] }));
  }, fallback);
}

// -> [{id, nome, telefone, funcao, funcao_mesa, secao, confirmacao, ativo}]
// Atores operacionais da zona (mesários, coordenadores, auxiliares...).
// A RLS de sime_atores é sime_zona_visivel(zona_id), então não é preciso — nem
// correto — filtrar zona aqui: quem manda é a sessão.
//
// `secao` sai com 4 dígitos para bater com o shape que os módulos já usam
// (sime_atores_v1 no localStorage), o que permite trocar a fonte sem reescrever
// a renderização. O número vem de sime_secoes via secao_id; quando o ator não
// tem seção (cartório, junta), fica string vazia.
export async function getAtores({ fallback = [] } = {}) {
  return withFallback('atores', async (c) => {
    const [{ data, error }, secoes] = await Promise.all([
      c.from('sime_atores')
        .select('id, nome_completo, telefone_whatsapp, funcao, funcao_mesa, secao_id, confirmacao, ativo, inscricao_eleitoral')
        .order('nome_completo'),
      getSecoes({ fallback: [] }),
    ]);
    if (error) throw error;
    const numeroPorId = Object.fromEntries((secoes || []).map((s) => [s.id, s.numero]));
    return (data || []).map((a) => ({
      id: a.id,
      nome: a.nome_completo,
      telefone: a.telefone_whatsapp || '',
      funcao: a.funcao,
      funcao_mesa: a.funcao_mesa || '',
      secao: a.secao_id && numeroPorId[a.secao_id]
        ? String(numeroPorId[a.secao_id]).padStart(4, '0') : '',
      confirmacao: a.confirmacao || 'pendente',
      ativo: a.ativo !== false,
      inscricao: a.inscricao_eleitoral || '',
    }));
  }, fallback);
}

// -> [numero,...] (4 dígitos, ex.: '0063') — todas as seções cobertas pelas
// rotas de uma empresa. `rotas` já vem de getRotas() (paradas[].secoes já é
// numero, não UUID) — junta pelos rotaIds da empresa.
export function secoesDaEmpresa(empresaRotaIds, rotasReais) {
  const alvo = new Set(empresaRotaIds || []);
  const secoes = [];
  for (const r of rotasReais || []) {
    if (!alvo.has(r.id)) continue;
    for (const p of r.paradas) for (const numero of p.secoes) secoes.push(String(numero).padStart(4, '0'));
  }
  return secoes;
}

// -> [{nome, secoes}] — derivado de getSecoes, sem tabela própria
export async function getMunicipios({ fallback = [] } = {}) {
  const secoes = await getSecoes({ fallback: null });
  if (secoes == null) return fallback;
  const nomes = [...new Set(secoes.map((s) => s.municipio))];
  return nomes.map((nome) => ({ nome, secoes: secoes.filter((s) => s.municipio === nome).length }));
}

// -> {numero, municipio, lat, lon}
export async function getZonaInfo({ fallback = null } = {}) {
  return withFallback('zonaInfo', async (c) => {
    const { data, error } = await c.from('sime_zonas').select('numero, municipio, lat, lon').limit(1).maybeSingle();
    if (error || !data) throw error || new Error('zona não encontrada');
    return data;
  }, fallback);
}

// -> {id, turno} — necessário pra todo escrita de campo (FK eleicao_id em
// sime_mesa_estado/sime_midias/sime_rotas_estado). ORDER BY created_at DESC
// como proteção extra contra 2 eleições ativas simultâneas na mesma zona
// (mesmo raciocínio já usado em api/hermes-update.js).
// `zonaId` restringe a busca a uma zona específica. Para um admin de zona a RLS
// já filtra sozinha e o parâmetro é redundante; ele existe por causa do
// super_admin, que enxerga TODAS as zonas — sem filtro, o ORDER BY created_at
// devolveria a eleição ativa mais recente de qualquer zona, e as gravações
// (tokens, mesa, mídias) iriam parar na zona errada, em silêncio.
export async function getEleicaoAtiva({ fallback = null, zonaId = null } = {}) {
  return withFallback(`eleicaoAtiva:${zonaId || 'minha'}`, async (c) => {
    let q = c
      .from('sime_eleicoes')
      .select('id, turno, zona_id, data_d, data_d1, horario_ab, horario_enc, nome, dist_inicio, intervalo_saidas_min, minutos_por_eleitor_fila')
      .eq('ativa', true);
    if (zonaId) q = q.eq('zona_id', zonaId);
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) throw error || new Error('nenhuma eleição ativa');
    return data;
  }, fallback);
}

// Converte 1 linha de sime_mesa_estado pro MESMO shape que já vive em
// localStorage['sime_mesa_v1'] — assim as TVs trocam a fonte de dado sem
// precisar reescrever a lógica de leitura (getSt/buildPages etc.).
export function mapMesaEstadoRow(row) {
  return {
    mesa: { pres: row.mesa_pres ?? 0, m1: row.mesa_m1 ?? 0, m2: row.mesa_m2 ?? 0, sec: row.mesa_sec ?? 0 },
    zero: !!row.zeresima, vot: !!row.votacao, enc: !!row.encerrada,
    bu: !!row.bu_impresso, mat: !!row.material_recolhido,
    urna: !!row.urna_recolhida, urna_cartorio: !!row.urna_cartorio,
    fila: row.fila ?? 0, obs: row.observacao || '',
    panico: { energia: !!row.panico_energia, urnaprob: !!row.panico_urna, sos: !!row.panico_sos },
    panico_resolved: { energia: !!row.panico_energia_resolvido, urnaprob: !!row.panico_urna_resolvido, sos: !!row.panico_sos_resolvido },
    origem: row.updated_by_origem || '',
    ts: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

// Converte 1 linha de sime_mesa_estado pro shape de localStorage['sime_inst_v1']
// (SIME_instalador.html/SIME_tv_vespera.html) — chegou/posicionada/instalada
// do instalador, D-1.
export function mapMesaEstadoRowToInst(row) {
  return {
    s1: !!row.urna_chegou, s2: !!row.urna_posicionada, s3: !!row.urna_instalada,
    prob: !!row.problema_instalacao, probResolvido: !!row.problema_instalacao_resolvido,
  };
}

// Bruto (numero + linha), cache único — evita 2 consultas iguais quando uma
// TV precisa de mais de um shape derivado dos mesmos dados.
async function getMesaEstadoRowsPorNumero({ fallback = null } = {}) {
  return withFallback('mesaEstadoRows', async (c) => {
    const secoes = await getSecoes({ fallback: null });
    if (!secoes) throw new Error('sem seções pra mapear secao_id -> numero');
    const numeroPorSecaoId = new Map(secoes.map((s) => [s.id, s.numero]));
    const { data, error } = await c.from('sime_mesa_estado').select('*');
    if (error) throw error;
    return data
      .map((row) => ({ numero: numeroPorSecaoId.get(row.secao_id), row }))
      .filter((x) => x.numero != null);
  }, fallback);
}

// -> {numero: {...}} — snapshot inicial de sime_mesa_estado pra zona, no
// mesmo shape de sime_mesa_v1. Usado pelas TVs junto com subscribeMesaEstado
// (sime_realtime.js) pra popular a tela antes da primeira mudança chegar.
export async function getMesaEstadoMap({ fallback = null } = {}) {
  const rows = await getMesaEstadoRowsPorNumero({ fallback: null });
  if (!rows) return fallback;
  const map = {};
  for (const { numero, row } of rows) map[String(numero).padStart(4, '0')] = mapMesaEstadoRow(row);
  return map;
}

// -> {numero: {s1,s2,s3,prob,probResolvido}} — mesmo shape de
// localStorage['sime_inst_v1']. Usado pela TV Véspera.
export async function getInstMap({ fallback = null } = {}) {
  const rows = await getMesaEstadoRowsPorNumero({ fallback: null });
  if (!rows) return fallback;
  const map = {};
  for (const { numero, row } of rows) map[String(numero).padStart(4, '0')] = mapMesaEstadoRowToInst(row);
  return map;
}

// Converte 1 linha de sime_midias pro shape que a aba Mídias do Admin já usa
// (era o formato de localStorage['sime_midias_v1']).
export function mapMidiaRow(row) {
  return {
    status: row.status, tipo_coleta: row.tipo_coleta || null,
    pronta_ts: row.pronta_ts ? new Date(row.pronta_ts).getTime() : null,
    em_coleta_ts: row.em_coleta_ts ? new Date(row.em_coleta_ts).getTime() : null,
    coletada_ts: row.coletada_ts ? new Date(row.coletada_ts).getTime() : null,
    entregue_ts: row.entregue_ts ? new Date(row.entregue_ts).getTime() : null,
    observacao: row.observacao || '',
    updated_at: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    tecnico_responsavel_id: row.tecnico_responsavel_id || null,
    transmissao_status: row.transmissao_status || 'pendente',
    transmissao_ts: row.transmissao_ts ? new Date(row.transmissao_ts).getTime() : null,
    transmissao_obs: row.transmissao_obs || '',
  };
}

// -> {numero: {status, tipo_coleta, pronta_ts, ...}} — mesmo shape de
// localStorage['sime_midias_v1']. Usado pela aba Mídias do Admin.
export async function getMidiasMap({ fallback = null } = {}) {
  return withFallback('midiasMap', async (c) => {
    const secoes = await getSecoes({ fallback: null });
    if (!secoes) throw new Error('sem seções pra mapear secao_id -> numero');
    const numeroPorSecaoId = new Map(secoes.map((s) => [s.id, s.numero]));
    const { data, error } = await c.from('sime_midias').select('*');
    if (error) throw error;
    const map = {};
    for (const row of data) {
      const numero = numeroPorSecaoId.get(row.secao_id);
      if (numero == null) continue;
      map[String(numero).padStart(4, '0')] = mapMidiaRow(row);
    }
    return map;
  }, fallback);
}

// -> {'Rota 001': {status, conferente, ts_aberta, ts_pronta, ts_saiu, alerta,
//     urnas:{numero:bool}}} — mesmo shape de localStorage['sime_dist_v1'].rotas.
// Usado pela TV Distribuição. Não cacheado internamente por withFallback —
// getRotasEstadoMap() cacheia (snapshot inicial); refreshRotasEstadoMap()
// bypassa o cache pra sempre trazer o dado mais recente (usado pelo handler
// de Realtime, onde um cache faria a tela nunca atualizar).
async function fetchRotasEstadoMap(c) {
  const rotas = await getRotas({ fallback: null });
  const secoes = await getSecoes({ fallback: null });
  if (!rotas || !secoes) throw new Error('sem rotas/seções pra mapear rota_id/secao_id');
  const nomePorRotaId = new Map(rotas.map((r) => [r.id, 'Rota ' + r.codigo]));
  const numeroPorSecaoId = new Map(secoes.map((s) => [s.id, s.numero]));

  const { data: estados, error: errE } = await c.from('sime_rotas_estado').select('*');
  if (errE) throw errE;
  const { data: urnas, error: errU } = await c.from('sime_rotas_urnas').select('*');
  if (errU) throw errU;

  const nomePorEstadoId = new Map();
  const map = {};
  for (const row of estados) {
    const nome = nomePorRotaId.get(row.rota_id);
    if (!nome) continue;
    nomePorEstadoId.set(row.id, nome);
    map[nome] = {
      status: row.status, conferente: row.conferente_nome || '',
      ts_aberta: row.ts_aberta ? new Date(row.ts_aberta).getTime() : null,
      ts_pronta: row.ts_pronta ? new Date(row.ts_pronta).getTime() : null,
      ts_saiu: row.ts_saiu ? new Date(row.ts_saiu).getTime() : null,
      alerta: !!row.alerta,
      urnas: {},
    };
  }
  for (const row of urnas) {
    const nome = nomePorEstadoId.get(row.rota_estado_id);
    if (!nome || !map[nome]) continue;
    const numero = numeroPorSecaoId.get(row.secao_id);
    if (numero == null) continue;
    map[nome].urnas[String(numero).padStart(4, '0')] = !!row.embarcada;
  }
  return map;
}

export async function getRotasEstadoMap({ fallback = null } = {}) {
  return withFallback('rotasEstadoMap', fetchRotasEstadoMap, fallback);
}

export async function refreshRotasEstadoMap() {
  if (!_client) return null;
  try { return await fetchRotasEstadoMap(_client); } catch (e) { return null; }
}

// -> {rotaId: {codigo, nome, lat, lng, ts}} — última posição conhecida de
// cada rota (08/09/2026, "visão estimada do local no mapa em que está cada
// veículo") — SEM inventar rastreamento contínuo: motorista_lat/lng/pos_ts
// só existem quando o motorista já confirmou alguma ação (entrega,
// recolhimento, chegada ao cartório — sime_rota_estado_upsert grava a
// geolocalização do navegador nesse instante). Rota sem nenhum informe ainda
// simplesmente não entra no mapa. Chaveado por rota_id (UUID), não pelo nome
// "Rota 00X" como fetchRotasEstadoMap() — o payload de Realtime de
// sime_rotas_estado só traz rota_id, e casar por ele evita mais uma consulta
// pra resolver nome→id na hora de aplicar um evento.
async function fetchRotasPosicaoMap(c) {
  const rotas = await getRotas({ fallback: null });
  if (!rotas) throw new Error('sem rotas pra resolver código/nome');
  const metaPorRotaId = new Map(rotas.map((r) => [r.id, { codigo: r.codigo, nome: r.nome }]));

  const { data: estados, error } = await c.from('sime_rotas_estado')
    .select('rota_id, motorista_lat, motorista_lng, motorista_pos_ts')
    .not('motorista_pos_ts', 'is', null);
  if (error) throw error;

  const map = {};
  for (const row of estados) {
    const meta = metaPorRotaId.get(row.rota_id);
    if (!meta || row.motorista_lat == null || row.motorista_lng == null) continue;
    map[row.rota_id] = {
      codigo: meta.codigo, nome: meta.nome,
      lat: row.motorista_lat, lng: row.motorista_lng,
      ts: row.motorista_pos_ts ? new Date(row.motorista_pos_ts).getTime() : null,
    };
  }
  return map;
}

export async function getRotasPosicaoMap({ fallback = null } = {}) {
  return withFallback('rotasPosicaoMap', fetchRotasPosicaoMap, fallback);
}

export async function refreshRotasPosicaoMap() {
  if (!_client) return null;
  try { return await fetchRotasPosicaoMap(_client); } catch (e) { return null; }
}

// -> [{id, codigo, nome, horario_chegada_previsto, secoes:[numero,...]}] —
// rotas de tipo 'recolhimento_midia' com as seções atribuídas (número com 4
// dígitos, via sime_rota_secoes). Extraído aqui (08/09/2026) pra ser
// reaproveitado tanto pela aba 🔮 Previsão do Admin quanto pelo mesmo painel
// na TV Dia, sem duplicar a query nos dois lugares — window.ROTAS_REAIS
// (getRotas()) não serve pra isto, ele lê sime_secoes.rota_id, campo legado
// que só é escrito por rota de tipo 'distribuicao' desde a correção do
// módulo de Rotas (ver CLAUDE.md — "recolhimento de urna é cadastro
// separado").
async function fetchRotasRecolhimentoMidia(c) {
  const secoes = await getSecoes({ fallback: null });
  if (!secoes) throw new Error('sem seções pra mapear secao_id -> numero');
  const numeroPorSecaoId = new Map(secoes.map((s) => [s.id, String(s.numero).padStart(4, '0')]));

  const { data: todasRotas, error } = await c.from('sime_rotas')
    .select('id, codigo, nome, tipos, horario_chegada_previsto')
    .eq('ativo', true)
    .order('codigo');
  if (error) throw error;
  // Filtro por tipo em JS (não .contains() na query) — mesmo critério já
  // usado em sime_rotas_modulo.js pra RT_TIPOS_LEGADO.
  const rotas = (todasRotas || []).filter((r) => Array.isArray(r.tipos) && r.tipos.includes('recolhimento_midia'));
  const rotaIds = rotas.map((r) => r.id);
  const { data: rotaSecoes } = rotaIds.length
    ? await c.from('sime_rota_secoes').select('rota_id, secao_id').in('rota_id', rotaIds)
    : { data: [] };

  return rotas.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    nome: r.nome,
    horario_chegada_previsto: r.horario_chegada_previsto || null,
    secoes: (rotaSecoes || [])
      .filter((rs) => rs.rota_id === r.id)
      .map((rs) => numeroPorSecaoId.get(rs.secao_id))
      .filter((n) => n != null),
  }));
}

export async function getRotasRecolhimentoMidia({ fallback = null } = {}) {
  return withFallback('rotasRecolhimentoMidia', fetchRotasRecolhimentoMidia, fallback);
}
