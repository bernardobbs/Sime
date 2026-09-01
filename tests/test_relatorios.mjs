// Testa SIME_relatorios.html: login → 3 relatórios (seções, distribuição,
// pânicos) renderizam cards + tabela sem erro de JS, e a troca de aba funciona.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs() {
  return `
export function createClient(){
  let session=null;
  const EL=[{id:'el1',zona_id:'z7',turno:1,data_d:'2026-10-04',ativa:true}];
  const ZONA={numero:7,municipio:'Campo Maior',estado:'PI'};
  const SEC=[
    {id:'s1',numero:'0063',municipio:'<img src=x onerror="window.__xssMun=true">',local_nome:'G.E. Treze',eleitores:300,rota_id:'r1',ativo:true},
    {id:'s2',numero:'0064',municipio:'Campo Maior',local_nome:'G.E. Treze',eleitores:280,rota_id:'r1',ativo:true},
    {id:'s3',numero:'0079',municipio:'Sigefredo Pacheco',local_nome:'U.E. da Paz',eleitores:260,rota_id:'r2',ativo:true},
  ];
  const ROTAS=[
    {id:'r1',codigo:'001',nome:'Rota 001',municipios:['Campo Maior'],itinerario:'<img src=x onerror="window.__xssItin=true">',urnas_estimadas:4,ativo:true},
    {id:'r2',codigo:'002',nome:'Rota 002',municipios:['Sigefredo Pacheco'],itinerario:'Escola C',urnas_estimadas:6,ativo:true},
  ];
  const MESA=[
    {secao_id:'s1',encerrada:true,votacao:false,zeresima:true,fila:0,panico_energia:false,panico_urna:false},
    {secao_id:'s2',encerrada:false,votacao:true,zeresima:true,fila:12,panico_energia:false,panico_urna:false},
    {secao_id:'s3',encerrada:false,votacao:true,zeresima:true,fila:3,panico_energia:true,panico_urna:false},
  ];
  const ROTAEST=[{rota_id:'r1',status:'saiu',conferente_nome:'João',ts_saiu:'2026-10-04T06:00:00Z'}];
  const LOGS=[
    {acao:'panico_energia',modulo:'mesario',secao_id:'s3',payload:{obs:'<img src=x onerror="window.__xssPayload=true">'},ts:'2026-10-04T09:00:00Z'},
    {acao:'panico_energia_resolvido',modulo:'admin',secao_id:'s3',payload:null,ts:'2026-10-04T09:10:00Z'},
    {acao:'enc',modulo:'mesario',secao_id:'s1',payload:null,ts:'2026-10-04T17:00:00Z'},
  ];
  function qb(t){
    const o={
      select(){return o;}, eq(){return o;}, order(){return o;}, limit(){return o;},
      maybeSingle(){ if(t==='sime_zonas') return Promise.resolve({data:ZONA,error:null}); return Promise.resolve({data:null,error:null}); },
      then(res){
        if(t==='sime_eleicoes') return res({data:EL,error:null});
        if(t==='sime_secoes')   return res({data:SEC,error:null});
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

const ctx = await b.newContext();
const p = await ctx.newPage();
const erros = [];
p.on('pageerror', (e) => erros.push(String(e)));
await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs() });
});
await p.goto('http://localhost:8917/modules/SIME_relatorios.html');
await p.waitForTimeout(300);

// login
await p.fill('#login-email', 'x@sime.gov.br');
await p.fill('#login-pass', 'senha');
await p.click('#login-form button[type=submit]');
await p.waitForTimeout(400);

check('zero erros JS', erros.length === 0, erros.join('; '));
check('login some após entrar', await p.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display === 'none'));
check('zona no cabeçalho', (await p.locator('#zona-info').textContent()).includes('7ª Zona'));

// ── Relatório 1: seções ──
const cards1 = await p.locator('#cards .stat').count();
check('seções: 5 cards de estatística', cards1 === 5, 'n=' + cards1);
const rows1 = await p.locator('#conteudo table tbody tr').count();
check('seções: 3 linhas', rows1 === 3, 'n=' + rows1);
const encTxt = await p.locator('#conteudo table tbody').textContent();
check('seções: mostra Encerrada e Pânico', /Encerrada/.test(encTxt) && /Pânico/.test(encTxt), encTxt.replace(/\s+/g,' ').slice(0,120));

// ── Segurança: município com HTML malicioso não vira <img> de verdade ──
check('seções: XSS no município NÃO executa (onerror não disparou)', await p.evaluate(() => window.__xssMun !== true));
check('seções: nenhum <img> injetado na tabela', await p.evaluate(() => document.querySelectorAll('#conteudo img').length === 0));
check('seções: o texto malicioso aparece escapado, visível como texto', encTxt.includes('<img'));

// ── Relatório 2: distribuição ──
await p.click('.tab[data-rel=distribuicao]');
await p.waitForTimeout(300);
const rows2 = await p.locator('#conteudo table tbody tr').count();
check('distribuição: 2 rotas', rows2 === 2, 'n=' + rows2);
const dist = await p.locator('#conteudo table tbody').textContent();
check('distribuição: status Saiu', /Saiu/.test(dist));
check('distribuição: XSS no itinerário NÃO executa', await p.evaluate(() => window.__xssItin !== true));
check('distribuição: nenhum <img> injetado na tabela', await p.evaluate(() => document.querySelectorAll('#conteudo img').length === 0));

// ── Relatório 3: pânicos ──
await p.click('.tab[data-rel=panicos]');
await p.waitForTimeout(300);
const rows3 = await p.locator('#conteudo table tbody tr').count();
check('pânicos: 2 eventos (energia + resolução)', rows3 === 2, 'n=' + rows3);
const pan = await p.locator('#conteudo table tbody').textContent();
check('pânicos: seção 0063/0079 mapeada', /0079/.test(pan), pan.replace(/\s+/g,' ').slice(0,120));
check('pânicos: XSS no payload do log NÃO executa', await p.evaluate(() => window.__xssPayload !== true));
check('pânicos: nenhum <img> injetado na tabela', await p.evaluate(() => document.querySelectorAll('#conteudo img').length === 0));

// ── Modo offline mínimo: cada relatório visto vira cópia local ──
const cacheAposUso = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_relatorios_cache_v1') || '{}'));
check('cache: guardou os 3 relatórios já vistos', Object.keys(cacheAposUso).sort().join(',') === 'distribuicao,panicos,secoes', JSON.stringify(Object.keys(cacheAposUso)));
check('cache: relatório de pânicos guardou o HTML renderizado', /0079/.test(cacheAposUso.panicos?.conteudoHtml || ''));

// recarrega a página SEM logar (sessão em memória do stub reseta) — login
// deve continuar bloqueando dados ao vivo, mas oferecer a cópia salva.
await p.reload();
await p.waitForTimeout(300);
check('offline: login volta a aparecer (sem sessão)', await p.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display !== 'none'));
check('offline: botão "ver salvo" aparece por existir cache', await p.evaluate(() => getComputedStyle(document.getElementById('btn-ver-offline')).display !== 'none'));

await p.click('#btn-ver-offline');
await p.waitForTimeout(150);
check('offline: login some ao ver cópia salva', await p.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display === 'none'));
check('offline: banner de offline aparece', await p.evaluate(() => document.getElementById('offline-banner').classList.contains('show')));
const bannerTxt = await p.locator('#offline-banner-txt').textContent();
check('offline: banner menciona "Offline"', /Offline/.test(bannerTxt), bannerTxt);
const rowsOffline = await p.locator('#conteudo table tbody tr').count();
check('offline: tabela da 1ª aba (seções) veio da cópia salva', rowsOffline === 3, 'n=' + rowsOffline);

await p.click('.tab[data-rel=panicos]');
await p.waitForTimeout(150);
const panOffline = await p.locator('#conteudo table tbody').textContent();
check('offline: trocar de aba lê a cópia salva daquela aba, sem tentar rede', /0079/.test(panOffline), panOffline.replace(/\s+/g, ' ').slice(0, 120));

await p.click('#offline-banner button');
await p.waitForTimeout(150);
check('offline: "Entrar para atualizar" reabre o login', await p.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display !== 'none'));
check('offline: banner some ao voltar pro login', await p.evaluate(() => !document.getElementById('offline-banner').classList.contains('show')));

await ctx.close();
await b.close();

let ok = 0, fail = 0;
for (const r of results) { if (r.ok) { ok++; } else { fail++; console.log('  ✗ ' + r.n + (r.e ? ' — ' + r.e : '')); } }
console.log(`\n${ok} checks OK, ${fail} falharam`);
process.exit(fail ? 1 : 0);
