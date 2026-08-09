// Testa alguns achados "baixo" da auditoria em SIME_admin.html:
// - "174 seções cadastradas" era texto fixo no dashboard, mesmo quando o
//   dado real do Supabase era outro (ex.: 94ª/96ª Zona tem outra contagem).
// - O botão "Problemas" abria nova aba sem nome fixo — cliques repetidos
//   empilhavam várias abas idênticas.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs() {
  return `
export function createClient(){
  let session=null;
  globalThis.__ops=[];
  // Só 2 seções — bem diferente do "174" que ficava hardcoded antes.
  let SECOES=[
    {id:'x1',zona_id:'z7',numero:63,municipio:'Campo Maior',local_nome:'G.E. Treze',eleitores:300,rota_id:null,ativo:true},
    {id:'x2',zona_id:'z7',numero:64,municipio:'Campo Maior',local_nome:'G.E. Treze',eleitores:280,rota_id:null,ativo:true},
  ];
  const USER={nome:'Rafa Coord',perfil:'coordenador',zona_id:'z7'};
  function tbl(t){
    const api={
      select(){ return api; }, eq(){ return api; }, order(){ return api; }, not(){ return api; }, limit(){ return api; }, in(){ return api; },
      maybeSingle(){
        if(t==='sime_usuarios') return Promise.resolve({data:USER,error:null});
        return Promise.resolve({data:null,error:null});
      },
      then(res){
        if(t==='sime_secoes') return res({data:SECOES.slice(),error:null});
        return res({data:[],error:null});
      },
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
await p.goto('http://localhost:8917/modules/SIME_admin.html');
await p.waitForTimeout(300);
await p.fill('#login-email', 'c@x.gov');
await p.fill('#login-pass', 'senha');
await p.click('#login-form button[type=submit]');
await p.waitForTimeout(500);

check('zero erros JS', erros.length === 0, erros.join('; '));

const cardTxt = await p.locator('#stat-cards').first().textContent();
check('mostra a contagem real (2), não "174" fixo', cardTxt.includes('2 seções cadastradas'), cardTxt);
check('não sobrou o "174" hardcoded de antes', !cardTxt.includes('174 seções'), cardTxt);

const target = await p.getAttribute('#tab-prob-btn', 'onclick');
check('botão "Problemas" abre com nome de aba fixo (não empilha abas)', /window\.open\('SIME_problemas\.html','[a-z_]+'\)/.test(target || ''), target);
check('não usa mais "_blank" genérico', !(target || '').includes("'_blank'"), target);

check('zero erros JS ao final', erros.length === 0, erros.join('; '));

await ctx.close();
await b.close();

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_admin_baixo_misc.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
