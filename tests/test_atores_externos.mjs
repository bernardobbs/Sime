// Testa a aba "Contatos externos" do SIME_atores.html — onde a Equatorial é
// cadastrada.
//
// Eles ficam nesta tela porque é onde a equipe procura telefone, mas em tabela
// própria (sime_contatos_externos): são organizações com abrangência por
// MUNICÍPIO, e em sime_atores entrariam contando como "ator" nos números da
// zona e nas campanhas de confirmação de mesário.
//
// O que precisa estar certo:
//   - a zona vem do usuário logado, nunca de um campo na tela (contato na zona
//     errada = telefone de outra comarca no dia D);
//   - município vazio significa "vale para a zona inteira", não string vazia;
//   - 0800 e telefone fixo passam — é o número que a concessionária publica;
//   - sem sessão, a aba explica em vez de oferecer um formulário que falharia.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
class QB {
  constructor(t){ this.t=t; this.f={}; }
  select(){ return this; }
  eq(c,v){ this.f[c]=v; return this; }
  order(){ return this; }
  insert(p){ window.__mock.escritas.push({ op:'insert', tabela:this.t, payload:p }); return Promise.resolve({ error:null }); }
  update(p){ const self=this; return { eq(c,v){ window.__mock.escritas.push({ op:'update', tabela:self.t, payload:p, id:v }); return Promise.resolve({ error:null }); } }; }
  maybeSingle(){ const r=(window.__mock[this.t]||[]).filter(x=>Object.entries(this.f).every(([k,v])=>x[k]===v)); return Promise.resolve({ data:r[0]??null, error:null }); }
  then(res){ const r=(window.__mock[this.t]||[]).filter(x=>Object.entries(this.f).every(([k,v])=>x[k]===v)); return res({ data:r, error:null }); }
}
export function createClient(){
  return {
    from(t){ return new QB(t); },
    channel(){ const c={ on(){return c;}, subscribe(){return c;} }; return c; },
    removeChannel(){},
    rpc(){ return Promise.resolve({ data:null, error:null }); },
    auth: {
      async getSession(){ return { data:{ session: window.__mock.semSessao ? null : { user:{ id:'auth-maria' } } } }; },
      async getUser(){ return { data:{ user:{ id:'auth-maria' } } }; },
    },
  };
}
`;

function mock({ contatos = [], semSessao = false } = {}) {
  return {
    escritas: [], semSessao,
    sime_usuarios: [{ id:'u-maria', nome:'Maria', perfil:'coordenador', zona_id:'z7', ativo:true, auth_user_id:'auth-maria' }],
    sime_secoes: [{ id:'s63', numero:63, local_nome:'G.E. Treze de Março', municipio:'Campo Maior' }],
    sime_atores: [],
    sime_contatos_externos: contatos,
  };
}

async function abrir(ctx, m) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((x) => { window.__mock = x; }, m);
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status:200, contentType:'application/javascript', body: STUB_SUPABASE_JS }));
  await p.goto('http://localhost:8917/modules/SIME_atores.html');
  await p.waitForTimeout(600);
  await p.click('#tab-externos-btn');
  await p.waitForTimeout(300);
  return { p, erros };
}

// ── 1. Aba vazia avisa a consequência, não só "nada aqui" ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  const txt = await p.textContent('#content');
  check('aba existe e abre', txt.includes('Contatos externos'));
  check('vazio explica o efeito no painel de problemas',
    txt.includes('o botão de energia não aparece'), txt.slice(0, 200));
  check('oferece cadastrar', await p.locator('button:has-text("Novo contato")').count() === 1);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Cadastro grava com a zona do usuário logado ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await p.click('button:has-text("Novo contato")');
  await p.waitForTimeout(200);

  await p.selectOption('#x-tipo', 'energia');
  await p.fill('#x-nome', 'Equatorial — plantão Campo Maior');
  await p.fill('#x-mun', 'Campo Maior');
  await p.fill('#x-tel', '(86) 99999-8888');
  await p.click('button:has-text("Salvar")');
  await p.waitForTimeout(300);

  const esc = await p.evaluate(() => window.__mock.escritas);
  check('grava em sime_contatos_externos', esc[0]?.tabela === 'sime_contatos_externos', JSON.stringify(esc));
  check('zona vem do usuário logado, não da tela', esc[0]?.payload?.zona_id === 'z7', JSON.stringify(esc[0]?.payload));
  check('telefone é normalizado (só dígitos)', esc[0]?.payload?.telefone === '86999998888');
  check('tipo energia', esc[0]?.payload?.tipo === 'energia');
  check('município preservado', esc[0]?.payload?.municipio === 'Campo Maior');
  check('whatsapp ligado por padrão', esc[0]?.payload?.whatsapp === true);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. Município vazio vira NULL (vale pra zona toda), não string vazia ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await p.click('button:has-text("Novo contato")');
  await p.waitForTimeout(200);
  await p.fill('#x-nome', 'Equatorial — geral');
  await p.fill('#x-tel', '0800111222');
  await p.click('button:has-text("Salvar")');
  await p.waitForTimeout(300);

  const pay = (await p.evaluate(() => window.__mock.escritas))[0]?.payload;
  check('município em branco vira NULL', pay?.municipio === null, JSON.stringify(pay));
  check('0800 é aceito (é o número que a concessionária publica)', pay?.telefone === '0800111222');
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 4. "Só telefone" grava whatsapp=false ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await p.click('button:has-text("Novo contato")');
  await p.waitForTimeout(200);
  await p.fill('#x-nome', 'Equatorial — fixo');
  await p.fill('#x-tel', '8632221111');
  await p.uncheck('#x-wa');
  await p.click('button:has-text("Salvar")');
  await p.waitForTimeout(300);
  const pay = (await p.evaluate(() => window.__mock.escritas))[0]?.payload;
  check('desmarcar WhatsApp grava whatsapp=false', pay?.whatsapp === false, JSON.stringify(pay));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5. Validação: nome e telefone ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await p.click('button:has-text("Novo contato")');
  await p.waitForTimeout(200);

  await p.fill('#x-tel', '86999998888');
  await p.click('button:has-text("Salvar")');
  await p.waitForTimeout(200);
  check('sem nome não grava', (await p.evaluate(() => window.__mock.escritas)).length === 0);
  check('e avisa', (await p.textContent('#toast')).includes('nome'));

  await p.fill('#x-nome', 'Equatorial');
  await p.fill('#x-tel', '123');
  await p.click('button:has-text("Salvar")');
  await p.waitForTimeout(200);
  check('telefone curto demais não grava', (await p.evaluate(() => window.__mock.escritas)).length === 0);
  check('e avisa', (await p.textContent('#toast')).includes('Telefone'));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 6. Lista mostra o cadastrado, com abrangência legível ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock({ contatos: [
    { id:'c1', tipo:'energia', nome:'Equatorial — Campo Maior', municipio:'Campo Maior', telefone:'8632221111', whatsapp:true, ativo:true },
    { id:'c2', tipo:'energia', nome:'Equatorial — geral', municipio:null, telefone:'0800111222', whatsapp:false, ativo:true },
  ]}));
  const txt = await p.textContent('#content');
  check('lista o contato do município', txt.includes('Equatorial — Campo Maior'), txt.slice(0, 300));
  check('contato sem município aparece como "toda a zona"', txt.includes('toda a zona'), txt.slice(0, 400));
  check('marca o que é só telefone', txt.includes('só telefone'));
  check('não mostra mais o aviso de vazio', !txt.includes('não aparece no painel'));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 7. Editar carrega os valores e grava update, não insert ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock({ contatos: [
    { id:'c1', tipo:'energia', nome:'Equatorial — Campo Maior', municipio:'Campo Maior', telefone:'8632221111', whatsapp:true, ativo:true },
  ]}));
  await p.click('button:has-text("Editar")');
  await p.waitForTimeout(200);
  check('editar traz o nome', (await p.inputValue('#x-nome')) === 'Equatorial — Campo Maior');
  check('editar traz o município', (await p.inputValue('#x-mun')) === 'Campo Maior');

  await p.fill('#x-tel', '8633334444');
  await p.click('button:has-text("Salvar")');
  await p.waitForTimeout(300);
  const esc = (await p.evaluate(() => window.__mock.escritas))[0];
  check('editar usa update, não insert', esc?.op === 'update', JSON.stringify(esc));
  check('update aponta pro id certo', esc?.id === 'c1');
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 8. Sem sessão: explica, em vez de oferecer formulário que falharia ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock({ semSessao: true }));
  const txt = await p.textContent('#content');
  check('sem sessão: pede login', txt.includes('Entre com a conta da equipe'), txt.slice(0, 200));
  check('sem sessão: não oferece o botão de novo contato',
    await p.locator('button:has-text("Novo contato")').count() === 0);
  check('sem sessão: as outras abas seguem funcionando',
    await p.locator('#tab-lista-btn').count() === 1);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 9. A aba não quebrou o resto do módulo ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await p.click('#tab-lista-btn');
  await p.waitForTimeout(250);
  check('volta pra Lista sem erro', (await p.textContent('#content')).length > 0);
  await p.click('#tab-import-btn');
  await p.waitForTimeout(250);
  check('Importar CSV continua abrindo', (await p.textContent('#content')).includes('csv'.toUpperCase()) || (await p.textContent('#content')).includes('CSV'));
  check('sem erro JS ao circular pelas abas', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
