// Testa api/hermes-mesarios.js (leitura + autoatendimento + confirmação de
// mesários/apoio logístico pelo Hermes) com Supabase mockado (fixtures/supabase-mock.mjs
// via globalThis.__SUPA). Cobre auth por zona, isolamento entre zonas,
// listar/filtrar, consultar (autoatendimento "oi"), atualizar (recado livre)
// e os writes confirmar/recusar/substituir (incluindo ativo e log de auditoria).
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TESTS_DIR, '..');
const _H = join(TESTS_DIR, '_sime_mesarios.mjs');
const src = readFileSync(join(ROOT, 'api', 'hermes-mesarios.js'), 'utf8')
  .replace(/from\s+['"]@supabase\/supabase-js['"]/, "from './fixtures/supabase-mock.mjs'");
writeFileSync(_H, src);
process.on('exit', () => { try { rmSync(_H, { force: true }); } catch (e) {} });

process.env.SUPABASE_URL = 'http://x';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
process.env.HERMES_SECRET_ZONA_7 = 'segredo7';
process.env.HERMES_SECRET_ZONA_96 = 'segredo96';

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

// Zona 7: ANA (mesário, seção só em observacao — dado legado) + BRUNO (mesário,
// já confirmado) + DIEGO (mesário COM secao_id/funcao_mesa reais, vindos da
// carga do TRE, E também apoio logístico — mesma pessoa, duas convocações).
// Zona 96: CARLA, só pra testar isolamento entre zonas.
function resetDB() {
  globalThis.__SUPA = {
    zonas: [{ id: 'zona-7', numero: 7 }, { id: 'zona-96', numero: 96 }],
    secoes: [
      { id: 'sec-63', zona_id: 'zona-7', numero: 63, local_nome: 'Escola Municipal X', municipio: 'Campo Maior' },
    ],
    atores: [
      { id: 'm1', zona_id: 'zona-7', funcao: 'mesario', nome_completo: 'ANA SOUSA', telefone_whatsapp: '558611110001', observacao: 'Função: Presidente | Seção votação: 63 | Local: X', confirmacao: 'pendente', ativo: true, secao_id: null, funcao_mesa: null },
      { id: 'm2', zona_id: 'zona-7', funcao: 'mesario', nome_completo: 'BRUNO LIMA', telefone_whatsapp: '558611110002', observacao: 'Função: 1º Mesário | Seção votação: 64 | Local: X', confirmacao: 'confirmado', ativo: true, secao_id: null, funcao_mesa: null },
      { id: 'm3', zona_id: 'zona-96', funcao: 'mesario', nome_completo: 'CARLA ROCHA (outra zona)', telefone_whatsapp: '558611110003', observacao: 'Função: Presidente | Seção votação: 63 | Local: Z', confirmacao: 'pendente', ativo: true, secao_id: null, funcao_mesa: null },
      { id: 'm4', zona_id: 'zona-7', funcao: 'mesario', nome_completo: 'DIEGO ALVES', telefone_whatsapp: '558611110004', observacao: null, confirmacao: 'pendente', ativo: true, secao_id: 'sec-63', funcao_mesa: 'Presidente' },
      { id: 'a1', zona_id: 'zona-7', funcao: 'auxiliar_eleicao', nome_completo: 'DIEGO ALVES', telefone_whatsapp: '558611110004', observacao: null, confirmacao: 'pendente', ativo: true, secao_id: null, funcao_mesa: null },
    ],
    logs: [], now: '2026-08-01T10:00:00.000Z', ops: [],
  };
}

const { default: handler } = await import(pathToFileURL(_H).href);
function mkRes() { return { code: null, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } }; }
async function call(method, headers, body) { const res = mkRes(); await handler({ method, headers, body }, res); return res; }
const Z7 = { authorization: 'Bearer segredo7' };
const Z96 = { authorization: 'Bearer segredo96' };

// ── AUTH / MÉTODO / VALIDAÇÃO ──
resetDB();
check('sem auth → 401', (await call('POST', {}, { acao: 'listar' })).code === 401);
check('secret desconhecido → 401', (await call('POST', { authorization: 'Bearer x' }, { acao: 'listar' })).code === 401);
check('GET → 405', (await call('GET', Z7, {})).code === 405);
check('sem acao → 400', (await call('POST', Z7, {})).code === 400);

// ── LISTAR + ISOLAMENTO ENTRE ZONAS ──
resetDB();
let r = await call('POST', Z7, { acao: 'listar' });
check('listar zona 7 → 200', r.code === 200);
check('lista mesário + apoio logístico da zona 7 (4), não a de outra zona', r.body.total === 4 && r.body.mesarios.every(m => m.nome !== 'CARLA ROCHA (outra zona)'), JSON.stringify(r.body.total));
check('extrai seção do observacao (dado legado, sem secao_id)', r.body.mesarios.find(m => m.nome === 'ANA SOUSA')?.secao === '0063');
check('resolve seção via secao_id (dado novo, join com sime_secoes)', r.body.mesarios.find(m => m.nome === 'DIEGO ALVES' && m.secao === '0063'));

r = await call('POST', Z96, { acao: 'listar' });
check('zona 96 vê só a sua (isolamento)', r.body.total === 1 && r.body.mesarios[0].nome === 'CARLA ROCHA (outra zona)', JSON.stringify(r.body.total));

// filtro por status
resetDB();
r = await call('POST', Z7, { acao: 'listar', status: 'pendente' });
check('filtro status=pendente', r.body.total === 3 && r.body.mesarios.some(m => m.nome === 'ANA SOUSA'), JSON.stringify(r.body));

// filtro por seção (via observacao, secao_id ainda null)
resetDB();
r = await call('POST', Z7, { acao: 'listar', secao: '64' });
check('filtro por seção 64', r.body.total === 1 && r.body.mesarios[0].nome === 'BRUNO LIMA', JSON.stringify(r.body));

// ── CONSULTAR — autoatendimento ("oi") ──
resetDB();
r = await call('POST', Z7, { acao: 'consultar', telefone: '558611110004' });
check('consultar → 200, encontrado 2 (mesário + apoio logístico, mesma pessoa)', r.code === 200 && r.body.encontrado === 2, JSON.stringify(r.body));
check('mensagem_wa cita seção com local/município (via secao_id)', r.body.mensagem_wa.includes('Seção 0063') && r.body.mensagem_wa.includes('Escola Municipal X') && r.body.mensagem_wa.includes('Campo Maior'), r.body.mensagem_wa);
check('mensagem_wa junta os dois papéis ("e também")', r.body.mensagem_wa.includes('e também'), r.body.mensagem_wa);
check('funcao_mesa aparece no rótulo (Presidente)', r.body.mensagem_wa.includes('Presidente'), r.body.mensagem_wa);
check('convida a mandar atualização', /manda a informação/.test(r.body.mensagem_wa), r.body.mensagem_wa);

resetDB();
r = await call('POST', Z7, { acao: 'consultar', telefone: '558611110001' });
check('consultar via fallback de observacao (secao_id null)', r.code === 200 && r.body.pessoas[0].secao.numero === '0063', JSON.stringify(r.body));

resetDB();
r = await call('POST', Z7, { acao: 'consultar', telefone: '558611110002' });
check('mensagem_wa avisa quando já confirmou', /já confirmou/.test(r.body.mensagem_wa), r.body.mensagem_wa);

resetDB();
check('consultar sem telefone → 400', (await call('POST', Z7, { acao: 'consultar' })).code === 400);

resetDB();
r = await call('POST', Z7, { acao: 'consultar', telefone: '5599999999' });
check('consultar telefone não encontrado → 404 com orientação', r.code === 404 && /cartório/.test(r.body.mensagem_wa), JSON.stringify(r.body));

resetDB();
r = await call('POST', Z7, { acao: 'consultar', telefone: '558611110003' });
check('zona 7 não encontra convocado da zona 96 via consultar (isolamento)', r.code === 404);

// ── ATUALIZAR — recado livre vira observação (nunca sobrescreve dado do TRE) ──
resetDB();
r = await call('POST', Z7, { acao: 'atualizar', telefone: '558611110001', mensagem: 'meu telefone mudou pra 86999998888' });
check('atualizar → 200, encontrado 1', r.code === 200 && r.body.encontrado === 1, JSON.stringify(r.body));
check('anexa recado em observacao sem apagar o que já tinha', globalThis.__SUPA.atores[0].observacao.includes('Recado via Hermes: meu telefone mudou') && globalThis.__SUPA.atores[0].observacao.includes('Seção votação: 63'), globalThis.__SUPA.atores[0].observacao);
check('não mexe em nome/telefone (dado oficial do TRE)', globalThis.__SUPA.atores[0].nome_completo === 'ANA SOUSA' && globalThis.__SUPA.atores[0].telefone_whatsapp === '558611110001');
check('atualizar registra log de auditoria', globalThis.__SUPA.logs.some(l => l.acao === 'hermes_atualizou_info'));

resetDB();
r = await call('POST', Z7, { acao: 'atualizar', telefone: '558611110004', mensagem: 'não vou poder ir' });
check('atualizar em pessoa com 2 papéis anexa nas duas linhas', globalThis.__SUPA.atores[3].observacao?.includes('não vou poder ir') && globalThis.__SUPA.atores[4].observacao?.includes('não vou poder ir'), JSON.stringify([globalThis.__SUPA.atores[3].observacao, globalThis.__SUPA.atores[4].observacao]));

resetDB();
check('atualizar sem mensagem → 400', (await call('POST', Z7, { acao: 'atualizar', telefone: '558611110001' })).code === 400);
resetDB();
check('atualizar sem telefone → 400', (await call('POST', Z7, { acao: 'atualizar', mensagem: 'x' })).code === 400);
resetDB();
check('atualizar telefone não encontrado → 404', (await call('POST', Z7, { acao: 'atualizar', telefone: '5599999999', mensagem: 'x' })).code === 404);

// ── CONFIRMAR ──
resetDB();
r = await call('POST', Z7, { acao: 'confirmar', telefone: '558611110001' });
check('confirmar → 200 encontrado 1', r.code === 200 && r.body.encontrado === 1, JSON.stringify(r.body));
check('confirmar grava confirmacao=confirmado, ativo=true', globalThis.__SUPA.atores[0].confirmacao === 'confirmado' && globalThis.__SUPA.atores[0].ativo === true);
check('confirmar registra log de auditoria', globalThis.__SUPA.logs.length === 1 && globalThis.__SUPA.logs[0].acao === 'hermes_confirmou_mesario');

// telefone com DDI/DDD diferente casa pelos últimos 8 dígitos
resetDB();
r = await call('POST', Z7, { acao: 'confirmar', telefone: '+55 (86) 1111-0002' });
check('casa telefone por sufixo (8 díg.)', r.code === 200 && globalThis.__SUPA.atores[1].confirmacao === 'confirmado', JSON.stringify(r.body));

// ── RECUSAR / SUBSTITUIR zeram ativo ──
resetDB();
r = await call('POST', Z7, { acao: 'recusar', telefone: '558611110001' });
check('recusar → confirmacao=recusou, ativo=false', globalThis.__SUPA.atores[0].confirmacao === 'recusou' && globalThis.__SUPA.atores[0].ativo === false, JSON.stringify(r.body));

resetDB();
r = await call('POST', Z7, { acao: 'substituir', telefone: '558611110002' });
check('substituir → confirmacao=substituido, ativo=false', globalThis.__SUPA.atores[1].confirmacao === 'substituido' && globalThis.__SUPA.atores[1].ativo === false);

// ── telefone não encontrado / faltando ──
resetDB();
check('confirmar sem telefone → 400', (await call('POST', Z7, { acao: 'confirmar' })).code === 400);
check('telefone inexistente → 404', (await call('POST', Z7, { acao: 'confirmar', telefone: '5599999' })).code === 404);

// isolamento na escrita: zona 7 não confirma mesário da zona 96
resetDB();
r = await call('POST', Z7, { acao: 'confirmar', telefone: '558611110003' });
check('zona 7 não altera mesário da zona 96', r.code === 404 && globalThis.__SUPA.atores[2].confirmacao === 'pendente', JSON.stringify(r.body));

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
