// Testa api/hermes-contatos.js — resolve telefone por papel (Gestor de
// Problemas / Chefe de Cartório) pra fechar a pendência do escalonamento: a
// fila de notificações mandava pra todo ADMIN_NUMBERS igual, sem diferenciar
// nível. Cobre auth por zona, isolamento entre zonas, filtro por perfil e por
// telefone cadastrado.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TESTS_DIR, '..');
const _H = join(TESTS_DIR, '_sime_contatos.mjs');
const src = readFileSync(join(ROOT, 'api', 'hermes-contatos.js'), 'utf8')
  .replace(/from\s+['"]@supabase\/supabase-js['"]/, "from './fixtures/supabase-mock.mjs'");
writeFileSync(_H, src);
process.on('exit', () => { try { rmSync(_H, { force: true }); } catch (e) {} });

process.env.SUPABASE_URL = 'http://x';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
process.env.HERMES_SECRET_ZONA_7 = 'segredo7';
process.env.HERMES_SECRET_ZONA_94 = 'segredo94';

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

function resetDB() {
  globalThis.__SUPA = {
    zonas: [{ id: 'zona-7', numero: 7 }, { id: 'zona-94', numero: 94 }],
    usuarios: [
      { id: 'u1', zona_id: 'zona-7', perfil: 'gestor_prob', ativo: true, telefone_whatsapp: '558611110001' },
      { id: 'u2', zona_id: 'zona-7', perfil: 'coordenador', ativo: true, telefone_whatsapp: '558611110002' },
      { id: 'u3', zona_id: 'zona-7', perfil: 'gestor_prob', ativo: true, telefone_whatsapp: null }, // sem telefone — não pode aparecer
      { id: 'u4', zona_id: 'zona-7', perfil: 'monitor', ativo: true, telefone_whatsapp: '558611110004' }, // perfil fora do escalonamento
      { id: 'u5', zona_id: 'zona-7', perfil: 'coordenador', ativo: false, telefone_whatsapp: '558611110005' }, // inativo — não pode aparecer
      { id: 'u6', zona_id: 'zona-94', perfil: 'coordenador', ativo: true, telefone_whatsapp: '558699990009' }, // outra zona
    ],
    ops: [],
  };
}

function req(body, auth) { return { method: 'POST', headers: { authorization: auth }, body }; }
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
  await handler(req({ acao: 'listar' }, 'Bearer errado'), r);
  check('auth: bearer errado -> 401', r._status === 401, JSON.stringify(r._json));
}

// ── listar: só gestor_prob/coordenador ativos com telefone, da própria zona ──
{
  resetDB();
  const r = res();
  await handler(req({ acao: 'listar' }, 'Bearer segredo7'), r);
  check('listar: 200 ok', r._status === 200 && r._json.ok === true, JSON.stringify(r._json));
  check('listar: gestor_prob traz só quem tem telefone', JSON.stringify(r._json.contatos.gestor_prob) === JSON.stringify(['558611110001']), JSON.stringify(r._json.contatos));
  check('listar: coordenador traz só quem está ativo', JSON.stringify(r._json.contatos.coordenador) === JSON.stringify(['558611110002']), JSON.stringify(r._json.contatos));
  check('listar: não traz outros perfis (monitor)', !JSON.stringify(r._json.contatos).includes('558611110004'), JSON.stringify(r._json.contatos));
  check('listar: não traz inativo', !JSON.stringify(r._json.contatos).includes('558611110005'), JSON.stringify(r._json.contatos));
}

// ── isolamento entre zonas ──
{
  resetDB();
  const r = res();
  await handler(req({ acao: 'listar' }, 'Bearer segredo94'), r);
  check('isolamento: zona 94 só vê o próprio coordenador', JSON.stringify(r._json.contatos.coordenador) === JSON.stringify(['558699990009']), JSON.stringify(r._json.contatos));
  check('isolamento: zona 94 não vê gestor_prob da 7ª', r._json.contatos.gestor_prob.length === 0, JSON.stringify(r._json.contatos));
}

// ── zona sem ninguém com telefone cadastrado — listas vazias, não erro ──
{
  globalThis.__SUPA = { zonas: [{ id: 'zona-7', numero: 7 }], usuarios: [], ops: [] };
  const r = res();
  await handler(req({ acao: 'listar' }, 'Bearer segredo7'), r);
  check('vazio: 200 ok mesmo sem ninguém', r._status === 200 && r._json.ok === true, JSON.stringify(r._json));
  check('vazio: listas vazias', r._json.contatos.gestor_prob.length === 0 && r._json.contatos.coordenador.length === 0, JSON.stringify(r._json.contatos));
}

// ── ação desconhecida ──
{
  resetDB();
  const r = res();
  await handler(req({ acao: 'chute' }, 'Bearer segredo7'), r);
  check('ação desconhecida: 400', r._status === 400, JSON.stringify(r._json));
}

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_hermes_contatos.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
