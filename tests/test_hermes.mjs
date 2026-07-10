// Testa a lógica multi-zona do handler api/hermes-update.js com Supabase e fetch mockados.
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TESTS_DIR, '..');
// Copiado para dentro de tests/ (não /tmp) porque hermes-update.js importa
// '@supabase/supabase-js' (bare) — precisa resolver via tests/node_modules.
const _HERMES = join(TESTS_DIR, '_sime_hermes.mjs');
execSync(`cp ${ROOT}/api/hermes-update.js ${_HERMES}`);
process.on('exit', () => { try { execSync(`rm -f ${_HERMES}`); } catch (e) {} });

process.env.SUPABASE_URL='http://x';
process.env.SUPABASE_SERVICE_ROLE_KEY='k';
process.env.HERMES_URL='http://hermes.local';
// Duas zonas ativas simultaneamente, cada uma com seu próprio secret
process.env.HERMES_SECRET_ZONA_7='segredo7';
process.env.HERMES_SECRET_ZONA_96='segredo96';
delete process.env.HERMES_WEBHOOK_SECRET; // legado — não deve mais ser usado

const results=[]; const check=(n,c,e='')=>results.push({n,ok:!!c,e});

// estado inicial do "banco": 2 zonas, cada uma com uma seção de MESMO número (63)
// e uma eleição ativa própria — cenário que quebrava antes do fix multi-zona.
function resetDB(){
  globalThis.__SUPA={
    zonas:[{id:'zona-7',numero:7},{id:'zona-96',numero:96}],
    secoes:[
      {id:'sec-63-z7',  numero:63, zona_id:'zona-7',  local_nome:'G.E. Treze de Março', municipio:'Campo Maior'},
      {id:'sec-63-z96', numero:63, zona_id:'zona-96', local_nome:'Escola Modelo Z96',    municipio:'Cidade Z96'},
    ],
    eleicoes:[
      {id:'ele-z7',  zona_id:'zona-7',  ativa:true},
      {id:'ele-z96', zona_id:'zona-96', ativa:true},
    ],
    mesa:{}, midias:{}, logs:[], now:'2026-10-04T10:00:00.000Z', ops:[],
  };
}
let fetchCalls=[];
globalThis.fetch=async(url,opts)=>{ fetchCalls.push({url,opts}); return {ok:true,status:200}; };

const { default: handler } = await import(pathToFileURL(_HERMES).href);

function mkRes(){ return { code:null, body:null, status(c){this.code=c;return this;}, json(o){this.body=o;return this;} }; }
async function call(method, headers, body){
  fetchCalls=[];
  const req={ method, headers, body };
  const res=mkRes(); await handler(req,res); return res;
}
const AUTH_Z7  = {authorization:'Bearer segredo7'};
const AUTH_Z96 = {authorization:'Bearer segredo96'};

// ── AUTH / MÉTODO / VALIDAÇÃO ──
resetDB();
check('sem auth → 401', (await call('POST',{},{secao:'63',evento:'enc'})).code===401);
check('secret desconhecido → 401', (await call('POST',{authorization:'Bearer x'},{secao:'63',evento:'enc'})).code===401);
check('GET (auth ok) → 405', (await call('GET',AUTH_Z7,{})).code===405);
check('sem secao/evento → 400', (await call('POST',AUTH_Z7,{secao:'63'})).code===400);
check('evento desconhecido → 400', (await call('POST',AUTH_Z7,{secao:'63',evento:'xyz'})).code===400);

// ── ISOLAMENTO ENTRE ZONAS: mesma seção "63" existe nas duas zonas ──
resetDB();
let r7  = await call('POST',AUTH_Z7, {secao:'63',evento:'enc',valor:true,origem:'hermes'});
check('zona 7: enc → 200', r7.code===200);
check('zona 7: grava na seção certa (sec-63-z7)', globalThis.__SUPA.mesa['sec-63-z7']?.encerrada===true);
check('zona 7: NÃO grava na seção da zona 96', globalThis.__SUPA.mesa['sec-63-z96']===undefined);
check('zona 7: eleicao_id correto (ele-z7)', globalThis.__SUPA.mesa['sec-63-z7']?.eleicao_id==='ele-z7');

let r96 = await call('POST',AUTH_Z96,{secao:'63',evento:'fila',valor:'9'});
check('zona 96: fila → 200', r96.code===200);
check('zona 96: grava na seção certa (sec-63-z96)', globalThis.__SUPA.mesa['sec-63-z96']?.fila===9);
check('zona 96: eleicao_id correto (ele-z96)', globalThis.__SUPA.mesa['sec-63-z96']?.eleicao_id==='ele-z96');
check('zona 96: NÃO afeta o estado já gravado da zona 7', globalThis.__SUPA.mesa['sec-63-z7']?.encerrada===true && globalThis.__SUPA.mesa['sec-63-z7']?.fila===undefined);

// secao inexistente NA ZONA 7 mas existente só na 96 → deve dar 404 (isolamento)
resetDB();
globalThis.__SUPA.secoes = [ {id:'sec-99-z96', numero:99, zona_id:'zona-96', local_nome:'X', municipio:'Y'} ];
check('seção existe só na outra zona → 404 (não vaza entre zonas)', (await call('POST',AUTH_Z7,{secao:'99',evento:'enc'})).code===404);

// zona sem eleição ativa → 409
resetDB();
globalThis.__SUPA.eleicoes = [{id:'ele-z96', zona_id:'zona-96', ativa:true}]; // zona 7 sem eleição ativa
check('zona sem eleição ativa → 409', (await call('POST',AUTH_Z7,{secao:'63',evento:'enc'})).code===409);

// ── PÂNICO: notifica Hermes usando o secret DA MESMA zona que autenticou ──
resetDB();
await call('POST',AUTH_Z7,{secao:'63',evento:'panico_energia',valor:true});
check('pânico zona 7: notifica Hermes com o Bearer da zona 7', fetchCalls.some(c=>c.opts.headers.Authorization==='Bearer segredo7'));

resetDB();
await call('POST',AUTH_Z96,{secao:'63',evento:'panico_urna',valor:true});
check('pânico zona 96: notifica Hermes com o Bearer da zona 96 (não vaza secret da 7)', fetchCalls.some(c=>c.opts.headers.Authorization==='Bearer segredo96'));

// ── CASOS JÁ COBERTOS ANTES (garantir que não regrediram) ──
resetDB();
r7 = await call('POST',AUTH_Z7,{secao:'63',evento:'enc',valor:true,origem:'hermes'});
check('enc usa server ts (rpc sime_now, não Date.now)', globalThis.__SUPA.ops.some(o=>o.op==='rpc'&&o.name==='sime_now'));
check('enc registra log append-only', globalThis.__SUPA.logs.length===1 && globalThis.__SUPA.logs[0].acao==='hermes_atualizou_sime');
check('enc upsert usa onConflict eleicao_id,secao_id', globalThis.__SUPA.ops.some(o=>o.op==='upsert'&&o.onConflict==='eleicao_id,secao_id'));
check('enc grava updated_by_origem', globalThis.__SUPA.mesa['sec-63-z7']?.updated_by_origem==='hermes');

resetDB();
await call('POST',AUTH_Z7,{secao:'63',evento:'midia_pronta'});
check('midia_pronta grava em sime_midias status pronta', globalThis.__SUPA.midias['sec-63-z7']?.status==='pronta_para_coleta');
check('midia_pronta notifica Hermes', fetchCalls.some(c=>String(c.url).includes('sime_notificar')));

resetDB();
await call('POST',AUTH_Z7,{secao:'63',evento:'mesa_completa'});
check('mesa_completa marca 4 membros', ['mesa_pres','mesa_m1','mesa_m2','mesa_sec'].every(k=>globalThis.__SUPA.mesa['sec-63-z7'][k]===1));

resetDB();
globalThis.__SUPA.mesa['sec-63-z7']={secao_id:'sec-63-z7',panico_energia:true,panico_urna:false};
{ const req={method:'POST',headers:AUTH_Z7,body:{secao:'63',evento:'panico_resolvido'}}; const res=mkRes(); await handler(req,res);
  check('panico_resolvido → 200', res.code===200);
  check('panico_resolvido marca energia_resolvido (pois estava ativo)', globalThis.__SUPA.mesa['sec-63-z7'].panico_energia_resolvido===true);
  check('panico_resolvido NÃO marca urna_resolvido (não estava ativo)', globalThis.__SUPA.mesa['sec-63-z7'].panico_urna_resolvido===undefined);
}

let pass=0,fail=0;
for(const x of results){ console.log((x.ok?'PASS':'FAIL')+' — '+x.n+(x.e?'  ['+x.e+']':'')); x.ok?pass++:fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
