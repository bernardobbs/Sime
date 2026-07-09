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

// -> [{id, codigo, nome, municipios:[...], paradas:[{ordem, local_nome, secoes:[numero,...]}]}]
// `id` (UUID de sime_rotas) é necessário pra quem for GRAVAR em
// sime_rotas_estado (FK rota_id) — Conferente de Embarque (Fase 4).
export async function getRotas({ fallback = [] } = {}) {
  return withFallback('rotas', async (c) => {
    const { data: rotas, error: errR } = await c
      .from('sime_rotas')
      .select('id, codigo, nome, municipios')
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
        paradas: [...paradasPorOrdem.values()].sort((a, b) => a.ordem - b.ordem),
      };
    });
  }, fallback);
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
export async function getEleicaoAtiva({ fallback = null } = {}) {
  return withFallback('eleicaoAtiva', async (c) => {
    const { data, error } = await c
      .from('sime_eleicoes')
      .select('id, turno')
      .eq('ativa', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) throw error || new Error('nenhuma eleição ativa');
    return data;
  }, fallback);
}
