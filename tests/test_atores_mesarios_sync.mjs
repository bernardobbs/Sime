// Testa as abas novas de SIME_atores.html:
//   🔄 Sincronizar mesários — upload do CSV exportado da planilha (mesmo
//   cabeçalho de base geral MRV/Base Geral Apoio especializado, confirmado
//   em 20/08/2026) direto pro sime_mesarios_raw + RPC sime_sync_atores_from_raw,
//   sem precisar gerar SQL manualmente.
//   📊 Resumo por Seção — status dos 4 cargos de mesa por seção, usando
//   sime_atores.confirmacao (o status real do SIME, via WhatsApp/Hermes).
import pw from 'playwright';
import { writeFileSync, unlinkSync } from 'node:fs';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const MS_HEADERS = [
  "Processo Eleitoral","Pleito","UF de trabalho","Zona eleitoral de trabalho","Inscrição",
  "CPF (eleitor)","CPF (dados mesário)","Nome civil","Nome Social","Data de nascimento",
  "Tipo telefone 1 (eleitor)","Telefone 1 (eleitor)","Tipo telefone 2 (eleitor)","Telefone 2 (eleitor)",
  "Telefone contato (eleitor)","Tipo telefone pessoal (dados mesário)","Telefone pessoal (dados mesário)",
  "Tipo telefone comercial (dados mesário)","Telefone comercial (dados mesário)","E-mail (eleitor)",
  "E-mail (dados mesário)","Tipo correspondência","Grau de instrução (eleitor)","Grau de instrução (dados mesário)",
  "Ocupação (eleitor)","Ocupação (dados mesário)","Excluído de eleição futura",
  "Data limite exclusão de eleição futura","Observação (dados mesário)","Possui carro","Experiência","ASE 205",
  "UF do endereço do eleitor","Código município do endereço do eleitor","Nome município do endereço do eleitor",
  "Endereço do eleitor","Bairro do eleitor","CEP do eleitor","Zona eleitoral do eleitor","UF (dados mesário)",
  "Código município (dados mesário)","Nome município (dados mesário)","Endereço (dados mesário)",
  "Bairro (dados mesário)","CEP (dados mesário)","UF comercial (dados mesário)",
  "Código município comercial (dados mesário)","Nome município comercial (dados mesário)",
  "Endereço comercial (dados mesário)","Bairro comercial (dados mesário)","CEP comercial (dados mesário)",
  "Nome de empresa","Função na empresa","Código município local de trabalho","Nome município local de trabalho",
  "Bairro","CEP","Número do Local de votação local de trabalho","Nome do local de votação local de trabalho",
  "Descrição local de trabalho","Seção local de trabalho","MRJ local de trabalho","UF de votação do eleitor",
  "Código município de votação do eleitor","Nome município de votação do eleitor","Bairro de votação do eleitor",
  "CEP de votação do eleitor","Número do local de votação do eleitor","Nome do local de votação do eleitor",
  "Número da seção de votação do eleitor","Tipo função eleitoral","Descrição função eleitoral","Data atribuição",
  "Data convocação","Data nomeação","Data atualização (dados mesário)","Data último RAE","Confirmou convocação",
  "Origem da resposta","Data de resposta","Justificativa",
];
// sentinela — se o mapeamento por posição/nome quebrar, o teste de contagem falha
check('fixture: 81 colunas (mesmo formato da planilha)', MS_HEADERS.length === 81, String(MS_HEADERS.length));

function csvRow(vals) {
  return MS_HEADERS.map((h, i) => {
    const v = vals[h] ?? '';
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(',');
}
function baseRow(over) {
  return { "UF de trabalho": "PI", "Zona eleitoral de trabalho": "7", "Tipo função eleitoral": "MRV", ...over };
}
const CSV_PATH = '/tmp/_sime_test_mesarios.csv';
const linhas = [
  MS_HEADERS.join(','),
  csvRow(baseRow({ "Inscrição": "111", "Nome civil": "FULANO TESTE", "Nome município local de trabalho": "CAMPO MAIOR", "Seção local de trabalho": "30", "Descrição função eleitoral": "Presidente", "Telefone pessoal (dados mesário)": "86999990001", "Confirmou convocação": "Sim", "Origem da resposta": "WhatsApp" })),
  csvRow(baseRow({ "Inscrição": "222", "Nome civil": "CICLANO TESTE", "Nome município local de trabalho": "CAMPO MAIOR", "Seção local de trabalho": "30", "Descrição função eleitoral": "1º Mesário", "Telefone pessoal (dados mesário)": "86999990002" })),
  // zona diferente — precisa ser filtrada, nunca inserida no staging da zona 7
  csvRow(baseRow({ "Zona eleitoral de trabalho": "94", "Inscrição": "333", "Nome civil": "OUTRA ZONA", "Descrição função eleitoral": "Presidente" })),
];
writeFileSync(CSV_PATH, linhas.join('\n'), 'utf8');
process.on('exit', () => { try { unlinkSync(CSV_PATH); } catch (e) {} });

const STUB_SUPABASE_JS = `
class QB {
  constructor(t){ this.t=t; this.f={}; this._op=null; }
  select(){ return this; }
  eq(c,v){ this.f[c]=v; return this; }
  order(){ return this; }
  single(){ return this.maybeSingle(); }
  maybeSingle(){ const r=(window.__mock[this.t]||[]).filter(x=>Object.entries(this.f).every(([k,v])=>x[k]===v)); return Promise.resolve({ data:r[0]??null, error:null }); }
  delete(){ this._op='delete'; return this; }
  insert(p){
    const arr = Array.isArray(p) ? p : [p];
    window.__mock.escritas.push({ op:'insert', tabela:this.t, payload:arr });
    if(this.t==='sime_mesarios_raw') window.__mock.sime_mesarios_raw.push(...arr);
    return Promise.resolve({ error:null });
  }
  then(res){
    if(this._op==='delete'){
      window.__mock.escritas.push({ op:'delete', tabela:this.t, filtro:{...this.f} });
      window.__mock[this.t]=(window.__mock[this.t]||[]).filter(x=>!Object.entries(this.f).every(([k,v])=>x[k]===v));
      return res({ error:null });
    }
    const r=(window.__mock[this.t]||[]).filter(x=>Object.entries(this.f).every(([k,v])=>x[k]===v));
    return res({ data:r, error:null });
  }
}
export function createClient(){
  return {
    from(t){ return new QB(t); },
    channel(){ const c={ on(){return c;}, subscribe(){return c;} }; return c; },
    removeChannel(){},
    rpc(name, params){
      window.__mock.rpcChamadas.push({ name, params });
      if(name==='sime_sync_atores_from_raw') return Promise.resolve({ data:[{ atualizados:2, inativados:0 }], error:null });
      return Promise.resolve({ data:null, error:null });
    },
    auth: {
      async getSession(){ return { data:{ session: { user:{ id:'auth-maria' } } } }; },
      async getUser(){ return { data:{ user:{ id:'auth-maria' } } }; },
    },
  };
}
`;

function mock() {
  return {
    escritas: [], rpcChamadas: [],
    sime_usuarios: [{ id:'u-maria', nome:'Maria', perfil:'coordenador', zona_id:'z7', ativo:true, auth_user_id:'auth-maria' }],
    sime_zonas: [{ id:'z7', numero:7, estado:'PI' }],
    sime_contatos_externos: [], sime_campanhas: [], sime_campanha_etapas: [],
    sime_mesarios_raw: [],
    sime_secoes: [
      { id:'s30', numero:30, municipio:'Campo Maior', local_nome:'Grupo Escolar Marion Saraiva', zona_id:'z7', ativo:true },
      { id:'s63', numero:63, municipio:'Campo Maior', local_nome:'G.E. Treze de Março', zona_id:'z7', ativo:true },
    ],
    sime_atores: [
      { id:'a1', nome_completo:'ANA (s63)', funcao:'mesario', funcao_mesa:'Presidente', secao_id:'s63', zona_id:'z7', confirmacao:'confirmado', ativo:true },
      { id:'a2', nome_completo:'BRUNO (s63)', funcao:'mesario', funcao_mesa:'1º Mesário', secao_id:'s63', zona_id:'z7', confirmacao:'confirmado', ativo:true },
      { id:'a3', nome_completo:'CARLA (s63)', funcao:'mesario', funcao_mesa:'2º Mesário', secao_id:'s63', zona_id:'z7', confirmacao:'pendente', ativo:true },
      { id:'a4', nome_completo:'DIEGO (s63)', funcao:'mesario', funcao_mesa:'1º Secretário', secao_id:'s63', zona_id:'z7', confirmacao:'recusou', ativo:true },
      // s30 fica sem nenhum mesário — deve contar como "sem nenhum cargo designado"
    ],
  };
}

async function abrir(ctx, m) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((x) => { window.__mock = x; }, m);
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS }));
  await p.goto('http://localhost:8917/modules/SIME_atores.html');
  await p.waitForTimeout(500);
  return { p, erros };
}

// ── 1. Sincronizar mesários: upload + preview + gravação ──
{
  const ctx = await b.newContext();
  const m = mock();
  const { p, erros } = await abrir(ctx, m);
  await p.click('#tab-sync-mesarios-btn');
  await p.waitForTimeout(200);

  await p.setInputFiles('#ms-csv-input', CSV_PATH);
  await p.waitForTimeout(300);

  const preview = await p.locator('.import-result').first().textContent();
  check('preview mostra 3 registros carregados (antes do filtro por zona)', /3/.test(preview || ''), preview);
  check('preview lista Presidente e 1º Mesário', /Presidente/.test(preview) && /1º Mesário/.test(preview), preview);

  await p.click('button:has-text("✓ Sincronizar com o SIME")');
  await p.waitForTimeout(300);

  const del = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'delete' && e.tabela === 'sime_mesarios_raw'));
  check('sincronizar apaga staging antigo só da zona/UF certa', del?.filtro?.zona_eleitoral_trabalho === '7' && del?.filtro?.uf_trabalho === 'PI', JSON.stringify(del));

  const ins = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_mesarios_raw'));
  check('insere só as 2 linhas da zona 7 (a de zona 94 foi filtrada)', ins?.payload?.length === 2, String(ins?.payload?.length));
  check('linha inserida traz tipo_registro=MRV (da própria coluna, não adivinhado)', ins?.payload?.every(r => r.tipo_registro === 'MRV'));
  check('linha inserida traz confirmou_convocacao (controle da planilha, só auditoria)', ins.payload.some(r => r.confirmou_convocacao === 'Sim'));

  const rpc = await p.evaluate(() => window.__mock.rpcChamadas.find(c => c.name === 'sime_sync_atores_from_raw'));
  check('chama a RPC de sync com zona/UF certos', rpc?.params?.p_zona_numero === 7 && rpc?.params?.p_uf === 'PI', JSON.stringify(rpc));

  const resultado = await p.locator('.import-result:has-text("Sincronizado")').textContent().catch(() => '');
  check('mostra o resultado da sincronização (atualizados/inativados)', /2/.test(resultado || ''), resultado);

  const logCampanha = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs'));
  check('grava log de auditoria', !!logCampanha);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Formato errado: avisa em vez de aceitar silenciosamente ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await p.click('#tab-sync-mesarios-btn');
  await p.waitForTimeout(200);

  const badPath = '/tmp/_sime_test_mesarios_ruim.csv';
  writeFileSync(badPath, 'nome,telefone,secao,funcao\nFULANO,86999990000,0030,mesario\n', 'utf8');
  await p.setInputFiles('#ms-csv-input', badPath);
  await p.waitForTimeout(300);
  unlinkSync(badPath);

  const toastTxt = await p.locator('.toast').textContent().catch(() => '');
  check('formato errado (CSV simples) é rejeitado com aviso', /coluna|formato/i.test(toastTxt || ''), toastTxt);
  const semBotaoSincronizar = await p.locator('button:has-text("✓ Sincronizar com o SIME")').count();
  check('não oferece botão de sincronizar pra arquivo inválido', semBotaoSincronizar === 0);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. Resumo por Seção: status real (sime_atores.confirmacao), não o da planilha ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await p.click('#tab-resumo-secoes-btn');
  await p.waitForTimeout(300);

  const bodyTxt = await p.locator('.import-card').textContent();
  check('mostra 2 seções mapeadas', /2.*seções mapeadas|seções mapeadas/i.test(bodyTxt || ''), bodyTxt.slice(0, 200));
  check('conta 1 seção sem nenhum cargo designado (s30)', /1.*sem nenhum cargo designado/.test(bodyTxt.replace(/\s+/g, ' ')), bodyTxt.replace(/\s+/g, ' ').slice(0, 300));

  const linhaS63 = await p.locator('tr:has-text("63")').textContent();
  check('seção 63: mostra ✅ (Presidente confirmado)', linhaS63.includes('✅'));
  check('seção 63: mostra 🔶 (2º Mesário pendente)', linhaS63.includes('🔶'));
  check('seção 63: mostra ⚠️ (1º Secretário recusou)', linhaS63.includes('⚠️'));

  const linhaS30 = await p.locator('tr:has-text("30")').textContent();
  check('seção 30 (sem ninguém): 4x ❌', (linhaS30.match(/❌/g) || []).length === 4, linhaS30);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
