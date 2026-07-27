// Testa a lógica REAL de modules/sime_dados.js com um client supabase-js falso
// escrito à mão (sime_dados.js não importa supabase-js diretamente — recebe o
// client já pronto via initSimeDados(), então dá pra importar o arquivo de
// produção sem nenhuma cópia/transformação).
import {
  initSimeDados, clearSimeDadosCache,
  getSecoes, getRotas, getMunicipios, getZonaInfo, getEleicaoAtiva,
} from '../modules/sime_dados.js';

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

// ── client falso: cobre exatamente as chamadas que sime_dados.js faz ──
function makeClient(db) {
  class QB {
    constructor(t) { this.t = t; this.f = {}; this._notNullCols = new Set(); }
    select() { return this; }
    eq(c, v) { this.f[c] = v; return this; }
    not(c, op, v) { if (op === 'is' && v === null) this._notNullCols.add(c); return this; }
    order() { return this; }
    limit() { return this; }
    _rows() {
      let rows = db[this.t] || [];
      for (const [k, v] of Object.entries(this.f)) rows = rows.filter((r) => r[k] === v);
      for (const c of this._notNullCols) rows = rows.filter((r) => r[c] != null);
      return rows;
    }
    maybeSingle() { const rows = this._rows(); return Promise.resolve({ data: rows[0] ?? null, error: null }); }
    then(resolve) { return resolve({ data: this._rows(), error: null }); }
  }
  return { from(t) { return new QB(t); } };
}

function seed() {
  return {
    sime_secoes: [
      { id: 's135', numero: 135, local_nome: 'G.E. Profª Maroquinha', municipio: 'Campo Maior', eleitores: 178, ativo: true, rota_id: 'r1', parada: 1, sime_rotas: { codigo: '001' } },
      { id: 's144', numero: 144, local_nome: 'G.E. Profª Maroquinha', municipio: 'Campo Maior', eleitores: 165, ativo: true, rota_id: 'r1', parada: 1, sime_rotas: { codigo: '001' } },
      { id: 's180', numero: 180, local_nome: 'U.E. José Gomes Oliveira', municipio: 'Campo Maior', eleitores: 200, ativo: true, rota_id: 'r1', parada: 2, sime_rotas: { codigo: '001' } },
      { id: 's063', numero: 63, local_nome: 'G.E. Treze de Março', municipio: 'Jatobá do Piauí', eleitores: 150, ativo: true, rota_id: null, parada: null, sime_rotas: null },
    ],
    sime_rotas: [
      { id: 'r1', codigo: '001', nome: 'Rota 001', municipios: ['Campo Maior'], ativo: true },
    ],
    sime_zonas: [
      { numero: 7, municipio: 'Campo Maior', lat: -4.8252, lon: -42.1733 },
    ],
    sime_eleicoes: [
      { id: 'ele-1', turno: 1, ativa: true },
      { id: 'ele-velha', turno: 1, ativa: false },
    ],
  };
}

// ── 1. Caminho feliz: getSecoes normaliza os nomes de campo ──
initSimeDados(makeClient(seed()));
{
  const secoes = await getSecoes({ fallback: ['NAO-DEVERIA-APARECER'] });
  check('getSecoes retorna 4 seções', secoes.length === 4);
  const s135 = secoes.find((s) => s.numero === 135);
  check('getSecoes normaliza local_nome', s135.local_nome === 'G.E. Profª Maroquinha');
  check('getSecoes normaliza município', s135.municipio === 'Campo Maior');
  check('getSecoes mapeia eleitores → aptos', s135.aptos === 178);
  check('getSecoes extrai rota_codigo do embed sime_rotas', s135.rota_codigo === '001');
  check('getSecoes inclui o id (UUID) da seção — necessário pra escrita (Fase 4)', s135.id === 's135');
  const s63 = secoes.find((s) => s.numero === 63);
  check('getSecoes: seção sem rota → rota_codigo null', s63.rota_codigo === null);
}

// ── 2. getRotas: agrupa seções por parada dentro da rota ──
clearSimeDadosCache();
initSimeDados(makeClient(seed()));
{
  const rotas = await getRotas({ fallback: [] });
  check('getRotas retorna 1 rota', rotas.length === 1);
  const r001 = rotas[0];
  check('getRotas: código correto', r001.codigo === '001');
  check('getRotas: municípios preservados', JSON.stringify(r001.municipios) === JSON.stringify(['Campo Maior']));
  check('getRotas: 2 paradas (ordem 1 e 2)', r001.paradas.length === 2);
  check('getRotas: parada 1 agrupa as 2 seções (135,144)', JSON.stringify(r001.paradas[0].secoes.sort()) === JSON.stringify([135, 144]));
  check('getRotas: parada 2 tem a seção 180', JSON.stringify(r001.paradas[1].secoes) === JSON.stringify([180]));
  check('getRotas: paradas ordenadas (1 antes de 2)', r001.paradas[0].ordem < r001.paradas[1].ordem);
}

// ── 3. getMunicipios: derivado de getSecoes, sem tabela própria ──
clearSimeDadosCache();
initSimeDados(makeClient(seed()));
{
  const muns = await getMunicipios({ fallback: [] });
  check('getMunicipios: 2 municípios distintos', muns.length === 2);
  const cm = muns.find((m) => m.nome === 'Campo Maior');
  check('getMunicipios: Campo Maior tem 3 seções', cm.secoes === 3);
}

// ── 4. getZonaInfo ──
clearSimeDadosCache();
initSimeDados(makeClient(seed()));
{
  const zona = await getZonaInfo({ fallback: null });
  check('getZonaInfo retorna número correto', zona.numero === 7);
  check('getZonaInfo retorna lat/lon (clima dinâmico)', zona.lat === -4.8252 && zona.lon === -42.1733);
}

// ── 4b. getEleicaoAtiva: só pega a que está ativa=true ──
clearSimeDadosCache();
initSimeDados(makeClient(seed()));
{
  const eleicao = await getEleicaoAtiva({ fallback: null });
  check('getEleicaoAtiva retorna a eleição ativa (ele-1, não a antiga)', eleicao.id === 'ele-1');
  check('getEleicaoAtiva retorna o turno', eleicao.turno === 1);
}

// ── 5. Fallback: client sem sessão (initSimeDados nunca chamado) ──
{
  // um módulo "novo" que nunca chamou initSimeDados nesta execução — simula
  // reiniciando o estado do módulo via um novo import com query string
  const mod2 = await import('../modules/sime_dados.js?semclient=1');
  const fallbackArr = [{ numero: 1, local_nome: 'X', municipio: 'Y' }];
  const secoes = await mod2.getSecoes({ fallback: fallbackArr });
  check('sem client inicializado → cai no fallback', secoes === fallbackArr);
}

// ── 6. Fallback: erro na consulta (tabela não existe / RLS bloqueou tudo) ──
{
  const mod3 = await import('../modules/sime_dados.js?erro=1');
  mod3.initSimeDados({ from() { return { select() { return this; }, eq() { return this; }, order() { return this; }, then(resolve) { return resolve({ data: null, error: { message: 'RLS bloqueou' } }); } }; } });
  const fallbackArr = [{ numero: 9, local_nome: 'Fallback', municipio: 'Z' }];
  const secoes = await mod3.getSecoes({ fallback: fallbackArr });
  check('erro na consulta → cai no fallback (offline-first)', secoes === fallbackArr);
}

// ── 7. Cache: segunda chamada não refaz a consulta (mesma referência) ──
clearSimeDadosCache();
{
  let chamadas = 0;
  const clientContador = makeClient(seed());
  const origFrom = clientContador.from.bind(clientContador);
  clientContador.from = (t) => { if (t === 'sime_secoes') chamadas++; return origFrom(t); };
  initSimeDados(clientContador);
  await getSecoes({ fallback: [] });
  await getSecoes({ fallback: [] });
  check('cache evita 2ª consulta idêntica (só 1 chamada a sime_secoes)', chamadas === 1);
}

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
