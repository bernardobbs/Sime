// Testa o botão de "instalar como app" (PWA) compartilhado pelos 6 módulos
// de campo — manifesto certo por papel, ícone escondido até o navegador
// avisar que a página é instalável, nunca aparece se o app já está
// instalado (display-mode standalone), e o clique de fato dispara o prompt
// nativo do navegador (ou, no iOS, mostra a instrução manual).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_CONFIG = `export const SIME_CONFIG = {
  exigirPin: false,
  supabaseUrl: 'https://exemplo.supabase.co',
  supabaseAnonKey: 'anon-de-teste',
};`;

const STUB_SUPABASE_JS = `
class QB { constructor(t){this.t=t;} select(){return this;} eq(){return this;} in(){return this;}
  order(){return this;} limit(){return this;}
  maybeSingle(){return Promise.resolve({data:null,error:null});} then(r){return r({data:[],error:null});} }
export function createClient(){ return {
  from(t){return new QB(t);},
  channel(){const c={on(){return c;},subscribe(){return c;}};return c;},
  removeChannel(){}, rpc(){return Promise.resolve({data:null,error:null});},
  auth:{async getSession(){return {data:{session:null}};},async getUser(){return {data:{user:null}};}},
};}
`;

const MODULOS = {
  SIME_mesario: 'manifest_mesario.json',
  SIME_motorista: 'manifest_motorista.json',
  SIME_conferente: 'manifest_conferente.json',
  SIME_instalador: 'manifest_instalador.json',
  SIME_acessibilidade: 'manifest_acessibilidade.json',
  SIME_midias: 'manifest_midias.json',
};

async function abrir(ctx, modulo, { standalone = false } = {}) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/sime_config.js**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_CONFIG }));
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS }));
  // Nunca deixa o SW real registrar em cima do servidor de teste — o teste é
  // sobre o botão, não sobre o worker em si.
  await p.route('**/sime_sw.js**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: 'self.addEventListener("fetch",()=>{});' }));
  if (standalone) {
    await p.addInitScript(() => {
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        if (q.includes('display-mode: standalone')) {
          return { matches: true, addListener() {}, removeListener() {} };
        }
        return orig(q);
      };
    });
  }
  await p.goto(`http://localhost:8917/modules/${modulo}.html?token=BX86FPJ7`);
  await p.waitForTimeout(400);
  return { p, erros };
}

// ── 1. Cada módulo aponta pro manifesto certo, com ícone e script de instalação ──
for (const [modulo, manifest] of Object.entries(MODULOS)) {
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, modulo);
  const href = await p.getAttribute('link[rel="manifest"]', 'href');
  check(`${modulo}: manifesto próprio`, href === `./${manifest}`, href);
  const touchIcon = await p.getAttribute('link[rel="apple-touch-icon"]', 'href');
  check(`${modulo}: apple-touch-icon presente`, touchIcon === './assets/icon-192.png', touchIcon);
  const scriptOk = await p.evaluate(() =>
    !![...document.scripts].find((s) => s.src.includes('sime_pwa_install.js')));
  check(`${modulo}: script de instalação incluído`, scriptOk);
  check(`${modulo}: sem erro JS`, erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Manifesto de cada módulo é JSON válido, com ícones e nome próprios ──
for (const [modulo, manifest] of Object.entries(MODULOS)) {
  const resp = await fetch(`http://localhost:8917/modules/${manifest}`);
  const json = await resp.json();
  check(`${manifest}: display standalone`, json.display === 'standalone');
  check(`${manifest}: tem os 3 ícones (192/512/maskable)`, Array.isArray(json.icons) && json.icons.length === 3, JSON.stringify(json.icons));
  check(`${manifest}: nome cita "SIME"`, json.name.includes('SIME'), json.name);
}

// ── 3. Botão nasce escondido, some no ícone até o navegador avisar que é instalável ──
{
  const ctx = await b.newContext();
  const { p } = await abrir(ctx, 'SIME_mesario');
  const hiddenInicial = await p.evaluate(() => {
    const btn = document.querySelector('.sime-pwa-btn');
    return !btn || btn.hidden;
  });
  check('botão começa escondido (sem beforeinstallprompt ainda)', hiddenInicial);
  await ctx.close();
}

// ── 4. beforeinstallprompt revela o botão; clicar chama .prompt() do evento salvo ──
{
  const ctx = await b.newContext();
  const { p } = await abrir(ctx, 'SIME_mesario');
  const promptChamado = await p.evaluate(async () => {
    let chamou = false;
    const evento = new Event('beforeinstallprompt', { cancelable: true });
    evento.prompt = () => { chamou = true; };
    evento.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(evento);
    await new Promise((r) => setTimeout(r, 50));
    document.querySelector('.sime-pwa-btn').click();
    await new Promise((r) => setTimeout(r, 50));
    return chamou;
  });
  check('beforeinstallprompt revela o botão e o clique chama .prompt()', promptChamado);

  const escondeDepois = await p.evaluate(() => document.querySelector('.sime-pwa-btn').hidden);
  check('botão some de novo depois de usado', escondeDepois);
  await ctx.close();
}

// ── 5. App já instalado (display-mode standalone) — nunca mostra o botão ──
{
  const ctx = await b.newContext();
  const { p } = await abrir(ctx, 'SIME_mesario', { standalone: true });
  const semBotao = await p.evaluate(() => {
    // mesmo que o navegador dispare o evento por algum motivo, o script já
    // saiu antes de escutar (early return em jaInstalado())
    const evento = new Event('beforeinstallprompt', { cancelable: true });
    evento.prompt = () => {};
    window.dispatchEvent(evento);
    return !document.querySelector('.sime-pwa-btn');
  });
  check('já instalado: nunca cria o botão, mesmo com beforeinstallprompt', semBotao);
  await ctx.close();
}

// ── 6. iOS Safari (sem beforeinstallprompt) — botão aparece sozinho com instrução manual ──
{
  const ctx = await b.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const p = await ctx.newPage();
  await p.route('**/sime_config.js**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_CONFIG }));
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS }));
  await p.route('**/sime_sw.js**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: 'self.addEventListener("fetch",()=>{});' }));
  await p.goto('http://localhost:8917/modules/SIME_mesario.html?token=BX86FPJ7');
  await p.waitForTimeout(3200); // o atraso proposital de 2.5s antes de mostrar no iOS
  const visivel = await p.evaluate(() => {
    const btn = document.querySelector('.sime-pwa-btn');
    return !!btn && !btn.hidden;
  });
  check('iOS Safari: botão aparece sozinho (sem beforeinstallprompt)', visivel);

  await p.click('.sime-pwa-btn');
  await p.waitForTimeout(100);
  const toastTexto = await p.evaluate(() => document.querySelector('.sime-pwa-toast.on')?.textContent || '');
  check('iOS Safari: clique mostra instrução manual (Compartilhar → Adicionar)',
    /Compartilhar/.test(toastTexto) && /Tela de Início/.test(toastTexto), toastTexto);
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
