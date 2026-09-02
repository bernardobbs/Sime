// Testava o painel "Confirmação de mesários" embutido em SIME_admin.html
// (modal com lista, filtro, marcar confirmado/recusou/substituído). Migrado
// em 20/08/2026 pra SIME_convocacao.html (página própria, com mais recursos:
// contato incorreto separado de recusou, meio de contato alternativo,
// dashboard por local/seção) — aqui só confirma que o botão do Admin agora
// aponta pra lá, e que o modal antigo (openMesariosManager) não existe mais.
// Cobertura funcional real do fluxo de confirmação: tests/test_convocacao_mesarios.mjs.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs() {
  return `
export function createClient(){
  let session=null;
  const USER={nome:'Rafa Coord',perfil:'coordenador',zona_id:'z7'};
  function tbl(t){
    const api={
      select(){ return api; }, order(){ return api; }, not(){ return api; }, limit(){ return api; }, in(){ return api; }, eq(){ return api; },
      maybeSingle(){
        if(t==='sime_usuarios') return Promise.resolve({data:USER,error:null});
        return Promise.resolve({data:null,error:null});
      },
      then(res){ return res({data:[],error:null}); },
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
  await route.fulfill({ status: 200, contentType: 'application/javascript', body: `
    export function initSimeDados(){}
    export async function getSecoes(){ return []; }
    export async function getRotas(){ return []; }
    export async function getMunicipios(){ return null; }
    export async function getEmpresas(){ return null; }
    export async function getAtores(){ return null; }
    export async function getZonaInfo(){ return null; }
    export function secoesDaEmpresa(){ return []; }
    export async function getEleicaoAtiva(){ return null; }
    export function mapMesaEstadoRow(){ return {}; }
    export async function getMesaEstadoMap(){ return null; }
    export function mapMidiaRow(){ return {}; }
    export async function getMidiasMap(){ return null; }
    export async function getRotasEstadoMap(){ return {}; }
  `});
});
await p.goto('http://localhost:8917/modules/SIME_admin.html');
await p.waitForTimeout(300);
await p.fill('#login-email', 'c@x.gov');
await p.fill('#login-pass', 'senha');
await p.click('#login-form button[type=submit]');
await p.waitForTimeout(500);

check('zero erros JS', erros.length === 0, erros.join('; '));

await p.click('button.nav-tab[onclick*="secoes"]');
await p.waitForTimeout(150);

const link = p.locator('a:has-text("Confirmação de mesários")');
check('botão "Confirmação de mesários" existe na aba Seções', await link.count() === 1);
check('aponta pra SIME_convocacao.html (não abre mais modal próprio)', await link.getAttribute('href') === './SIME_convocacao.html');
check('modal antigo (openMesariosManager) foi removido do código', !(await p.content()).includes('openMesariosManager'));

check('zero erros JS', erros.length === 0, erros.join('; '));

await ctx.close();
await b.close();

let ok = 0, fail = 0;
for (const r of results) { if (r.ok) { ok++; } else { fail++; console.log('  ✗ ' + r.n + (r.e ? ' — ' + r.e : '')); } }
console.log(`\n${ok} checks OK, ${fail} falharam`);
process.exit(fail ? 1 : 0);
