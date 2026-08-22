// Testa api/hermes-campanhas.js — a fila de disparo em massa que o Hermes
// CONSULTA (mesmo sentido de hermes-notificacoes.js: SIME → Hermes, sem
// túnel). Cobre auth por zona, isolamento entre zonas, item sem mensagem não
// sai na fila, e os writes confirmar/erro (incluindo tentativas e
// whatsapp_existe opcional).
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TESTS_DIR, '..');
const _H = join(TESTS_DIR, '_sime_campanhas.mjs');
const src = readFileSync(join(ROOT, 'api', 'hermes-campanhas.js'), 'utf8')
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
    campanhas: [
      { id: 'c1', ator_id: 'a1', zona_id: 'zona-7', telefone_whatsapp: '558611110001',
        mensagem_enviada: 'Olá! Confirme sua presença como mesário.', status: 'pendente', tentativas: 0, created_at: '2026-10-04T09:00:00.000Z' },
      { id: 'c2', ator_id: 'a2', zona_id: 'zona-7', telefone_whatsapp: '558611110002',
        mensagem_enviada: 'Aviso importante.', status: 'pendente', tentativas: 1, created_at: '2026-10-04T09:30:00.000Z' },
      // sem mensagem — não pode sair na fila (viraria erro no Hermes à toa)
      { id: 'c3', ator_id: 'a3', zona_id: 'zona-7', telefone_whatsapp: '558611110003',
        mensagem_enviada: '', status: 'pendente', tentativas: 0, created_at: '2026-10-04T09:10:00.000Z' },
      // já enviada — não pode voltar
      { id: 'c4', ator_id: 'a4', zona_id: 'zona-7', telefone_whatsapp: '558611110004',
        mensagem_enviada: 'Já foi.', status: 'enviado', tentativas: 1, created_at: '2026-10-04T08:00:00.000Z' },
      // de outra zona — a 7ª não pode ver
      { id: 'c5', ator_id: 'a5', zona_id: 'zona-94', telefone_whatsapp: '558611110005',
        mensagem_enviada: 'Mensagem da 94ª.', status: 'pendente', tentativas: 0, created_at: '2026-10-04T09:20:00.000Z' },
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
  const cs = r.body?.campanhas || [];
  check('pendentes → 200', r.code === 200, String(r.code));
  check('devolve só as 2 pendentes com mensagem da 7ª', cs.length === 2, String(cs.length));
  check('não devolve item sem mensagem', !cs.some(c => c.id === 'c3'));
  check('não devolve o que já foi enviado', !cs.some(c => c.id === 'c4'));
  check('não vaza campanha de outra zona', !cs.some(c => c.id === 'c5'));
  check('mais antiga primeiro', cs[0]?.id === 'c1', String(cs[0]?.id));
  check('traz o telefone e a mensagem prontos', cs[0]?.telefone === '558611110001' && cs[0]?.mensagem?.includes('Confirme'), JSON.stringify(cs[0]));
  check('traz tentativas atuais', cs[1]?.tentativas === 1, String(cs[1]?.tentativas));

  const r94 = await call('POST', Z94, { acao: 'pendentes' });
  check('94ª recebe só a própria campanha', (r94.body?.campanhas||[]).length === 1 && r94.body.campanhas[0].id === 'c5');
}

// ── CONFIRMAR ──
resetDB();
{
  const r = await call('POST', Z7, { acao: 'confirmar', ids: ['c1'] });
  check('confirmar → 200', r.code === 200, String(r.code));
  const c1 = globalThis.__SUPA.campanhas.find(c => c.id === 'c1');
  check('confirmar marca como enviado', c1.status === 'enviado', c1.status);
  check('confirmar grava ts_enviado do servidor', c1.ts_enviado === AGORA, String(c1.ts_enviado));

  const depois = await call('POST', Z7, { acao: 'pendentes' });
  check('confirmada sai da fila', !(depois.body.campanhas || []).some(c => c.id === 'c1'));
  check('confirmar registra log de auditoria', globalThis.__SUPA.logs.some(l => l.acao === 'campanha_confirmar'));
}

// confirmar com whatsapp_existe opcional
resetDB();
{
  await call('POST', Z7, { acao: 'confirmar', ids: ['c1'], whatsapp_existe: true });
  const c1 = globalThis.__SUPA.campanhas.find(c => c.id === 'c1');
  check('confirmar grava whatsapp_existe quando informado', c1.whatsapp_existe === true && c1.whatsapp_existe_ts === AGORA, JSON.stringify(c1));
}

// Uma zona não pode confirmar campanha de outra.
resetDB();
{
  const r = await call('POST', Z7, { acao: 'confirmar', ids: ['c5'] });
  check('não confirma campanha de outra zona → 404', r.code === 404, String(r.code));
  const c5 = globalThis.__SUPA.campanhas.find(c => c.id === 'c5');
  check('campanha da outra zona segue pendente', c5.status === 'pendente', c5.status);
}

// ── ERRO ──
resetDB();
{
  const r = await call('POST', Z7, { acao: 'erro', ids: ['c2'], erro_msg: 'número não existe no WhatsApp', whatsapp_existe: false });
  check('erro → 200', r.code === 200, String(r.code));
  const c2 = globalThis.__SUPA.campanhas.find(c => c.id === 'c2');
  check('erro marca status erro', c2.status === 'erro', c2.status);
  check('erro guarda o motivo', c2.erro_msg === 'número não existe no WhatsApp', c2.erro_msg);
  check('erro incrementa tentativas (não sobrescreve)', c2.tentativas === 2, String(c2.tentativas));
  check('erro grava whatsapp_existe=false quando informado', c2.whatsapp_existe === false, JSON.stringify(c2));
  const depois = await call('POST', Z7, { acao: 'pendentes' });
  check('com erro sai da fila (não trava o restante)', !(depois.body.campanhas || []).some(c => c.id === 'c2'));
  check('erro registra log de auditoria', globalThis.__SUPA.logs.some(l => l.acao === 'campanha_erro'));
}

// ── VALIDAÇÃO ──
resetDB();
check('confirmar sem ids → 400', (await call('POST', Z7, { acao: 'confirmar', ids: [] })).code === 400);

// ── RESUMO: em_andamento (22/08/2026, achado real: mesmo resumo repetindo
// no Telegram toda hora dias depois da campanha já ter terminado) ──
resetDB();
{
  // zona-7 tem c1/c2/c3 pendente (c3 sem mensagem, mas ainda conta pro
  // resumo — a exclusão de 'pendentes' é sobre O QUE SAI na fila, não
  // sobre o status em si) — algo em andamento.
  const r = await call('POST', Z7, { acao: 'resumo' });
  check('resumo → 200', r.code === 200, String(r.code));
  check('em_andamento=true quando há item pendente/aguardando_resposta/confirmado', r.body.em_andamento === true, JSON.stringify(r.body));
}
{
  // Só itens terminais (enviado/erro/etc) — nada rodando, resumo não devia
  // mais repetir pra sempre (dispatch.js do Hermes usa isso pra não mandar).
  globalThis.__SUPA.campanhas = globalThis.__SUPA.campanhas
    .filter(c => c.zona_id === 'zona-7')
    .map(c => ({ ...c, status: 'enviado' }));
  const r = await call('POST', Z7, { acao: 'resumo' });
  check('em_andamento=false quando só sobra item terminal', r.body.em_andamento === false, JSON.stringify(r.body));
  check('total continua contando (não é 0)', r.body.total > 0, String(r.body.total));
}

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
