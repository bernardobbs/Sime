// modules/sime_tv_auth.js
// Bootstrap de sessão para os módulos de TV: troca um `?tv_token=` (uma vez, ao
// configurar o monitor) por uma sessão via a Edge Function sime-login, e mantém
// o JWT em localStorage entre reloads — a TV não tem teclado pra refazer login.
//
// Uso (cada módulo de TV):
//   import { bootstrapTvSession } from './sime_tv_auth.js';
//   const { client } = await bootstrapTvSession({ supabaseUrl, supabaseAnonKey });
//   if (client) initSimeDados(client);  // de sime_dados.js

const SESSION_KEY = 'sime_tv_session_v1';
const MARGEM_EXPIRACAO_MS = 60_000; // renova um pouco antes de expirar de verdade

function sessaoValida(s) {
  return !!s && !!s.jwt && !!s.exp && s.exp * 1000 > Date.now() + MARGEM_EXPIRACAO_MS;
}

function lerSessao() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
}

async function trocarToken(supabaseUrl, token) {
  const resp = await fetch(`${supabaseUrl}/functions/v1/sime-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!resp.ok) throw new Error(`sime-login retornou ${resp.status}`);
  return resp.json(); // { jwt, exp, zona_id, tipo }
}

// Retorna { client, zonaId, erro }. `client` vem null se não houver token (nem
// na URL, nem em localStorage) ou se a troca falhar — o módulo chamador deve
// seguir no fallback local/offline nesse caso, sem travar a tela.
export async function bootstrapTvSession({ supabaseUrl, supabaseAnonKey }) {
  const params = new URLSearchParams(location.search);
  const tokenDaUrl = params.get('tv_token');
  let sessao = lerSessao();

  if (tokenDaUrl || !sessaoValida(sessao)) {
    const tokenParaTrocar = tokenDaUrl || sessao?.token;
    if (!tokenParaTrocar) return { client: null, zonaId: null, erro: 'sem tv_token configurado' };
    try {
      const dados = await trocarToken(supabaseUrl, tokenParaTrocar);
      sessao = { token: tokenParaTrocar, jwt: dados.jwt, exp: dados.exp, zona_id: dados.zona_id };
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessao));
    } catch (erro) {
      return { client: null, zonaId: null, erro: String(erro) };
    }
  }

  const { createClient } = await import('./vendor/supabase-js.esm.js');
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${sessao.jwt}` } },
  });
  return { client, zonaId: sessao.zona_id, erro: null };
}

// Algumas TVs constroem o DOM (páginas, pontos de paginação) uma única vez, no
// carregamento, a partir do formato local (CITIES/ROTAS/...) — trocar esse dado
// DEPOIS que o DOM já foi montado exigiria reconstruir a tela toda. Em vez
// disso: o valor real (buscado no Supabase) é lido de forma SÍNCRONA de um
// cache em localStorage, no topo do script clássico, antes do DOM ser
// montado — e populado por atualizarCacheTv() de forma assíncrona.
export function lerCacheTv(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

// Busca o dado real e atualiza o cache. Na 1ª vez (sem cache ainda) recarrega
// a página uma única vez para que o script clássico monte o DOM já com o dado
// certo — depois disso só atualiza o cache silenciosamente em segundo plano,
// sem interromper a TV que já está no ar (o dado novo só aparece no próximo
// reload/troca de token, não no meio da exibição atual).
export async function atualizarCacheTv(key, fetchFn) {
  const tinhaCache = lerCacheTv(key) != null;
  try {
    const dados = await fetchFn();
    if (dados == null) return;
    localStorage.setItem(key, JSON.stringify(dados));
    if (!tinhaCache) location.reload();
  } catch (erro) {
    console.warn(`sime_tv_auth: falha ao atualizar cache "${key}" (${erro.message})`);
  }
}

const CORES_MUNICIPIO = ['#2d50a0', '#1e7048', '#5c3a98', '#a0522d', '#8a5c20', '#6040a0'];

// Agrupa a lista plana de seções (getSecoes()) no formato CITIES que
// SIME_tv_vespera.html/SIME_paineis.html/SIME_tv_dia.html já consumiam
// (município → locais → seções) — mesmo agrupamento, usado pelas 3 TVs em vez
// de duplicado em cada arquivo. `id` de cada local usa município+nome (estável
// entre reloads) em vez do 'CM-01' sequencial da massa de fallback — só é
// usado como chave interna (ex. cfg[loc.id]), nunca exibido.
export function agruparSecoesPorCidade(secoes) {
  const porMunicipio = new Map();
  for (const s of secoes) {
    if (!porMunicipio.has(s.municipio)) porMunicipio.set(s.municipio, new Map());
    const locs = porMunicipio.get(s.municipio);
    if (!locs.has(s.local_nome)) {
      locs.set(s.local_nome, { id: `${s.municipio}::${s.local_nome}`, n: s.local_nome, s: [] });
    }
    locs.get(s.local_nome).s.push(String(s.numero).padStart(4, '0'));
  }
  return [...porMunicipio.entries()].map(([city, locsMap], i) => ({
    city, color: CORES_MUNICIPIO[i % CORES_MUNICIPIO.length], locs: [...locsMap.values()],
  }));
}
