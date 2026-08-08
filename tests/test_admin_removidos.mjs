// Testa "👤 Removidos" em SIME_admin.html: antes, "remover membro" desativava
// o login (ativo=false) sem nenhum jeito de desfazer pela UI — a única volta
// era mexer direto no banco (achado "médio" da auditoria). Agora a aba Equipe
// tem um botão que lista quem foi removido e permite reativar.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs() {
  return `
export function createClient(){
  let session=null;
  globalThis.__ops=[];
  let USUARIOS=[
    {id:'u1',auth_user_id:'a1',nome:'Rafael A.',email:'c@x.gov',perfil:'coordenador',empresa_id:null,local_id:null,ativo:true,telefone_whatsapp:null},
    {id:'u2',auth_user_id:'a2',nome:'Beatriz M.',email:'b@x.gov',perfil:'monitor',empresa_id:null,local_id:null,ativo:false,telefone_whatsapp:null},
  ];
  function tbl(t){
    let pending=null;
    const filters={};
    const api={
      select(){ return api; },
      eq(col,val){ filters[col]=val; return api; },
      order(){ return api; }, not(){ return api; }, limit(){ return api; }, in(){ return api; },
      maybeSingle(){
        if(t==='sime_usuarios'){
          const rows=USUARIOS.filter(u=>Object.entries(filters).every(([k,v])=>u[k]===v));
          return Promise.resolve({data:rows[0]||null,error:null});
        }
        return Promise.resolve({data:null,error:null});
      },
      update(p){ pending={op:'update',p}; return api; },
      then(res){
        if(t==='sime_usuarios'){
          const rows=USUARIOS.filter(u=>Object.entries(filters).every(([k,v])=>u[k]===v));
          if(pending&&pending.op==='update'){
            globalThis.__ops.push({op:'update',t,filters:{...filters},p:pending.p});
            rows.forEach(u=>Object.assign(u,pending.p));
            pending=null;
            return res({error:null});
          }
          return res({data:rows,error:null});
        }
        if(t==='sime_secoes'||t==='sime_atores'||t==='sime_rotas'||t==='sime_empresas') return res({data:[],error:null});
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

// aba Equipe já vem ativa por padrão — abre a lista de removidos
await p.click("button.nav-tab:has-text('Equipe')");
await p.waitForTimeout(150);
check('botão "Removidos" existe', await p.locator('button:has-text("👤 Removidos")').count() === 1);
await p.click('button:has-text("👤 Removidos")');
await p.waitForTimeout(300);

const listaTxt = await p.locator('#removidos-lista').textContent();
check('lista mostra a pessoa desativada', listaTxt.includes('Beatriz M.'), listaTxt);
check('não mostra quem está ativo', !listaTxt.includes('Rafael A.'), listaTxt);

await p.click('button:has-text("↩ Reativar")');
await p.waitForTimeout(300);

const opsUpdate = await p.evaluate(() => globalThis.__ops.filter(o => o.op === 'update' && o.t === 'sime_usuarios'));
check('reativar manda ativo=true pro id certo', opsUpdate.some(o => o.filters.id === 'u2' && o.p.ativo === true), JSON.stringify(opsUpdate));
check('fecha o modal ao reativar', !(await p.locator('#overlay.open').count()));

const equipeTxt = await p.locator('#team-list, #equipe-list, .card').first().textContent().catch(() => '');
const teamReapareceu = await p.evaluate(() => (window.EQUIPE_REAL || []).some(u => u.id === 'u2'));
check('reaparece em EQUIPE_REAL depois de reativar', teamReapareceu);

check('zero erros JS ao final', erros.length === 0, erros.join('; '));

await ctx.close();
await b.close();

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_admin_removidos.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
