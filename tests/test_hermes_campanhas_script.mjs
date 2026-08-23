// Testa o achado da revisão de 19/08/2026: api/hermes-campanhas.js 'pendentes'
// não devolvia campanha_id/etapa_atual, então uma campanha de script (que
// SIME_atores.html grava com campanha_id + etapa_atual:1 ao usar "Usar script
// salvo") chegava ao Hermes indistinguível de uma mensagem avulsa — e
// 'confirmar' sem novo_status explícito marcava 'enviado' (some da fila pra
// sempre, filtro de pendentes só olha pendente/aguardando_resposta/confirmado)
// em vez de 'aguardando_resposta' (item de script sempre espera resposta,
// scripts só avançam via obter_etapa_pendente/avancar_etapa).
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TESTS_DIR, '..');
const _H = join(TESTS_DIR, '_sime_campanhas_script.mjs');
const src = readFileSync(join(ROOT, 'api', 'hermes-campanhas.js'), 'utf8')
  .replace(/from\s+['"]@supabase\/supabase-js['"]/, "from './fixtures/supabase-mock.mjs'");
writeFileSync(_H, src);
process.on('exit', () => { try { rmSync(_H, { force: true }); } catch (e) {} });

process.env.SUPABASE_URL = 'http://x';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
process.env.HERMES_SECRET_ZONA_7 = 'segredo7';

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

const AGORA = '2026-10-04T10:00:00.000Z';
function resetDB() {
  globalThis.__SUPA = {
    zonas: [{ id: 'zona-7', numero: 7 }],
    campanhas: [
      // item de script — etapa 1, ainda não mandada
      { id: 's1', ator_id: 'a1', zona_id: 'zona-7', telefone_whatsapp: '558611110001',
        mensagem_enviada: 'Etapa 1: você confirma presença?', status: 'pendente', tentativas: 0,
        created_at: '2026-10-04T09:00:00.000Z', campanha_id: 'camp-1', etapa_atual: 1 },
      // item legado (sem campanha_id) — comportamento de sempre, não pode regredir
      { id: 'l1', ator_id: 'a2', zona_id: 'zona-7', telefone_whatsapp: '558611110002',
        mensagem_enviada: 'Mensagem avulsa de sempre.', status: 'pendente', tentativas: 0,
        created_at: '2026-10-04T09:05:00.000Z', campanha_id: null, etapa_atual: null },
    ],
    // Entidade da campanha (nome/status) — 'ativa' pra 'pendentes' entregar o
    // item de script (21/08/2026: pendentes só entrega item com campanha_id
    // se a campanha estiver 'ativa', ver "controle total das campanhas").
    campanhasEntidade: [{ id: 'camp-1', nome: 'Campanha de script (teste)', zona_id: 'zona-7', status: 'ativa' }],
    // Etapas do script (22/08/2026 — imagem por etapa, ver
    // sql/SIME_campanha_etapas_imagem.sql). Etapa 1 e 3 têm imagem própria;
    // etapa 2 não tem nenhuma — usada pra confirmar que a ausência de
    // imagem numa etapa não "herda" a de outra etapa por engano.
    campanhaEtapas: [
      { campanha_id: 'camp-1', etapa_numero: 1, mensagem: 'Etapa 1: você confirma presença?',
        imagem_url: 'https://exemplo.com/etapa1.jpg',
        respostas_esperadas: [
          { intencao: 'sim', palavras_chave: ['sim'], proxima_etapa: 2, status_final: null },
          { intencao: 'nao', palavras_chave: ['nao', 'não'], proxima_etapa: null, status_final: 'telefone_incorreto' },
        ] },
      { campanha_id: 'camp-1', etapa_numero: 2, mensagem: 'Etapa 2: qual seção você atua?',
        imagem_url: null, respostas_esperadas: [] },
      { campanha_id: 'camp-1', etapa_numero: 3, mensagem: 'Etapa 3: obrigado!',
        imagem_url: 'https://exemplo.com/etapa3.jpg', respostas_esperadas: [] },
    ],
    logs: [], now: AGORA, ops: [],
  };
}

const { default: handler } = await import(pathToFileURL(_H).href);
function mkRes() { return { code: null, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } }; }
async function call(method, headers, body) { const res = mkRes(); await handler({ method, headers, body }, res); return res; }
const Z7 = { authorization: 'Bearer segredo7' };

// ── PENDENTES expõe campanha_id/etapa_atual ──
resetDB();
{
  const r = await call('POST', Z7, { acao: 'pendentes' });
  const cs = r.body?.campanhas || [];
  const s1 = cs.find(c => c.id === 's1');
  const l1 = cs.find(c => c.id === 'l1');
  check('item de script sai na fila', !!s1);
  check('item de script traz campanha_id', s1?.campanha_id === 'camp-1', String(s1?.campanha_id));
  check('item de script traz etapa_atual', s1?.etapa_atual === 1, String(s1?.etapa_atual));
  check('item de script vira proxima_acao=enviar_etapa_script', s1?.proxima_acao === 'enviar_etapa_script', s1?.proxima_acao);
  check('item legado continua com campanha_id null', l1?.campanha_id === null, String(l1?.campanha_id));
  check('item legado continua com proxima_acao=enviar (sem regressão)', l1?.proxima_acao === 'enviar', l1?.proxima_acao);
}

// ── CONFIRMAR sem novo_status explícito: script vira aguardando_resposta ──
resetDB();
{
  await call('POST', Z7, { acao: 'confirmar', ids: ['s1'] });
  const s1 = globalThis.__SUPA.campanhas.find(c => c.id === 's1');
  check('script sem novo_status vira aguardando_resposta (não enviado)', s1.status === 'aguardando_resposta', s1.status);
  check('script confirmado grava ts_enviado', s1.ts_enviado === AGORA, String(s1.ts_enviado));
  check('script confirmado incrementa tentativas', s1.tentativas === 1, String(s1.tentativas));

  // O ponto central do bug original: o item TEM que continuar aparecendo em
  // 'pendentes' (agora como aguardando_resposta) — antes da correção ele
  // virava 'enviado' e desaparecia da fila pra sempre.
  const depois = await call('POST', Z7, { acao: 'pendentes' });
  const aindaExiste = (depois.body?.campanhas || []).some(c => c.id === 's1');
  check('script continua rastreável depois de confirmar (não sumiu da fila)', globalThis.__SUPA.campanhas.some(c => c.id === 's1' && c.status === 'aguardando_resposta'));
}

// ── CONFIRMAR sem novo_status explícito: item legado continua virando enviado (sem regressão) ──
resetDB();
{
  await call('POST', Z7, { acao: 'confirmar', ids: ['l1'] });
  const l1 = globalThis.__SUPA.campanhas.find(c => c.id === 'l1');
  check('legado sem novo_status continua virando enviado (comportamento de sempre)', l1.status === 'enviado', l1.status);
}

// ── CONFIRMAR com novo_status explícito continua sendo respeitado pro script ──
resetDB();
{
  await call('POST', Z7, { acao: 'confirmar', ids: ['s1'], novo_status: 'finalizado' });
  const s1 = globalThis.__SUPA.campanhas.find(c => c.id === 's1');
  check('novo_status explícito ainda vale pra item de script', s1.status === 'finalizado', s1.status);
}

// ── Lote misto: script e legado no mesmo confirmar, cada um com seu default ──
resetDB();
{
  await call('POST', Z7, { acao: 'confirmar', ids: ['s1', 'l1'] });
  const s1 = globalThis.__SUPA.campanhas.find(c => c.id === 's1');
  const l1 = globalThis.__SUPA.campanhas.find(c => c.id === 'l1');
  check('lote misto: script vira aguardando_resposta', s1.status === 'aguardando_resposta', s1.status);
  check('lote misto: legado vira enviado', l1.status === 'enviado', l1.status);
}

// ── "Controle total das campanhas" (21/08/2026): todo disparo agora exige
// campanha_id, mesmo os modelos simples (golpe/livre/convocação) — não só
// script. Isso NÃO pode fazer um item simples ser tratado como script (nem
// no proxima_acao de 'pendentes', nem no default de status de 'confirmar')
// — só etapa_atual preenchido é sinal de script de verdade. ──
resetDB();
globalThis.__SUPA.campanhas.push({
  id: 'c1', ator_id: 'a3', zona_id: 'zona-7', telefone_whatsapp: '558611110003',
  mensagem_enviada: 'Alerta anti-golpe de sempre.', status: 'pendente', tentativas: 0,
  created_at: '2026-10-04T09:10:00.000Z', campanha_id: 'camp-2', etapa_atual: null,
});
globalThis.__SUPA.campanhasEntidade.push({ id: 'camp-2', nome: 'Campanha simples (com campanha_id, sem script)', zona_id: 'zona-7', status: 'ativa' });
{
  const r1 = await call('POST', Z7, { acao: 'pendentes' });
  const c1 = r1.body.campanhas.find(c => c.id === 'c1');
  check('item simples COM campanha_id ainda sai na fila', !!c1, JSON.stringify(r1.body));
  check('item simples com campanha_id NÃO vira enviar_etapa_script (só etapa_atual decide)', c1?.proxima_acao === 'enviar', c1?.proxima_acao);

  await call('POST', Z7, { acao: 'confirmar', ids: ['c1'] });
  const depois = globalThis.__SUPA.campanhas.find(c => c.id === 'c1');
  check('confirmar sem novo_status: item simples com campanha_id ainda vira enviado (não aguardando_resposta)', depois.status === 'enviado', depois.status);
}

// ── Campanha pausada/rascunho/encerrada: pendentes NÃO entrega os itens dela (script ou não) ──
resetDB();
{
  globalThis.__SUPA.campanhasEntidade.find(c => c.id === 'camp-1').status = 'pausada';
  const r = await call('POST', Z7, { acao: 'pendentes' });
  check('item de campanha pausada some da fila', !r.body.campanhas.some(c => c.id === 's1'), JSON.stringify(r.body.campanhas.map(c => c.id)));
  check('item legado (sem campanha_id) continua saindo normalmente', r.body.campanhas.some(c => c.id === 'l1'));
}

// ── Imagem por etapa (22/08/2026, sql/SIME_campanha_etapas_imagem.sql) ──
// A imagem pertence à ETAPA (sime_campanha_etapas.imagem_url), não à linha
// de fila — pendentes/avancar_etapa precisam resolver a imagem certa pra
// cada etapa, sem herdar a de uma etapa vizinha.

// PENDENTES (primeiro envio, etapa 1): imagem_url vem da etapa 1
resetDB();
{
  const r = await call('POST', Z7, { acao: 'pendentes' });
  const s1 = (r.body?.campanhas || []).find(c => c.id === 's1');
  check('primeiro envio (enviar_etapa_script) traz imagem_url da etapa 1',
    s1?.imagem_url === 'https://exemplo.com/etapa1.jpg', String(s1?.imagem_url));
}

// PENDENTES (reenvio, ainda na etapa 1): continua trazendo a imagem da etapa 1
resetDB();
{
  const s1 = globalThis.__SUPA.campanhas.find(c => c.id === 's1');
  s1.status = 'aguardando_resposta';
  s1.ts_enviado = '2026-10-02T10:00:00.000Z'; // fora da janela de RETRY_HORAS (24h antes de AGORA)
  const r = await call('POST', Z7, { acao: 'pendentes' });
  const item = (r.body?.campanhas || []).find(c => c.id === 's1');
  check('reenvio vira proxima_acao=reenviar_etapa_script', item?.proxima_acao === 'reenviar_etapa_script', item?.proxima_acao);
  check('reenvio da etapa 1 traz a imagem da etapa 1', item?.imagem_url === 'https://exemplo.com/etapa1.jpg', String(item?.imagem_url));
}

// PENDENTES (reenvio, já avançado pra etapa 2, sem imagem própria): não pode
// herdar a imagem da etapa 1 — tem que resolver null pra etapa 2.
resetDB();
{
  const s1 = globalThis.__SUPA.campanhas.find(c => c.id === 's1');
  s1.status = 'aguardando_resposta';
  s1.etapa_atual = 2;
  s1.ts_enviado = '2026-10-02T10:00:00.000Z';
  const r = await call('POST', Z7, { acao: 'pendentes' });
  const item = (r.body?.campanhas || []).find(c => c.id === 's1');
  check('reenvio da etapa 2 usa a mensagem da etapa 2 (não a etapa 1 congelada)',
    item?.mensagem === 'Etapa 2: qual seção você atua?', item?.mensagem);
  check('reenvio da etapa 2 (sem imagem própria) resolve imagem_url null, não herda a da etapa 1',
    item?.imagem_url === null, String(item?.imagem_url));
}

// AVANCAR_ETAPA (não-terminal, destino sem imagem): proxima_imagem_url null
resetDB();
{
  const r = await call('POST', Z7, { acao: 'avancar_etapa', item_id: 's1', etapa_atual: 1, intencao: 'sim', proxima_etapa: 2, resposta_texto: 'sim' });
  check('avancar_etapa devolve a mensagem da etapa de destino', r.body?.proxima_mensagem === 'Etapa 2: qual seção você atua?', r.body?.proxima_mensagem);
  check('avancar_etapa pra etapa sem imagem devolve proxima_imagem_url null', r.body?.proxima_imagem_url === null, JSON.stringify(r.body));
}

// AVANCAR_ETAPA (não-terminal, destino COM imagem): proxima_imagem_url correta
resetDB();
{
  const r = await call('POST', Z7, { acao: 'avancar_etapa', item_id: 's1', etapa_atual: 2, intencao: 'ok', proxima_etapa: 3, resposta_texto: 'ok' });
  check('avancar_etapa pra etapa com imagem devolve proxima_imagem_url certa',
    r.body?.proxima_imagem_url === 'https://exemplo.com/etapa3.jpg', JSON.stringify(r.body));
}

// AVANCAR_ETAPA (terminal): não deve trazer proxima_imagem_url nenhuma
resetDB();
{
  const r = await call('POST', Z7, { acao: 'avancar_etapa', item_id: 's1', etapa_atual: 1, intencao: 'nao', status_final: 'telefone_incorreto', resposta_texto: 'não' });
  check('avancar_etapa terminal não inclui proxima_imagem_url', r.body?.proxima_imagem_url === undefined, JSON.stringify(r.body));
  check('avancar_etapa terminal grava o status_final pedido', globalThis.__SUPA.campanhas.find(c => c.id === 's1')?.status === 'telefone_incorreto');
}

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
