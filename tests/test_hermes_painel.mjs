// Testa SIME_hermes_painel.html (achados da revisão de 19/08/2026 — Fix 1 e
// Fix 3): o painel exigia colar HERMES_SECRET_ZONA_<n> (mesmo segredo que
// autoriza toda escrita privilegiada do Hermes) em localStorage via
// prompt(), e getStatusCounts() olhava chaves erradas primeiro (status_counts/
// statuses/counts) quando a API real devolve `contagem` — os cards de status
// sempre ficavam em 0. Reescrito: login por sessão (mesmo padrão de
// SIME_relatorios.html) + leitura direta via RLS (sime_hermes_api.js), sem
// nenhum token pra colar.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs() {
  return `
export function createClient(){
  let session=null;
  const USUARIOS=[{ id:'u-maria', zona_id:'z7', auth_user_id:'auth-maria', sime_zonas:{numero:7} }];
  const CONF=[
    { id:'c1', ator_id:'a1', zona_id:'z7', telefone_whatsapp:'558611110001', status:'pendente', tentativas:0, created_at:'2026-10-04T09:00:00.000Z' },
    { id:'c2', ator_id:'a2', zona_id:'z7', telefone_whatsapp:'558611110002', status:'confirmado', tentativas:1, created_at:'2026-10-04T09:05:00.000Z' },
    { id:'c3', ator_id:'a3', zona_id:'z7', telefone_whatsapp:'558611110003', status:'finalizado', tentativas:1, created_at:'2026-10-04T09:10:00.000Z' },
    { id:'c4', ator_id:'a4', zona_id:'z7', telefone_whatsapp:'558611110004', status:'erro', tentativas:2, created_at:'2026-10-04T09:15:00.000Z' },
  ];
  const LOGS=[{ ts:'2026-10-04T09:20:00.000Z', modulo:'hermes_campanhas', payload:{ zona:'7' } }];

  function qb(t){
    const f={};
    const o={
      select(){ return o; },
      eq(c,v){ f[c]=v; return o; },
      filter(){ return o; },
      order(){ return o; },
      limit(){ return o; },
      maybeSingle(){
        if(t==='sime_usuarios'){
          const r=USUARIOS.find(u=>u.auth_user_id===f.auth_user_id);
          return Promise.resolve({ data: r||null, error:null });
        }
        return Promise.resolve({ data:null, error:null });
      },
      then(res){
        if(t==='sime_campanhas_confirmacao') return res({ data: CONF.filter(c=>c.zona_id===f.zona_id), error:null });
        if(t==='sime_logs') return res({ data: LOGS, error:null });
        return res({ data:[], error:null });
      },
    };
    return o;
  }
  return {
    auth:{
      getSession: async()=>({ data:{ session } }),
      getUser: async()=>({ data:{ user: session ? { id:'auth-maria' } : null } }),
      signInWithPassword: async({ email, password })=>{
        if(password==='errada') return { data:{session:null}, error:{ message:'Invalid login credentials' } };
        session={ user:{ id:'auth-maria', email } };
        return { data:{ session }, error:null };
      },
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
await p.goto('http://localhost:8917/modules/SIME_hermes_painel.html');
await p.waitForTimeout(300);

// ── Sem sessão: login bloqueia, painel escondido, sem prompt/token nenhum ──
check('sem sessão: login-overlay visível', await p.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display !== 'none'));
check('sem sessão: painel escondido', await p.evaluate(() => getComputedStyle(document.getElementById('painel-conteudo')).display === 'none'));
check('nenhum token em localStorage antes de logar', await p.evaluate(() => Object.keys(localStorage).length === 0));

// ── Senha errada: mensagem de erro, painel continua escondido ──
await p.fill('#login-email', 'x@sime.gov.br');
await p.fill('#login-pass', 'errada');
await p.click('#login-form button[type=submit]');
await p.waitForTimeout(200);
check('senha errada: mostra erro', (await p.locator('#login-erro').textContent()).includes('inválidos'));
check('senha errada: painel continua escondido', await p.evaluate(() => getComputedStyle(document.getElementById('painel-conteudo')).display === 'none'));

// ── Login correto: painel aparece e métricas carregam via RLS (sem endpoint/token) ──
await p.fill('#login-pass', 'certa');
await p.click('#login-form button[type=submit]');
await p.waitForTimeout(300);

check('zero erros JS', erros.length === 0, erros.join('; '));
check('login some após entrar', await p.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display === 'none'));
check('painel visível após entrar', await p.evaluate(() => getComputedStyle(document.getElementById('painel-conteudo')).display !== 'none'));
check('nenhum token gravado em localStorage', await p.evaluate(() => Object.keys(localStorage).length === 0));

check('zona mostrada = 7', (await p.locator('#zonaValue').textContent()).trim() === '7');
check('total = 4 itens', (await p.locator('#totalValue').textContent()).trim() === '4');

// Achado 3: getStatusCounts() olhava status_counts/statuses/counts antes de
// `contagem` (chave real) — cards ficavam sempre em 0. Confirma que batem
// com os 4 status carregados no mock.
check('card pendente = 1 (lê contagem, não status_counts)', (await p.locator('#statusPendente').textContent()).trim() === '1');
check('card confirmado = 1', (await p.locator('#statusConfirmado').textContent()).trim() === '1');
check('card finalizado = 1', (await p.locator('#statusFinalizado').textContent()).trim() === '1');
check('card erro = 1', (await p.locator('#statusErro').textContent()).trim() === '1');
check('processado = 50% (finalizado+erro / total)', (await p.locator('#processedValue').textContent()).trim() === '50,0%');

const rows = await p.locator('#recentesBody tr').count();
check('tabela de itens recentes: 4 linhas', rows === 4, 'n=' + rows);

await ctx.close();
await b.close();

let ok = 0, fail = 0;
for (const r of results) { if (r.ok) { ok++; } else { fail++; console.log('  ✗ ' + r.n + (r.e ? ' — ' + r.e : '')); } }
console.log(`\n${ok} checks OK, ${fail} falharam`);
process.exit(fail ? 1 : 0);
