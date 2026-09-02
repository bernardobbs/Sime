// Testa os achados "médio" de SIME_tokens.html: gerarEmMassa() tinha um
// confirm() bloqueante redundante (a ação é idempotente — pula quem já tem
// token, nunca duplica ou apaga nada, não é irreversível) e nenhum feedback
// visual enquanto gera até ~270 tokens + grava em lote no Supabase. Também
// confere autocomplete/label no login e aria-label nos ícones da lista.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
function rowsFor(table) { return (window.__mockConfig[table] || []); }
function matchFilters(row, filters) { return Object.entries(filters).every(([k, v]) => row[k] === v); }
class QB {
  constructor(table) { this.table = table; this.filters = {}; this._op = 'select'; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  not() { return this; }
  order() { return this; }
  limit() { return this; }
  insert(payload) { window.__mockConfig.insertCalls.push({ table: this.table, payload }); return Promise.resolve({ data: null, error: null }); }
  delete() { this._op = 'delete'; return this; }
  then(resolve) {
    if (this._op === 'delete') { window.__mockConfig.deleteCalls.push({ table: this.table, filters: { ...this.filters } }); return resolve({ data: null, error: null }); }
    return resolve({ data: rowsFor(this.table).filter((r) => matchFilters(r, this.filters)), error: null });
  }
  maybeSingle() { const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters)); return Promise.resolve({ data: rows[0] ?? null, error: null }); }
}
export function createClient() {
  return {
    from(table) { return new QB(table); },
    auth: {
      async signInWithPassword() { return { error: null }; },
      async getSession() { return { data: { session: null } }; },
    },
  };
}
`;

const ctx = await b.newContext();
const p = await ctx.newPage();
const erros = [];
p.on('pageerror', (e) => erros.push(String(e)));
// Nenhum handler de 'dialog' registrado de propósito — se algum confirm()
// nativo ainda existisse na gerarEmMassa(), o clique travaria esperando
// resposta e o teste daria timeout.
await p.addInitScript((cfg) => { window.__mockConfig = cfg; }, {
  sime_eleicoes: [{ id: 'ele-uuid-1', turno: 1, ativa: true, created_at: '2026-01-01' }],
  sime_rotas: [{ id: 'rota-uuid-001', codigo: '001', nome: 'Rota 001', municipios: ['Campo Maior'], ativo: true }],
  sime_secoes: [{ id: 'sec-uuid-135', numero: 135, local_nome: 'G.E. Maroquinha', municipio: 'Campo Maior', eleitores: 178, ativo: true, rota_id: 'rota-uuid-001', parada: 1 }],
  insertCalls: [], deleteCalls: [],
});
await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
});
await p.goto('http://localhost:8917/modules/SIME_tokens.html');
await p.waitForTimeout(300);

// Login: label associada (não só placeholder) + autocomplete correto
check('campo de e-mail tem label associada', await p.locator('label[for="login-email"]').count() === 1);
check('campo de e-mail pede autocomplete=username', await p.getAttribute('#login-email', 'autocomplete') === 'username');
check('campo de senha pede autocomplete=current-password', await p.getAttribute('#login-pass', 'autocomplete') === 'current-password');

await p.fill('#login-email', 'admin@sime.gov.br');
await p.fill('#login-pass', 'senha123');
await p.click('#login-form button[type=submit]');
await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
await p.waitForTimeout(300);

check('zero erros JS após login', erros.length === 0, erros.join('; '));

// Clica direto — sem confirm() bloqueante, não precisa de handler de dialog
await p.click('#btn-massa');
await p.waitForTimeout(400);

check('zero erros JS ao gerar em massa (sem travar em confirm)', erros.length === 0, erros.join('; '));
const botaoFinal = await p.locator('#btn-massa').evaluate(el => ({ disabled: el.disabled, texto: el.textContent.trim() }));
check('botão volta a ficar habilitado depois de gerar', botaoFinal.disabled === false, JSON.stringify(botaoFinal));
check('botão volta ao rótulo original (não fica preso em "Gerando...")', botaoFinal.texto.includes('Gerar em massa'), botaoFinal.texto);

const tokensGerados = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('sime_tokens_v1') || '{}')).length);
check('gerou tokens de verdade (seção + 3 tipos por rota)', tokensGerados >= 4, String(tokensGerados));

// Ícones só-emoji da lista de tokens ganham aria-label
const printBtn = p.locator('button[aria-label="Imprimir"]').first();
const delBtn = p.locator('button[aria-label="Excluir token"]').first();
check('botão imprimir do cartão tem aria-label', await printBtn.count() >= 1);
check('botão excluir do cartão tem aria-label', await delBtn.count() >= 1);

check('zero erros JS ao final', erros.length === 0, erros.join('; '));

await ctx.close();
await b.close();

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_tokens_massa_sem_confirm.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
