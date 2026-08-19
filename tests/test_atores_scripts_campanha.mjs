// Testa a aba "🧩 Scripts de campanha" de SIME_atores.html
// (modules/sime_campanha_script_editor.js) — dois achados da revisão de
// 19/08/2026:
//
//   1. Remover uma etapa que outro ramo apontava como destino deixava
//      proxima_etapa órfão sem limpar, e "Salvar script" só checava
//      truthiness (não se a etapa referenciada ainda existia) — dava pra
//      salvar um script com referência quebrada, que só falha em produção
//      quando o Hermes tenta avançar pra uma etapa inexistente.
//   2. scSalvarCampanha() gravava updated_at com new Date().toISOString()
//      em vez de sime_now() — única violação da regra 6 do CLAUDE.md
//      ("nunca Date.now()/new Date() pra timestamp de ação") no PR.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

// Sentinela bem distante de "agora" — se o código usasse new Date() por
// engano, o valor gravado não bateria com isso de jeito nenhum.
const SERVER_TS = '2030-01-01T00:00:00.000Z';

const STUB_SUPABASE_JS = `
class QB {
  constructor(t){ this.t=t; this.f={}; this._op=null; }
  select(){ return this; }
  eq(c,v){ this.f[c]=v; return this; }
  order(){ return this; }
  single(){ return this.maybeSingle(); }
  maybeSingle(){
    const r=(window.__mock[this.t]||[]).filter(x=>Object.entries(this.f).every(([k,v])=>x[k]===v));
    return Promise.resolve({ data:r[0]??null, error:null });
  }
  delete(){ this._op='delete'; return this; }
  update(p){ this._op='update'; this._payload=p; return this; }
  insert(p){
    if(this._op==='update'){ /* unreachable */ }
    window.__mock.escritas.push({ op:'insert', tabela:this.t, payload:p });
    if(this.t==='sime_campanhas'){ const row={ id:'camp-novo', ...((Array.isArray(p)?p[0]:p)) }; window.__mock.sime_campanhas.push(row); return { select(){ return { single(){ return Promise.resolve({ data:{id:row.id}, error:null }); } }; } }; }
    return Promise.resolve({ error:null });
  }
  then(res){
    if(this._op==='update'){
      window.__mock.escritas.push({ op:'update', tabela:this.t, payload:this._payload, filtro:{...this.f} });
      const rows=(window.__mock[this.t]||[]);
      const idx=rows.findIndex(x=>Object.entries(this.f).every(([k,v])=>x[k]===v));
      if(idx>-1) rows[idx]={...rows[idx], ...this._payload};
      return res({ error:null });
    }
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
    rpc(name){ window.__mock.rpcChamadas.push(name); return Promise.resolve({ data: '${SERVER_TS}', error:null }); },
    auth: {
      async getSession(){ return { data:{ session: window.__mock.semSessao ? null : { user:{ id:'auth-maria' } } } }; },
      async getUser(){ return { data:{ user:{ id:'auth-maria' } } }; },
    },
  };
}
`;

function mock({ comCampanhaExistente = false } = {}) {
  return {
    escritas: [], rpcChamadas: [],
    sime_usuarios: [{ id:'u-maria', nome:'Maria', perfil:'coordenador', zona_id:'z7', ativo:true, auth_user_id:'auth-maria' }],
    sime_secoes: [],
    sime_contatos_externos: [],
    sime_atores: [],
    sime_campanhas: comCampanhaExistente
      ? [{ id:'camp-1', nome:'Convocação mesários', zona_id:'z7', status:'rascunho', created_at:'2026-08-01T09:00:00Z' }]
      : [],
    sime_campanha_etapas: comCampanhaExistente
      ? [{ id:'et-1', campanha_id:'camp-1', etapa_numero:1, mensagem:'Você confirma presença?', etapa_inicial:true, respostas_esperadas:[{ intencao:'sim', palavras_chave:['sim'], proxima_etapa:null, acao:'', status_final:'confirmado' }] }]
      : [],
  };
}

async function abrir(ctx, m) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((x) => { window.__mock = x; }, m);
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status:200, contentType:'application/javascript', body: STUB_SUPABASE_JS }));
  await p.goto('http://localhost:8917/modules/SIME_atores.html');
  await p.waitForTimeout(600);
  await p.click('#tab-scripts-btn');
  await p.waitForTimeout(300);
  return { p, erros };
}

// ── 1. Remover etapa referenciada limpa o ramo órfão e trava o salvar ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await p.click('text=+ Nova campanha');
  await p.waitForTimeout(150);
  // Com só a etapa 1 presente, a página tem exatamente 3 <input type=text>
  // em ordem de documento: nome da campanha, intenção do ramo, palavras-chave
  // do ramo — mais simples e confiável que filtrar por texto (".import-card"
  // aninhado do card da campanha inteira com o card de cada etapa faz
  // ".filter({hasText})" casar os dois, embaralhando a ordem dos inputs).
  await p.locator('input[type=text]').nth(0).fill('Script de teste');

  // etapa 1: mensagem + 1 ramo com palavra-chave
  const textareas = p.locator('textarea');
  await textareas.nth(0).fill('Mensagem da etapa 1');
  await p.locator('input[type=text]').nth(2).fill('sim, confirmo'); // nth(1)=intenção, nth(2)=palavras-chave

  // adiciona etapa 2 — precisa de ramo válido também (palavras-chave +
  // destino), senão podeSalvar fica false só por causa DELA, mascarando o
  // que este teste quer isolar (a referência órfã da etapa 1).
  await p.click('text=+ Adicionar etapa');
  await p.waitForTimeout(150);
  const textareas2 = p.locator('textarea');
  await textareas2.nth(1).fill('Mensagem da etapa 2');
  // Com 2 etapas: inputs de texto em ordem = nome(0), etapa1 intenção(1),
  // etapa1 palavras(2), etapa2 intenção(3), etapa2 palavras(4).
  await p.locator('input[type=text]').nth(4).fill('ok');
  await p.locator('select').nth(1).selectOption('final:confirmado'); // etapa 2 se autoencerra

  // aponta o ramo da etapa 1 pra etapa 2 — 1º <select> da página é sempre o
  // destino do ramo da etapa 1 (ela sempre renderiza primeiro).
  await p.locator('select').first().selectOption('etapa:2');
  await p.waitForTimeout(150);

  const podeSalvarAntes = await p.locator('button:has-text("💾 Salvar script")').isEnabled();
  check('com destino válido (etapa 2), salvar fica habilitado', podeSalvarAntes);

  // remove a etapa 2 — o ramo da etapa 1 que apontava pra ela deveria ficar órfão.
  // Não dá pra filtrar o card por texto "Etapa 2": o <select> de destino da
  // etapa 1 lista "Etapa 2 — ..." como opção, então esse texto também aparece
  // dentro do card DA ETAPA 1 — ".import-card:has-text('Etapa 2')" casa os
  // dois cards. Etapa 2 é sempre a última renderizada (foi a última
  // adicionada), então o último botão "Remover etapa" no documento é o dela.
  await p.locator('button:has-text("✕ Remover etapa")').last().click();
  await p.waitForTimeout(150);

  const podeSalvarDepois = await p.locator('button:has-text("💾 Salvar script")').isEnabled();
  check('remover a etapa referenciada desabilita salvar (referência órfã barrada)', !podeSalvarDepois);

  const toastTxt = await p.locator('.toast').textContent().catch(() => '');
  check('avisa quantos ramos ficaram sem destino', /sem destino/.test(toastTxt || ''), toastTxt);

  // corrige apontando pra um status final — deve voltar a habilitar
  await p.locator('select').first().selectOption('final:confirmado');
  await p.waitForTimeout(150);
  const podeSalvarCorrigido = await p.locator('button:has-text("💾 Salvar script")').isEnabled();
  check('corrigir o destino reabilita salvar', podeSalvarCorrigido);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Editar campanha existente grava updated_at com sime_now(), não new Date() ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock({ comCampanhaExistente: true }));
  await p.click('text=Convocação mesários');
  await p.waitForTimeout(200);
  await p.fill('.import-card input[type=text]', 'Convocação mesários (editado)');
  await p.click('button:has-text("💾 Salvar script")');
  await p.waitForTimeout(200);

  const updateCampanha = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_campanhas'));
  check('salvar campanha existente chama update em sime_campanhas', !!updateCampanha);
  check('update usa a hora do servidor (sime_now via rpc), não new Date()', updateCampanha?.payload?.updated_at === '2030-01-01T00:00:00.000Z', JSON.stringify(updateCampanha));
  const chamouRpc = await p.evaluate(() => window.__mock.rpcChamadas.includes('sime_now'));
  check('chamou a RPC sime_now', chamouRpc);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
