// Testa os achados "médio" de SIME_relatorios.html: exportar CSV não dava
// nenhum retorno visual (nem sucesso nem "nada pra exportar"), erro de
// carregamento mostrava a mensagem crua do Postgres/Supabase, as abas não
// eram navegáveis por teclado, e o badge "Pendente" (.pill.wait) tinha
// contraste baixo (var(--text3) sobre var(--bg2)).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs({ quebrarSecoes = false } = {}) {
  return `
export function createClient(){
  let session=null;
  const EL=[{id:'el1',zona_id:'z7',turno:1,data_d:'2026-10-04',ativa:true}];
  const ZONA={numero:7,nome:'Campo Maior',estado:'PI'};
  const SEC=[{id:'s1',numero:'0063',municipio:'Campo Maior',local_nome:'G.E. Treze',eleitores:300,rota_id:'r1',ativo:true}];
  const ROTAS=[{id:'r1',codigo:'001',nome:'Rota 001',municipios:['Campo Maior'],itinerario:'Escola',urnas_estimadas:4,ativo:true}];
  const MESA=[{secao_id:'s1',encerrada:false,votacao:false,zeresima:false,fila:0,panico_energia:false,panico_urna:false}];
  const ROTAEST=[];
  const LOGS=[];
  function qb(t){
    const o={
      select(){return o;}, eq(){return o;}, order(){return o;}, limit(){return o;},
      maybeSingle(){ if(t==='sime_zonas') return Promise.resolve({data:ZONA,error:null}); return Promise.resolve({data:null,error:null}); },
      then(res){
        if(t==='sime_eleicoes') return res({data:EL,error:null});
        if(t==='sime_secoes'){
          ${quebrarSecoes ? "return res({data:null,error:{message:'permission denied for table sime_secoes'}});" : "return res({data:SEC,error:null});"}
        }
        if(t==='sime_rotas')    return res({data:ROTAS,error:null});
        if(t==='sime_mesa_estado') return res({data:MESA,error:null});
        if(t==='sime_rotas_estado') return res({data:ROTAEST,error:null});
        if(t==='sime_logs')     return res({data:LOGS,error:null});
        return res({data:[],error:null});
      },
    };
    return o;
  }
  return {
    auth:{
      getSession:async()=>({data:{session}}),
      getUser:async()=>({data:{user:session?{id:'a1'}:null}}),
      signInWithPassword:async({email})=>{ session={user:{email}}; return {data:{session},error:null}; },
      signOut:async()=>({error:null}),
    },
    from:(t)=>qb(t),
  };
}
`;
}

async function login(p) {
  await p.fill('#login-email', 'x@sime.gov.br');
  await p.fill('#login-pass', 'senha');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(400);
}

// ── 1. CSV exportado / nada a exportar / abas por teclado / contraste do pill ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs() });
  });
  await p.goto('http://localhost:8917/modules/SIME_relatorios.html');
  await p.waitForTimeout(300);
  await login(p);
  check('zero erros JS', erros.length === 0, erros.join('; '));

  // downloads não navegam a página — só confere que o clique dispara o evento e o toast aparece
  const downloadPromise = p.waitForEvent('download').catch(() => null);
  await p.click('button:has-text("⬇️ CSV")');
  await downloadPromise;
  await p.waitForTimeout(150);
  const toastTxt = await p.locator('#toast').textContent();
  check('toast confirma exportação do CSV', toastTxt.includes('CSV exportado'), toastTxt);

  // abas: role=tab, tabindex, aria-selected muda ao trocar, navegável por Enter
  const tabs = p.locator('[role="tab"]');
  check('3 abas com role=tab', await tabs.count() === 3);
  check('aba inicial com aria-selected=true', await p.locator('[role="tab"][aria-selected="true"]').count() === 1);
  const abaDistribuicao = p.locator('[role="tab"][data-rel="distribuicao"]');
  await abaDistribuicao.focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  check('Enter no teclado troca de aba', await abaDistribuicao.getAttribute('aria-selected') === 'true');
  check('aba antiga perde aria-selected', await p.locator('[role="tab"][data-rel="secoes"]').getAttribute('aria-selected') === 'false');

  // volta pra seções e confere contraste do pill "Pendente"
  await p.click('[role="tab"][data-rel="secoes"]');
  await p.waitForTimeout(300);
  const corPill = await p.locator('.pill.wait').first().evaluate(el => getComputedStyle(el).color);
  check('badge "Pendente" usa var(--text2), não mais var(--text3) de baixo contraste', corPill === 'rgb(106, 101, 96)', corPill);

  // "nada pra exportar": aba de pânicos sem nenhum log no mock — dadosAtuais.linhas fica vazio
  await p.click('[role="tab"][data-rel="panicos"]');
  await p.waitForTimeout(300);
  await p.click('button:has-text("⬇️ CSV")');
  await p.waitForTimeout(150);
  const toastVazio = await p.locator('#toast').textContent();
  check('toast avisa quando não há nada pra exportar', toastVazio.includes('Nada para exportar'), toastVazio);

  check('zero erros JS ao final', erros.length === 0, erros.join('; '));
  await ctx.close();
}

// ── 2. Erro de carregamento mostra mensagem amigável, não o erro cru do Postgres ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({ quebrarSecoes: true }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_relatorios.html');
  await p.waitForTimeout(300);
  await login(p);
  await p.waitForTimeout(300);

  const conteudoTxt = await p.locator('#conteudo').textContent();
  check('não expõe "permission denied" cru na tela', !conteudoTxt.includes('permission denied'), conteudoTxt);
  check('mostra mensagem amigável de permissão', conteudoTxt.includes('Sem permissão'), conteudoTxt);
  check('zero erros JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

await b.close();

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_relatorios_toast_abas.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
