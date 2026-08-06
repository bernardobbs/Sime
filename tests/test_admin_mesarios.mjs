// Testa o painel "Confirmação de mesários" em SIME_admin.html: um coordenador
// (config_equipe) abre o gerenciador, vê a lista de mesários com o resumo por
// status, filtra, e marca um mesário como confirmado — o update ({confirmacao,
// ativo}) é enviado ao supabase stubado. Verifica também o resumo de contagem.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs() {
  return `
export function createClient(){
  let session=null;
  globalThis.__ops=[];
  let ATORES=[
    {id:'m1',nome_completo:'ANA SOUSA',telefone_whatsapp:'558600000001',observacao:'Função: Presidente | Seção votação: 63 | Local: G.E. Treze',confirmacao:'pendente',ativo:true},
    {id:'m2',nome_completo:'BRUNO LIMA',telefone_whatsapp:'558600000002',observacao:'Função: 1º Mesário | Seção votação: 64 | Local: G.E. Treze',confirmacao:'confirmado',ativo:true},
    {id:'m3',nome_completo:'CARLA ROCHA',telefone_whatsapp:'sem_contato',observacao:'Função: 2º Mesário | Seção votação: 65 | Local: E.M. Nova',confirmacao:'recusou',ativo:false},
  ];
  const USER={nome:'Rafa Coord',perfil:'coordenador',zona_id:'z7'};
  function tbl(t){
    let pending=null;
    const api={
      select(){ return api; }, order(){ return api; }, not(){ return api; }, limit(){ return api; }, in(){ return api; },
      maybeSingle(){
        if(t==='sime_usuarios') return Promise.resolve({data:USER,error:null});
        return Promise.resolve({data:null,error:null});
      },
      insert(p){ globalThis.__ops.push({op:'insert',t,p}); return Promise.resolve({error:null}); },
      update(p){ pending={op:'update',p}; return api; },
      delete(){ pending={op:'delete'}; return api; },
      then(res){
        if(t==='sime_atores') return res({data:ATORES.slice(),error:null});
        return res({data:[],error:null});
      },
    };
    api.eq=(col,val)=>{
      if(pending&&pending.op==='update'){
        globalThis.__ops.push({op:'update',t,val,p:pending.p});
        const i=ATORES.findIndex(a=>a.id===val); if(i>-1) ATORES[i]={...ATORES[i],...pending.p};
        pending=null; return Promise.resolve({error:null});
      }
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
  await route.fulfill({ status: 200, contentType: 'application/javascript', body: `
    let _sb=null;
    export function initSimeDados(sb){ _sb=sb; }
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

// abre a aba Seções (onde vive o botão) e o gerenciador de mesários
await p.click('button.nav-tab[onclick*="secoes"]');
await p.waitForTimeout(150);
await p.click('button[onclick="openMesariosManager()"]');
await p.waitForTimeout(300);
const titulo = await p.locator('.modal-title').textContent();
check('gerenciador abre com contagem', /Confirmação de mesários \(3\)/.test(titulo), titulo);
const linhas = await p.locator('.modal-body table tbody tr').count();
check('lista 3 mesários', linhas === 3, 'n=' + linhas);
const resumo = await p.locator('.modal-hdr').textContent();
check('resumo por status', /1 pendente/.test(resumo) && /1 confirmado/.test(resumo) && /1 recusou/.test(resumo), resumo);

// filtra por "pendente"
await p.selectOption('#mes-status', 'pendente');
await p.waitForTimeout(150);
const linhasF = await p.locator('.modal-body table tbody tr').count();
check('filtro pendente mostra 1', linhasF === 1, 'n=' + linhasF);

// marca esse pendente como confirmado
await p.click('.modal-body table tbody tr:first-child button[onclick*="confirmado"]');
await p.waitForTimeout(300);
const ops = await p.evaluate(() => globalThis.__ops.filter(o => o.op === 'update' && o.t === 'sime_atores'));
check('update confirmado enviado', ops.length === 1 && ops[0].p.confirmacao === 'confirmado' && ops[0].p.ativo === true && ops[0].val === 'm1', JSON.stringify(ops));

// busca por seção
await p.selectOption('#mes-status', '');
await p.waitForTimeout(100);
await p.fill('#mes-busca', '0065');
await p.waitForTimeout(200);
const linhasB = await p.locator('.modal-body table tbody tr').count();
check('busca por seção 0065 mostra 1', linhasB === 1, 'n=' + linhasB);

// marca recusa (deve mandar ativo=false)
await p.click('.modal-body table tbody tr:first-child button[onclick*="recusou"]');
await p.waitForTimeout(300);
const opsR = await p.evaluate(() => globalThis.__ops.filter(o => o.op === 'update' && o.t === 'sime_atores' && o.val === 'm3'));
check('recusa manda ativo=false', opsR.length === 1 && opsR[0].p.confirmacao === 'recusou' && opsR[0].p.ativo === false, JSON.stringify(opsR));

await ctx.close();
await b.close();

let ok = 0, fail = 0;
for (const r of results) { if (r.ok) { ok++; } else { fail++; console.log('  ✗ ' + r.n + (r.e ? ' — ' + r.e : '')); } }
console.log(`\n${ok} checks OK, ${fail} falharam`);
process.exit(fail ? 1 : 0);
