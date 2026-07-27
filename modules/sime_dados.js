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

// -> [{id, codigo, nome, municipios:[...], itinerario, urnas_estimadas, paradas:[{ordem, local_nome, secoes:[numero,...]}]}]
// `id` (UUID de sime_rotas) é necessário pra quem for GRAVAR em
// sime_rotas_estado (FK rota_id) — Conferente de Embarque (Fase 4).
export async function getRotas({ fallback = [] } = {}) {
  return withFallback('rotas', async (c) => {
    const { data: rotas, error: errR } = await c
      .from('sime_rotas')
      .select('id, codigo, nome, municipios, itinerario, urnas_estimadas')
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
        municipios: r.municipios || [],
        itinerario: r.itinerario || null,
        urnas_estimadas: r.urnas_estimadas ?? null,
        paradas: [...paradasPorOrdem.values()].sort((a, b) => a.ordem - b.ordem),
      };
    });
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
      .select('id, turno, zona_id')
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
    fila: row.fila ?? 0,
    panico: { energia: !!row.panico_energia, urnaprob: !!row.panico_urna },
    panico_resolved: { energia: !!row.panico_energia_resolvido, urnaprob: !!row.panico_urna_resolvido },
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
