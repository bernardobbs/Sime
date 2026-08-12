// Testa o Modo Guerra em SIME_atores.html: o toast ao clicar "CONTATAR"
// reconstruía o nome com String.fromCharCode(a.nome.charCodeAt(0)), que só
// devolve a PRIMEIRA LETRA do nome (ex.: "Abrindo WhatsApp — G...") — bug de
// copy-paste, corrigido pra usar o nome inteiro (achado "médio" da
// auditoria). Também confere botão de editar/fechar com alvo de toque maior
// e aria-label.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB = `
const SECOES = [ { id:'sec-16', numero:16, local_nome:'Clube dos Cocais', municipio:'Campo Maior', zona_id:'z-7' } ];
const ATORES = [
  { id:'a1', nome_completo:"O'Brian de Souza", telefone_whatsapp:'5586981080059',
    funcao:'mesario', funcao_mesa:'1º Mesário', secao_id:'sec-16', confirmacao:'pendente', ativo:true },
];
const USUARIOS = [{ auth_user_id:'u1', zona_id:'z-7' }];
window.__logs = [];
class QB {
  constructor(t){ this.t=t; this.f={}; }
  select(){ return this; }
  eq(c,v){ this.f[c]=v; return this; }
  order(){ return this; } limit(){ return this; }
  insert(p){ if(this.t==='sime_logs') window.__logs.push(p); return Promise.resolve({ error:null, data:[{id:'log1'}] }); }
  _rows(){
    if(this.t==='sime_atores') return ATORES;
    if(this.t==='sime_secoes') return SECOES;
    if(this.t==='sime_usuarios') return USUARIOS.filter(u => this.f.auth_user_id===undefined || u.auth_user_id===this.f.auth_user_id);
    return [];
  }
  then(r){ return r({ data:this._rows(), error:null }); }
  maybeSingle(){ return Promise.resolve({ data:this._rows()[0] ?? null, error:null }); }
}
export function createClient(){
  return { from(t){ return new QB(t); }, auth:{
    async getSession(){ return { data:{ session:{ user:{ id:'u1' } } } }; },
    async getUser(){ return { data:{ user:{ id:'u1' } } }; },
    async signInWithPassword(){ return { error:null }; },
  },
  channel(){ return { on(){ return this; }, subscribe(){ return this; } }; },
  removeChannel(){},
  };
}
`;

const ctx = await b.newContext();
const p = await ctx.newPage();
const erros = [];
p.on('pageerror', (e) => erros.push(String(e)));
await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
});
await p.goto('http://localhost:8917/modules/SIME_atores.html');
await p.waitForTimeout(300);
await p.fill('#login-email', 'c@x.gov').catch(() => {});
await p.fill('#login-pass', 'senha').catch(() => {});
await p.click('#login-form button[type=submit]').catch(() => {});
await p.waitForTimeout(500);

check('zero erros JS', erros.length === 0, erros.join('; '));

await p.click('#tab-guerra-btn');
await p.waitForTimeout(300);

const contatarHref = await p.locator('.ac-btn:has-text("CONTATAR")').count();
check('botão CONTATAR aparece no Modo Guerra', contatarHref >= 1);

// intercepta window.open (target=_blank) pra não abrir aba nova de verdade
await p.evaluate(() => { window.open = () => null; });
await p.click('.ac-btn:has-text("CONTATAR")');
await p.waitForTimeout(150);
const toastTxt = await p.locator('#toast').textContent();
check('toast mostra o nome INTEIRO, não só a primeira letra', toastTxt.includes("O'Brian de Souza"), toastTxt);
check('toast não regrediu pro bug antigo (letra solta antes de "...")', !/— .\.\.\./.test(toastTxt) || toastTxt.includes("O'Brian de Souza"), toastTxt);

// aba Lista: botão editar e botão fechar do modal com alvo de toque ≥44px + aria-label
await p.click('#tab-lista-btn').catch(async () => { await p.click("div:has-text('👥 Lista')"); });
await p.waitForTimeout(300);
const editBtn = p.locator('button[aria-label="Editar"]').first();
check('botão editar tem aria-label', await editBtn.count() >= 1);
if (await editBtn.count()) {
  const box = await editBtn.evaluate(el => el.getBoundingClientRect());
  check('botão editar tem alvo de toque ≥44px', box.width >= 44 && box.height >= 44, JSON.stringify(box));
  await editBtn.click();
  await p.waitForTimeout(200);
  const closeBtn = p.locator('.close-btn[aria-label="Fechar"]').first();
  check('botão fechar do modal tem aria-label', await closeBtn.count() >= 1);
  const closeBox = await closeBtn.evaluate(el => el.getBoundingClientRect());
  check('botão fechar tem alvo de toque ≥44px', closeBox.width >= 44 && closeBox.height >= 44, JSON.stringify(closeBox));
}

check('zero erros JS ao final', erros.length === 0, erros.join('; '));

await ctx.close();
await b.close();

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_atores_guerra_toast.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
