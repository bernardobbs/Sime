// Fecha o caso 8.7 do roteiro: o pânico levantado pela acessibilidade e
// resolvido pela equipe no Admin deixava AQUELE aparelho vermelho para sempre.
//
// A instrução operacional era "resolva no próprio aparelho" — uma regra que
// alguém tem que lembrar às 9h de um domingo, com o local cheio. Agora a
// resolução chega sozinha.
//
// Diferença para o mesário: lá o escopo é UMA seção; aqui é um LOCAL, com
// várias. O canal filtra por `secao_id=in.(...)` para o celular do coordenador
// não receber os eventos das outras ~170 seções da zona no Dia D.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_CONFIG = `export const SIME_CONFIG = {
  exigirPin: false,
  supabaseUrl: 'https://exemplo.supabase.co',
  supabaseAnonKey: 'anon-de-teste',
};`;

// A 63 e a 64 são do mesmo local (G.E. Treze de Março); a 209 é de outro.
const SECOES = [
  { id: 'sec-63',  numero: 63,  local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior', ativo: true, parada: null, sime_rotas: null },
  { id: 'sec-64',  numero: 64,  local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior', ativo: true, parada: null, sime_rotas: null },
  { id: 'sec-209', numero: 209, local_nome: 'Assoc. Tangará',      municipio: 'Campo Maior', ativo: true, parada: null, sime_rotas: null },
];

const STUB_SUPABASE_JS = `
const SECOES = ${JSON.stringify(SECOES)};
class QB {
  constructor(t){ this.t=t; this.inIds=null; }
  select(){ return this; }
  eq(){ return this; }
  in(col, vals){ this.inIds = vals; window.__mock.consultasIn.push({ col, vals }); return this; }
  order(){ return this; }
  limit(){ return this; }
  maybeSingle(){
    if(this.t==='sime_eleicoes') return Promise.resolve({ data:{ id:'ele-1', turno:1, ativa:true }, error:null });
    return Promise.resolve({ data:null, error:null });
  }
  then(res){
    if(this.t==='sime_secoes')  return res({ data:SECOES, error:null });
    if(this.t==='sime_eleicoes') return res({ data:[{ id:'ele-1', turno:1, ativa:true }], error:null });
    if(this.t==='sime_mesa_estado'){
      const linhas = (window.__mock.mesaEstado||[]).filter(r => !this.inIds || this.inIds.includes(r.secao_id));
      return res({ data: linhas, error:null });
    }
    return res({ data:[], error:null });
  }
}
export function createClient(){
  return {
    from(t){ return new QB(t); },
    channel(nome){
      window.__mock.canalNome = nome;
      const c = { on(ev, filtro, cb){ window.__mock.filtro = filtro; window.__mock.cb = cb; return c; }, subscribe(){ return c; } };
      return c;
    },
    removeChannel(){},
    rpc(nome, params){
      window.__mock.rpcCalls.push({ nome, params });
      return Promise.resolve({ data:null, error:null });
    },
  };
}
`;

function mock({ mesaEstado = [] } = {}) {
  return { rpcCalls: [], consultasIn: [], mesaEstado };
}

async function abrirLogado(ctx, m) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((x) => { window.__mock = x; }, m);
  await p.route('**/sime_config.js**', (r) =>
    r.fulfill({ status:200, contentType:'application/javascript', body: STUB_CONFIG }));
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status:200, contentType:'application/javascript', body: STUB_SUPABASE_JS }));
  await p.route('**/functions/v1/sime-login', (r) =>
    r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({
      jwt:'jwt.x', exp: Math.floor(Date.now()/1000)+999, zona_id:'z7',
      tipo:'coord_acessibilidade', local_id:null, local_nome:'G.E. Treze de Março', secoes:null,
    }) }));
  await p.goto('http://localhost:8917/modules/SIME_acessibilidade.html?token=ACESS123');
  await p.waitForTimeout(300);
  await p.click('.btn-login');
  await p.waitForTimeout(700);
  return { p, erros };
}

// ── 1. Assina só as seções do local ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirLogado(ctx, mock());

  const filtro = await p.evaluate(() => window.__mock.filtro);
  check('assina sime_mesa_estado', filtro?.table === 'sime_mesa_estado', JSON.stringify(filtro));
  check('filtra pelas seções do local (63 e 64)',
    filtro?.filter === 'secao_id=in.(sec-63,sec-64)', filtro?.filter);
  check('NÃO assina a seção de outro local (209)',
    !String(filtro?.filter || '').includes('sec-209'), filtro?.filter);
  check('callback registrado', await p.evaluate(() => typeof window.__mock.cb === 'function'));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. O CASO 8.7: equipe resolve pelo Admin → o aparelho acompanha ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirLogado(ctx, mock());

  // Coordenador aciona o pânico de energia na 63
  await p.click('[data-sec="0063"] .pbtn');
  await p.waitForTimeout(300);
  check('pânico local: cartão fica em alerta',
    await p.locator('[data-sec="0063"].acard.alert').count() === 1);

  // Equipe resolve pelo Admin → o servidor emite o UPDATE
  await p.evaluate(() => window.__mock.cb({
    new: { secao_id:'sec-63', panico_energia:false, panico_urna:false,
           panico_energia_resolvido:true, panico_urna_resolvido:false },
    eventType: 'UPDATE',
  }));
  await p.waitForTimeout(400);

  check('resolvido pelo Admin: o cartão SAI do alerta',
    await p.locator('[data-sec="0063"].acard.alert').count() === 0);
  check('estado interno acompanha', await p.evaluate(() =>
    state['0063'].panico.energia === false && state['0063'].panico_resolved.energia === true));
  check('avisa o coordenador', (await p.textContent('#toast')).includes('resolvido pela equipe'));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. O que chega do servidor não é reenviado de volta ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirLogado(ctx, mock());
  await p.evaluate(() => { window.__mock.rpcCalls.length = 0; });

  await p.evaluate(() => window.__mock.cb({
    new: { secao_id:'sec-63', panico_energia:true, panico_urna:false,
           panico_energia_resolvido:false, panico_urna_resolvido:false },
    eventType: 'UPDATE',
  }));
  await p.waitForTimeout(400);

  check('mudança vinda do servidor aparece na tela',
    await p.locator('[data-sec="0063"].acard.alert').count() === 1);
  check('e NÃO vira uma escrita de volta',
    (await p.evaluate(() => window.__mock.rpcCalls)).length === 0);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 4. Só o pânico vem do servidor; a fila é contagem local ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirLogado(ctx, mock());
  await p.click('[data-sec="0063"] .fbtn.plus');
  await p.click('[data-sec="0063"] .fbtn.plus');
  await p.waitForTimeout(300);
  const filaAntes = await p.evaluate(() => state['0063'].fila);

  await p.evaluate(() => window.__mock.cb({
    new: { secao_id:'sec-63', panico_energia:true, panico_urna:false,
           panico_energia_resolvido:false, panico_urna_resolvido:false, fila: 0 },
    eventType: 'UPDATE',
  }));
  await p.waitForTimeout(300);

  check('a fila local NÃO é sobrescrita pelo servidor',
    await p.evaluate(() => state['0063'].fila) === filaAntes, 'antes=' + filaAntes);
  check('mas o pânico foi aplicado',
    await p.evaluate(() => state['0063'].panico.energia === true));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5. Ao entrar, lê o estado atual — não espera um evento que já passou ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirLogado(ctx, mock({ mesaEstado: [
    { secao_id:'sec-64', panico_energia:true, panico_urna:false,
      panico_energia_resolvido:false, panico_urna_resolvido:false },
  ]}));
  await p.waitForTimeout(400);

  const consultas = await p.evaluate(() => window.__mock.consultasIn);
  check('consulta o estado das seções do local ao entrar',
    consultas.some(c => c.col === 'secao_id' && c.vals.includes('sec-63')), JSON.stringify(consultas));
  check('pânico que já existia no servidor aparece na tela',
    await p.locator('[data-sec="0064"].acard.alert').count() === 1);
  check('seção sem pânico continua normal',
    await p.locator('[data-sec="0063"].acard.alert').count() === 0);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
