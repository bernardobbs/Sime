// Testa api/hermes-notificacoes.js — a fila que o Hermes CONSULTA.
//
// É o caminho SIME → Hermes sem túnel: como o Hermes roda atrás do NAT do
// cartório, ele é quem inicia a conexão, a cada X segundos. Cobre auth por
// zona, isolamento entre zonas, ordem da fila, idade (base do escalonamento) e
// os writes confirmar/erro.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TESTS_DIR, '..');
const _H = join(TESTS_DIR, '_sime_notif.mjs');
const src = readFileSync(join(ROOT, 'api', 'hermes-notificacoes.js'), 'utf8')
  .replace(/from\s+['"]@supabase\/supabase-js['"]/, "from './fixtures/supabase-mock.mjs'");
writeFileSync(_H, src);
process.on('exit', () => { try { rmSync(_H, { force: true }); } catch (e) {} });

process.env.SUPABASE_URL = 'http://x';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
process.env.HERMES_SECRET_ZONA_7 = 'segredo7';
process.env.HERMES_SECRET_ZONA_94 = 'segredo94';

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

const AGORA = '2026-10-04T10:00:00.000Z';
function resetDB() {
  globalThis.__SUPA = {
    zonas: [{ id: 'zona-7', numero: 7 }, { id: 'zona-94', numero: 94 }],
    secoes: [
      { id: 'sec-63', numero: 63, zona_id: 'zona-7', local_nome: 'G.E. Treze', municipio: 'Campo Maior' },
      { id: 'sec-64', numero: 64, zona_id: 'zona-7', local_nome: 'G.E. Treze', municipio: 'Campo Maior' },
      { id: 'sec-90', numero: 900, zona_id: 'zona-94', local_nome: 'Col. Oeiras', municipio: 'Oeiras' },
    ],
    notificacoes: [
      // 25 min de idade — já passou dos 10 min do 1º nível de escalonamento
      { id: 1, evento: 'panico_energia', secao_id: 'sec-63', status: 'pendente', tentativas: 0,
        mensagem: JSON.stringify({ evento: 'panico_energia', secao: '0063' }), created_at: '2026-10-04T09:35:00.000Z' },
      // 5 min — ainda dentro da janela
      { id: 2, evento: 'panico_urna', secao_id: 'sec-64', status: 'pendente', tentativas: 0,
        mensagem: JSON.stringify({ evento: 'panico_urna', secao: '0064' }), created_at: '2026-10-04T09:55:00.000Z' },
      // já enviada — não pode voltar na fila
      { id: 3, evento: 'midia_pronta', secao_id: 'sec-63', status: 'enviado', tentativas: 1,
        mensagem: '{}', created_at: '2026-10-04T09:00:00.000Z' },
      // de outra zona — a 7ª não pode ver
      { id: 4, evento: 'panico_energia', secao_id: 'sec-90', status: 'pendente', tentativas: 0,
        mensagem: '{}', created_at: '2026-10-04T09:50:00.000Z' },
    ],
    logs: [], now: AGORA, ops: [],
  };
}

const { default: handler } = await import(pathToFileURL(_H).href);
function mkRes() { return { code: null, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } }; }
async function call(method, headers, body) { const res = mkRes(); await handler({ method, headers, body }, res); return res; }
const Z7 = { authorization: 'Bearer segredo7' };
const Z94 = { authorization: 'Bearer segredo94' };

// ── AUTH ──
resetDB();
check('sem auth → 401', (await call('POST', {}, { acao: 'pendentes' })).code === 401);
check('secret desconhecido → 401', (await call('POST', { authorization: 'Bearer x' }, {})).code === 401);
check('GET → 405', (await call('GET', Z7, {})).code === 405);
check('ação desconhecida → 400', (await call('POST', Z7, { acao: 'apagar' })).code === 400);

// ── PENDENTES ──
resetDB();
{
  const r = await call('POST', Z7, { acao: 'pendentes' });
  const ns = r.body?.notificacoes || [];
  check('pendentes → 200', r.code === 200, String(r.code));
  check('devolve só as 2 pendentes da 7ª', ns.length === 2, String(ns.length));
  check('não devolve o que já foi enviado', !ns.some(n => n.id === 3));
  check('não vaza notificação da outra zona', !ns.some(n => n.id === 4));
  check('mais antiga primeiro', ns[0]?.id === 1, String(ns[0]?.id));

  const n1 = ns.find(n => n.id === 1);
  check('idade calculada do relógio do servidor', n1?.idade_s === 1500, String(n1?.idade_s));
  check('seção vem formatada com 4 dígitos', n1?.secao === '0063', n1?.secao);
  check('inclui local e município para a mensagem', n1?.local === 'G.E. Treze' && n1?.municipio === 'Campo Maior', `${n1?.local}/${n1?.municipio}`);
  check('payload do evento vem desserializado', n1?.payload?.evento === 'panico_energia', JSON.stringify(n1?.payload));
}

// A 94ª enxerga só a dela.
{
  const r = await call('POST', Z94, { acao: 'pendentes' });
  const ns = r.body?.notificacoes || [];
  check('94ª recebe só a própria notificação', ns.length === 1 && ns[0].id === 4, JSON.stringify(ns.map(n => n.id)));
}

// ── CONFIRMAR ──
resetDB();
{
  const r = await call('POST', Z7, { acao: 'confirmar', ids: [1] });
  check('confirmar → 200', r.code === 200, String(r.code));
  const n1 = globalThis.__SUPA.notificacoes.find(n => n.id === 1);
  check('confirmar marca como enviado', n1.status === 'enviado', n1.status);
  check('confirmar grava o horário do servidor', n1.enviado_ts === AGORA, String(n1.enviado_ts));

  const depois = await call('POST', Z7, { acao: 'pendentes' });
  check('confirmada sai da fila', !(depois.body.notificacoes || []).some(n => n.id === 1));
  check('confirmar registra log de auditoria', globalThis.__SUPA.logs.some(l => l.acao === 'notificacao_confirmar'));
}

// Uma zona não pode confirmar notificação de outra.
resetDB();
{
  const r = await call('POST', Z7, { acao: 'confirmar', ids: [4] });
  check('não confirma notificação de outra zona → 404', r.code === 404, String(r.code));
  const n4 = globalThis.__SUPA.notificacoes.find(n => n.id === 4);
  check('notificação da outra zona segue pendente', n4.status === 'pendente', n4.status);
}

// ── ERRO ──
resetDB();
{
  const r = await call('POST', Z7, { acao: 'erro', ids: [2], erro_msg: 'WhatsApp desconectado' });
  check('erro → 200', r.code === 200, String(r.code));
  const n2 = globalThis.__SUPA.notificacoes.find(n => n.id === 2);
  check('erro marca status erro', n2.status === 'erro', n2.status);
  check('erro guarda o motivo', n2.erro_msg === 'WhatsApp desconectado', n2.erro_msg);
  const depois = await call('POST', Z7, { acao: 'pendentes' });
  check('com erro sai da fila (não trava o restante)', !(depois.body.notificacoes || []).some(n => n.id === 2));
}

// ── VALIDAÇÃO ──
resetDB();
check('confirmar sem ids → 400', (await call('POST', Z7, { acao: 'confirmar', ids: [] })).code === 400);

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
