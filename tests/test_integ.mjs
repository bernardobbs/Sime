import pw from 'playwright';
const { chromium } = pw;
const DIR = new URL('../modules/', import.meta.url).href;
const results = []; const check = (n,c,e='') => results.push({n, ok:!!c, e});

const browser = await chromium.launch();
const ctx = await browser.newContext({viewport:{width:1200,height:900}});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

// ═══════ FLUXO 1: MESÁRIO → ADMIN → TV DIA (sime_mesa_v1, seção 0063) ═══════
await page.goto(DIR+'SIME_mesario.html');
await page.evaluate(()=>['sime_mesa_v1','sime_acess_v1','sime_tokens_v1'].forEach(k=>localStorage.removeItem(k)));
await page.reload(); await page.waitForTimeout(200);

// dirige os handlers reais do mesário (.click() no DOM evita interceptação de layout do teste)
const clk = (sel)=>page.evaluate(s=>document.querySelector(s).click(), sel);
await clk('#mb-pres');                                 // presidente chegou
await clk('#btn-zero');                                // zerésima
await clk('#btn-vot');                                 // abre modal votação
await page.waitForTimeout(120);
await clk('#sh-ok');                                   // confirma votação
await page.waitForTimeout(120);
await clk('#fila-inline .fbtn.plus.big');              // fila +5  (usa adjFilaDirect)
await clk('#btn-energia');                             // pânico energia
await page.waitForTimeout(200);

const mesa = await page.evaluate(()=>JSON.parse(localStorage.getItem('sime_mesa_v1')||'{}')['0063']||{});
check('mesário gravou presidente', mesa.mesa?.pres === 1, JSON.stringify(mesa.mesa));
check('mesário gravou zerésima', mesa.zero === true);
check('mesário gravou votação', mesa.vot === true);
check('mesário gravou fila=5', mesa.fila === 5, 'fila='+mesa.fila);
check('mesário gravou pânico energia', mesa.panico?.energia === true);

// ADMIN lê a mesma chave
await page.goto(DIR+'SIME_admin.html'); await page.waitForTimeout(300);
check('admin: badge de problemas ≥1 (pânico da 63)', /[1-9]/.test(await page.textContent('#prob-count-badge')), 'badge='+await page.textContent('#prob-count-badge'));
const adminRow = await page.evaluate(()=>{
  const st=JSON.parse(localStorage.getItem('sime_mesa_v1'))['0063'];
  // localiza a linha da seção 63 na tabela renderizada
  const row=[...document.querySelectorAll('#sec-tbody tr')].find(r=>r.querySelector('td')?.textContent==='63');
  return {temRow:!!row, texto: row?row.textContent:'', filaLida:st.fila};
});
check('admin: seção 63 na tabela', adminRow.temRow);
check('admin: tabela mostra fila 5 na seção 63', adminRow.texto.includes('5'), adminRow.texto.replace(/\s+/g,' ').slice(0,80));

// TV DIA lê a mesma chave
await page.goto(DIR+'SIME_tv_dia.html'); await page.waitForTimeout(300);
const tv = await page.evaluate(()=>{ buildPages(); const s=getSt('0063',loadMesa()); return {vot:s.vot,fila:s.fila,energia:s.panico.energia}; });
check('tv_dia: seção 63 votando', tv.vot === true);
check('tv_dia: seção 63 fila=5', tv.fila === 5, 'fila='+tv.fila);
check('tv_dia: seção 63 pânico energia', tv.energia === true);

// ═══════ FLUXO 2: CONFERENTE → TV DISTRIBUIÇÃO (sime_dist_v1) ═══════
await page.goto(DIR+'SIME_conferente.html');
await page.evaluate(()=>['sime_tokens_v1','sime_dist_v1'].forEach(k=>localStorage.removeItem(k)));
await page.reload(); await page.waitForTimeout(300);
// grava via a função real que os botões do conferente chamam
await page.evaluate(()=>{ updateRotaState('Rota 001',{status:'saiu', ts_saiu:Date.now(), urnas:5}); });
const dist = await page.evaluate(()=>JSON.parse(localStorage.getItem('sime_dist_v1')||'{}').rotas?.['Rota 001']||{});
check('conferente gravou Rota 001 status=saiu', dist.status === 'saiu', JSON.stringify(dist));

await page.goto(DIR+'SIME_tv_distribuicao.html'); await page.waitForTimeout(300);
const tvd = await page.evaluate(()=>{
  const d=JSON.parse(localStorage.getItem('sime_dist_v1')||'{}');
  return { statusLido:d.rotas?.['Rota 001']?.status, cards: document.querySelectorAll('.rc-status, [class*=rota], .rota-card, .rc').length };
});
check('tv_distribuição lê Rota 001 = saiu (mesma chave)', tvd.statusLido === 'saiu');
check('tv_distribuição renderizou o grid de rotas', tvd.cards > 0, 'cards='+tvd.cards);

await browser.close();
let pass=0,fail=0;
for(const r of results){ console.log((r.ok?'PASS':'FAIL')+' — '+r.n+(r.e?'  ['+r.e+']':'')); r.ok?pass++:fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
if(errors.length){ console.log('\n⚠ PAGE ERRORS (bugs de runtime):'); [...new Set(errors)].forEach(e=>console.log('  '+e)); }
process.exit(fail?1:0);
