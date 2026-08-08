// Testa api/hermes-heartbeat.js — telemetria + checagem de atualização.
//
// Via endpoint, não Supabase direto: index.js não fala mais com o Supabase
// desde 03/08/2026 (ver hermes/HERMES_RUNTIME.md), então este é o único
// caminho de gravação válido pra sime_heartbeat/sime_componentes. Cobre auth
// por zona, isolamento entre zonas, "enviar" devolvendo se há atualização
// pedida no mesmo request, e confirmar_atualizacao/erro_atualizacao.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TESTS_DIR, '..');
const _H = join(TESTS_DIR, '_sime_heartbeat.mjs');
const src = readFileSync(join(ROOT, 'api', 'hermes-heartbeat.js'), 'utf8')
  .replace(/from\s+['"]@supabase\/supabase-js['"]/, "from './fixtures/supabase-mock.mjs'");
writeFileSync(_H, src);
process.on('exit', () => { try { rmSync(_H, { force: true }); } catch (e) {} });

process.env.SUPABASE_URL = 'http://x';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
process.env.HERMES_SECRET_ZONA_7 = 'segredo7';
process.env.HERMES_SECRET_ZONA_94 = 'segredo94';

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

const AGORA = '2026-08-04T17:30:00.000Z';
function resetDB() {
  globalThis.__SUPA = {
    zonas: [{ id: 'zona-7', numero: 7 }, { id: 'zona-94', numero: 94 }],
    componentes: [],
    heartbeats: [],
    now: AGORA, ops: [],
  };
}

function req(body, auth) {
  return { method: 'POST', headers: { authorization: auth }, body };
}
function res() {
  const r = { _status: 200, _json: null };
  r.status = (c) => { r._status = c; return r; };
  r.json = (o) => { r._json = o; return r; };
  return r;
}

const { default: handler } = await import(_H);

// ── auth ──
{
  resetDB();
  const r = res();
  await handler(req({ acao: 'enviar' }, 'Bearer errado'), r);
  check('auth: bearer errado -> 401', r._status === 401, JSON.stringify(r._json));
}

// ── enviar: grava telemetria, sem pedido pendente ──
{
  resetDB();
  const r = res();
  await handler(req({ acao: 'enviar', telemetria: { versao: '1.2.0', cpu_pct: 18, whatsapp_status: 'conectado' } }, 'Bearer segredo7'), r);
  check('enviar: 200 ok', r._status === 200 && r._json.ok === true, JSON.stringify(r._json));
  check('enviar: sem atualização pendente por padrão', r._json.atualizar_agora === false && r._json.versao_desejada === null, JSON.stringify(r._json));
  const hb = globalThis.__SUPA.heartbeats.find(h => h.zona_id === 'zona-7');
  check('enviar: grava heartbeat com timestamp do servidor', hb && hb.ultimo_heartbeat === AGORA, JSON.stringify(hb));
  check('enviar: grava telemetria recebida', hb && hb.versao === '1.2.0' && hb.cpu_pct === 18 && hb.whatsapp_status === 'conectado', JSON.stringify(hb));
  check('enviar: componente default = hermes', hb && hb.componente === 'hermes', JSON.stringify(hb));
}

// ── enviar: devolve atualização pendente no mesmo request ──
{
  resetDB();
  globalThis.__SUPA.componentes.push({ zona_id: 'zona-7', componente: 'hermes', atualizar_agora: true, versao_desejada: 'v1.3.0' });
  const r = res();
  await handler(req({ acao: 'enviar', telemetria: {} }, 'Bearer segredo7'), r);
  check('enviar: devolve atualizar_agora=true', r._json.atualizar_agora === true, JSON.stringify(r._json));
  check('enviar: devolve versao_desejada', r._json.versao_desejada === 'v1.3.0', JSON.stringify(r._json));
}

// ── isolamento entre zonas: heartbeat da 94 não aparece pra 7 ──
{
  resetDB();
  const r94 = res();
  await handler(req({ acao: 'enviar', telemetria: { versao: '9.9.9' } }, 'Bearer segredo94'), r94);
  check('isolamento: zona 94 grava com seu próprio zona_id', globalThis.__SUPA.heartbeats.find(h => h.zona_id === 'zona-94' && h.versao === '9.9.9') !== undefined);
  check('isolamento: zona 7 não foi tocada', globalThis.__SUPA.heartbeats.find(h => h.zona_id === 'zona-7') === undefined);
}

// ── confirmar_atualizacao ──
{
  resetDB();
  globalThis.__SUPA.componentes.push({ zona_id: 'zona-7', componente: 'hermes', atualizar_agora: true, versao_desejada: 'v1.3.0', versao_instalada: '1.2.0' });
  const r = res();
  await handler(req({ acao: 'confirmar_atualizacao', versao: '1.3.0', commit_hash: 'abc123' }, 'Bearer segredo7'), r);
  check('confirmar_atualizacao: 200 ok', r._status === 200 && r._json.ok === true, JSON.stringify(r._json));
  const comp = globalThis.__SUPA.componentes.find(c => c.zona_id === 'zona-7');
  check('confirmar_atualizacao: zera atualizar_agora', comp.atualizar_agora === false, JSON.stringify(comp));
  check('confirmar_atualizacao: grava versao_instalada/commit', comp.versao_instalada === '1.3.0' && comp.commit_instalado === 'abc123', JSON.stringify(comp));
  check('confirmar_atualizacao: ultimo_resultado=ok', comp.ultimo_resultado === 'ok' && comp.ultimo_erro === null, JSON.stringify(comp));
  check('confirmar_atualizacao: atualizado_em = timestamp do servidor', comp.atualizado_em === AGORA, JSON.stringify(comp));
}

// ── erro_atualizacao ──
{
  resetDB();
  globalThis.__SUPA.componentes.push({ zona_id: 'zona-7', componente: 'hermes', atualizar_agora: true, versao_desejada: 'v1.3.0' });
  const r = res();
  await handler(req({ acao: 'erro_atualizacao', erro_msg: 'npm install falhou: ENOSPC' }, 'Bearer segredo7'), r);
  check('erro_atualizacao: 200 ok', r._status === 200 && r._json.ok === true, JSON.stringify(r._json));
  const comp = globalThis.__SUPA.componentes.find(c => c.zona_id === 'zona-7');
  check('erro_atualizacao: zera atualizar_agora mesmo com falha', comp.atualizar_agora === false, JSON.stringify(comp));
  check('erro_atualizacao: grava ultimo_erro', comp.ultimo_resultado === 'erro' && comp.ultimo_erro.includes('ENOSPC'), JSON.stringify(comp));
}

// ── componentes: idade do heartbeat de cada um, calculada no servidor ──
{
  resetDB();
  globalThis.__SUPA.heartbeats.push(
    { zona_id: 'zona-7', componente: 'hermes', ultimo_heartbeat: '2026-08-04T17:29:00.000Z' },      // 60s atrás de AGORA
    { zona_id: 'zona-7', componente: 'hermes-backup', ultimo_heartbeat: '2026-08-04T17:00:00.000Z' }, // 1800s atrás
    { zona_id: 'zona-94', componente: 'hermes', ultimo_heartbeat: AGORA },                            // outra zona — não deve aparecer
  );
  const r = res();
  await handler(req({ acao: 'componentes' }, 'Bearer segredo7'), r);
  check('componentes: 200 ok', r._status === 200 && r._json.ok === true, JSON.stringify(r._json));
  const lista = r._json.componentes || [];
  check('componentes: só os da zona autenticada', lista.length === 2, JSON.stringify(lista));
  const principal = lista.find(c => c.componente === 'hermes');
  const backup = lista.find(c => c.componente === 'hermes-backup');
  check('componentes: idade_s calculada com o relógio do servidor', principal?.idade_s === 60, JSON.stringify(principal));
  check('componentes: cada componente com a própria idade', backup?.idade_s === 1800, JSON.stringify(backup));
}

// ── componentes: nunca reportou heartbeat → idade_s null, não erro ──
{
  resetDB();
  globalThis.__SUPA.heartbeats.push({ zona_id: 'zona-7', componente: 'hermes', ultimo_heartbeat: null });
  const r = res();
  await handler(req({ acao: 'componentes' }, 'Bearer segredo7'), r);
  const item = (r._json.componentes || [])[0];
  check('componentes: sem heartbeat ainda → idade_s null', item?.idade_s === null, JSON.stringify(item));
}

// ── componentes: zona sem nenhum heartbeat → lista vazia, não erro ──
{
  resetDB();
  const r = res();
  await handler(req({ acao: 'componentes' }, 'Bearer segredo94'), r);
  check('componentes: zona sem heartbeat → 200 com lista vazia', r._status === 200 && Array.isArray(r._json.componentes) && r._json.componentes.length === 0, JSON.stringify(r._json));
}

// ── ação desconhecida ──
{
  resetDB();
  const r = res();
  await handler(req({ acao: 'chute' }, 'Bearer segredo7'), r);
  check('ação desconhecida: 400', r._status === 400, JSON.stringify(r._json));
}

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_hermes_heartbeat.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
