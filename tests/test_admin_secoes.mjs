// Testa o CRUD de seções em SIME_admin.html: um coordenador (config_equipe)
// abre "Gerenciar seções", vê a lista, inclui uma nova seção (insert), edita
// (update) e exclui (delete) — tudo contra um supabase stubado que registra
// as operações. Verifica também que o botão só age com permissão.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs() {
  return `
export function createClient(){
  let session=null;
  globalThis.__ops=[];
  let SECOES=[
    {id:'x1',zona_id:'z7',numero:63,municipio:'Campo Maior',local_nome:'G.E. Treze',eleitores:300,rota_id:'r1',ativo:true},
    {id:'x2',zona_id:'z7',numero:64,municipio:'Campo Maior',local_nome:'G.E. Treze',eleitores:280,rota_id:'r1',ativo:true},
  ];
  const ROTAS=[{id:'r1',codigo:'001',nome:'Rota 001',municipios:['Campo Maior'],ativo:true}];
  const USER={nome:'Rafa Coord',perfil:'coordenador',zona_id:'z7'};
  function tbl(t){
    let pending=null;
    const api={
      select(){ return api; }, eq(){ return api; }, order(){ return api; }, not(){ return api; }, limit(){ return api; }, in(){ return api; },
      maybeSingle(){
        if(t==='sime_usuarios') return Promise.resolve({data:USER,error:null});
        return Promise.resolve({data:null,error:null});
      },
      insert(p){ globalThis.__ops.push({op:'insert',t,p}); SECOES.push({id:'new'+(SECOES.length+1),...p}); return Promise.resolve({error:null}); },
      update(p){ pending={op:'update',p}; return api; },
      delete(){ pending={op:'delete'}; return api; },
      then(res){
        if(t==='sime_secoes') return res({data:SECOES.slice(),error:null});
        if(t==='sime_rotas') return res({data:ROTAS,error:null});
        return res({data:[],error:null});
      },
    };
    // eq() precisa finalizar update/delete pendentes
    api.eq=(col,val)=>{
      if(pending&&pending.op==='update'){ globalThis.__ops.push({op:'update',t,val,p:pending.p}); const i=SECOES.findIndex(s=>s.id===val); if(i>-1) SECOES[i]={...SECOES[i],...pending.p}; pending=null; return Promise.resolve({error:null}); }
      if(pending&&pending.op==='delete'){ globalThis.__ops.push({op:'delete',t,val}); SECOES=SECOES.filter(s=>s.id!==val); pending=null; return Promise.resolve({error:null}); }
      return api;
    };
    return api;
  }
  return {
    auth:{
      getSession:async()=>({data:{session}}),
      getUser:async()=>({data:{user:session?{id:'a1',email:'c@x.gov'}:null}}),
      signInWithPassword:async({email})=>{ session={user:{email}}; return {data:{session},error:null}; },
      signOut:async()=>({error:null}),
      onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
    },
    from:(t)=>tbl(t),
    rpc:async()=>({data:new Date().toISOString(),error:null}),
    channel:()=>({on(){return this;},subscribe(){return this;}}),
    removeChannel(){},
  };
}
`;
}

const ctx = await b.newContext();
const p = await ctx.newPage();
const erros = [];
p.on('pageerror', (e) => erros.push(String(e)));
await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs() });
});
await p.route('**/modules/sime_dados.js', async (route) => {
  // stub mínimo do módulo de dados: getSecoes lê do supabase injetado
  await route.fulfill({ status: 200, contentType: 'application/javascript', body: `
    let _sb=null;
    export function initSimeDados(sb){ _sb=sb; }
    export async function getSecoes(){ const {data}=await _sb.from('sime_secoes').select('*').order('numero'); return (data||[]).map(s=>({numero:s.numero,local_nome:s.local_nome,municipio:s.municipio,rota_codigo:'',aptos:s.eleitores})); }
    export async function getRotas(){ const {data}=await _sb.from('sime_rotas').select('*'); return data||[]; }
    export async function getMunicipios(){ return null; }
    export async function getEmpresas(){ return null; }
    export async function getAtores(){ return null; }
    export async function getZonaInfo(){ return null; }
    export function secoesDaEmpresa(){ return []; }
  `});
});
await p.goto('http://localhost:8917/modules/SIME_admin.html');
await p.waitForTimeout(300);
await p.fill('#login-email', 'c@x.gov');
await p.fill('#login-pass', 'senha');
await p.click('#login-form button[type=submit]');
await p.waitForTimeout(500);

check('zero erros JS', erros.length === 0, erros.join('; '));

// abre a aba Seções e o gerenciador
await p.click('button.nav-tab[onclick*="secoes"]');
await p.waitForTimeout(150);
await p.click('button[onclick="openSecoesManager()"]');
await p.waitForTimeout(300);
const titulo = await p.locator('.modal-title').textContent();
check('gerenciador abre com contagem', /Gerenciar seções \(2\)/.test(titulo), titulo);
const linhas = await p.locator('.modal-body table tbody tr').count();
check('lista 2 seções', linhas === 2, 'n=' + linhas);

// inclui nova seção
await p.click('button[onclick="secaoForm(\'\')"]');
await p.waitForTimeout(150);
await p.fill('#sc-numero', '65');
await p.fill('#sc-municipio', 'Campo Maior');
await p.fill('#sc-local', 'G.E. Nova');
await p.fill('#sc-eleitores', '250');
await p.click('button[onclick^="salvarSecao"]');
await p.waitForTimeout(400);
const opsInsert = await p.evaluate(() => globalThis.__ops.filter(o => o.op === 'insert' && o.t === 'sime_secoes'));
check('insert enviado ao supabase', opsInsert.length === 1 && opsInsert[0].p.numero === 65, JSON.stringify(opsInsert));
const linhas2 = await p.locator('.modal-body table tbody tr').count();
check('lista recarrega com 3 seções', linhas2 === 3, 'n=' + linhas2);

// exclui a primeira
p.on('dialog', d => d.accept());
await p.click('.modal-body table tbody tr:first-child button[onclick^="excluirSecao"]');
await p.waitForTimeout(400);
const opsDel = await p.evaluate(() => globalThis.__ops.filter(o => o.op === 'delete'));
check('delete enviado ao supabase', opsDel.length === 1, JSON.stringify(opsDel));

await ctx.close();
await b.close();

let ok = 0, fail = 0;
for (const r of results) { if (r.ok) { ok++; } else { fail++; console.log('  ✗ ' + r.n + (r.e ? ' — ' + r.e : '')); } }
console.log(`\n${ok} checks OK, ${fail} falharam`);
process.exit(fail ? 1 : 0);
