// ══════════════════════════════════════
// DASHBOARD — situação geral da zona em dois níveis: por LOCAL DE VOTAÇÃO
// (agrega as seções que dividem o mesmo prédio) e, ao clicar num local, por
// SEÇÃO (os 4 cargos de mesa). Usa o status de confirmação REAL do SIME
// (sime_atores.confirmacao, gravado por api/hermes-mesarios.js quando a
// pessoa responde pelo WhatsApp) — não o "Confirmou convocação" da
// planilha, que é um controle humano paralelo e não chega a sime_atores
// (ver sime_mesarios_sync.js).
//
// sime_secoes não tem id próprio de "local de votação" — o agrupamento é
// por (local_nome + município). Endereço do local (rua/povoado) também não
// existe no schema hoje, então os cards mostram local + município, não
// endereço completo.
// ══════════════════════════════════════

const RS_CARGOS = ['Presidente', '1º Mesário', '2º Mesário', '1º Secretário'];

let rsDados = null;      // { secoes:[...], porSecao:{}, totalMesarios, totalApoio }
let rsBusca = '';
let rsModo = 'grade';    // 'grade' | 'lista'
let rsLocalAberto = null; // chave `${local_nome}|||${municipio}` do local em drilldown, ou null

async function rsCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { rsDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: secoes, error: e1 }, { data: atores, error: e2 }, { count: totalApoio }] = await Promise.all([
    sb.from('sime_secoes').select('id, numero, municipio, local_nome, eleitores').eq('zona_id', zonaId).eq('ativo', true).order('numero'),
    sb.from('sime_atores').select('nome_completo, secao_id, funcao_mesa, confirmacao, precisa_substituir, data_confirmacao').eq('zona_id', zonaId).eq('funcao', 'mesario').eq('ativo', true),
    sb.from('sime_atores').select('id', { count: 'exact', head: true }).eq('zona_id', zonaId).eq('ativo', true).in('funcao', ['coord_acessibilidade', 'auxiliar_eleicao']),
  ]);
  if (e1 || e2) { rsDados = { erro: (e1 || e2).message }; render(); return; }

  const porSecao = {};
  const atualizadoPorSecao = {};
  for (const a of atores || []) {
    if (!a.secao_id || !a.funcao_mesa) continue;
    if (!porSecao[a.secao_id]) porSecao[a.secao_id] = {};
    // Se por algum motivo houver mais de um ativo no mesmo cargo, fica o
    // "melhor" status (confirmado > pendente > recusou) — melhor mostrar
    // otimista do que esconder que alguém já confirmou. Guarda o ator
    // inteiro agora (não só a string de confirmacao) — o card da seção
    // mostra o nome de quem está designado, não só um ícone.
    const atual = porSecao[a.secao_id][a.funcao_mesa];
    const prioridade = { confirmado: 3, pendente: 2, substituido: 1, recusou: 1, contato_incorreto: 1 };
    if (!atual || (prioridade[a.confirmacao] || 0) >= (prioridade[atual.confirmacao] || 0)) {
      porSecao[a.secao_id][a.funcao_mesa] = a;
    }
    if (a.data_confirmacao && (!atualizadoPorSecao[a.secao_id] || a.data_confirmacao > atualizadoPorSecao[a.secao_id])) {
      atualizadoPorSecao[a.secao_id] = a.data_confirmacao;
    }
  }
  rsDados = {
    secoes: secoes || [], porSecao, atualizadoPorSecao,
    totalMesarios: (atores || []).length, totalApoio: totalApoio || 0,
  };
  render();
}

function rsEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Recebe o ator inteiro (não só a string de confirmacao) pra poder mostrar o
// nome e sinalizar precisa_substituir — flag manual do cartório, distinta de
// confirmacao='substituido' (que é o status já resolvido). Uma pessoa
// confirmada pode ser marcada pra substituição depois (ex.: virou inelegível)
// — por isso esse flag tem prioridade visual sobre o confirmacao normal.
function rsStatusCargo(ator) {
  if (!ator) return { icone: '❌', label: 'Sem designação', cls: 'rs-sem', nome: null };
  const nome = ator.nome_completo;
  if (ator.precisa_substituir) return { icone: '🔁', label: `Precisa ser substituído — ${nome}`, cls: 'rs-alerta', nome };
  if (ator.confirmacao === 'confirmado') return { icone: '✅', label: `Confirmado — ${nome}`, cls: 'rs-ok', nome };
  if (ator.confirmacao === 'recusou') return { icone: '⚠️', label: `Recusou — precisa substituto — ${nome}`, cls: 'rs-alerta', nome };
  if (ator.confirmacao === 'contato_incorreto') return { icone: '🔍', label: `Contato incorreto — ${nome}`, cls: 'rs-alerta', nome };
  return { icone: '🔶', label: `Aguardando confirmação — ${nome}`, cls: 'rs-aguardando', nome }; // pendente/substituido/outros
}

function rsFmtData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function rsAbrirLocal(chave) { rsLocalAberto = chave; render(); }
function rsFecharLocal() { rsLocalAberto = null; render(); }

function rsCalcular() {
  const linhas = rsDados.secoes.map(s => {
    const cargos = RS_CARGOS.map(cargo => rsStatusCargo(rsDados.porSecao[s.id]?.[cargo]));
    const designados = cargos.filter(x => x.cls !== 'rs-sem').length;
    const confirmados = cargos.filter(x => x.cls === 'rs-ok').length;
    return { secao: s, cargos, designados, confirmados, atualizado: rsDados.atualizadoPorSecao[s.id] };
  });

  const porLocalMap = {};
  for (const l of linhas) {
    const chave = `${l.secao.local_nome || '(sem local)'}|||${l.secao.municipio || ''}`;
    if (!porLocalMap[chave]) porLocalMap[chave] = { chave, local_nome: l.secao.local_nome, municipio: l.secao.municipio, secoes: [] };
    porLocalMap[chave].secoes.push(l);
  }
  const porLocal = Object.values(porLocalMap).map(loc => {
    const totalCargos = loc.secoes.length * RS_CARGOS.length;
    const designados = loc.secoes.reduce((n, l) => n + l.designados, 0);
    const confirmados = loc.secoes.reduce((n, l) => n + l.confirmados, 0);
    const semNenhumNoLocal = loc.secoes.filter(l => l.designados === 0).length;
    const pct = totalCargos ? Math.round((designados / totalCargos) * 100) : 0;
    return { ...loc, totalCargos, designados, confirmados, semNenhumNoLocal, pct };
  }).sort((a, b) => (a.local_nome || '').localeCompare(b.local_nome || ''));

  return { linhas, porLocal };
}

function rsBarraCor(pct) {
  if (pct === 0) return 'var(--red)';
  if (pct >= 100) return 'var(--green)';
  return 'var(--blue)';
}

function rsCardLocal(loc) {
  const cor = rsBarraCor(loc.pct);
  return `
    <div class="import-card" style="cursor:pointer;padding:14px 16px" onclick="rsAbrirLocal('${loc.chave.replace(/'/g, "\\'")}')">
      <div style="font-weight:800;font-size:.86rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${loc.local_nome || '(sem local)'}">${loc.local_nome || '(sem local)'}</div>
      <div class="ic-sub" style="margin-bottom:8px;display:flex;align-items:center;gap:4px">📍 ${loc.municipio || ''}</div>
      <div style="display:flex;justify-content:space-between;font-size:.76rem;color:var(--text2);margin-bottom:4px">
        <span>Seções<br><b style="color:var(--text);font-size:.9rem">${String(loc.secoes.length).padStart(2, '0')}</b></span>
        <span style="text-align:right">Mesários<br><b style="color:var(--text);font-size:.9rem">${loc.designados}/${loc.totalCargos}</b></span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <div style="flex:1;height:6px;border-radius:99px;background:var(--bg2);overflow:hidden">
          <div style="height:100%;width:${Math.min(loc.pct, 100)}%;background:${cor};border-radius:99px"></div>
        </div>
        <span style="font-size:.72rem;font-weight:700;color:${cor};white-space:nowrap">${loc.pct}%</span>
      </div>
    </div>`;
}

function rsLinhaLocal(loc) {
  const cor = rsBarraCor(loc.pct);
  return `
    <div class="import-card" style="cursor:pointer;padding:10px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap" onclick="rsAbrirLocal('${loc.chave.replace(/'/g, "\\'")}')">
      <div style="flex:1;min-width:160px">
        <div style="font-weight:800;font-size:.84rem">${loc.local_nome || '(sem local)'}</div>
        <div class="ic-sub" style="margin-bottom:0">📍 ${loc.municipio || ''}</div>
      </div>
      <div style="font-size:.76rem;color:var(--text2);white-space:nowrap">Seções: <b style="color:var(--text)">${loc.secoes.length}</b></div>
      <div style="font-size:.76rem;color:var(--text2);white-space:nowrap">Mesários: <b style="color:var(--text)">${loc.designados}/${loc.totalCargos}</b></div>
      <div style="display:flex;align-items:center;gap:8px;width:140px">
        <div style="flex:1;height:6px;border-radius:99px;background:var(--bg2);overflow:hidden">
          <div style="height:100%;width:${Math.min(loc.pct, 100)}%;background:${cor};border-radius:99px"></div>
        </div>
        <span style="font-size:.72rem;font-weight:700;color:${cor}">${loc.pct}%</span>
      </div>
    </div>`;
}

function rsCardSecao(l) {
  return `
    <div class="import-card" style="padding:14px 16px;border-left:4px solid ${l.confirmados === 4 ? 'var(--green)' : l.designados === 0 ? 'var(--red)' : 'var(--blue)'}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div>
          <div style="font-size:1.6rem;font-weight:900">${l.secao.eleitores ?? '—'}</div>
          <div class="ic-sub" style="margin-bottom:0">eleitores — Seção ${l.secao.numero}</div>
        </div>
      </div>
      <div style="display:flex;gap:14px;margin-top:10px;flex-wrap:wrap">
        ${l.cargos.map((cg, i) => `
          <div style="text-align:center;max-width:78px" title="${rsEsc(cg.label)}">
            <div style="font-size:1.1rem">${cg.icone}</div>
            <div style="font-size:.68rem;color:var(--text2);margin-top:2px">${RS_CARGOS[i]}</div>
            ${cg.nome ? `<div style="font-size:.66rem;color:var(--text3);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${rsEsc(cg.nome.split(' ')[0])}</div>` : ''}
          </div>`).join('')}
      </div>
      <div class="ic-sub" style="margin-top:10px;margin-bottom:0">Atualizado em ${rsFmtData(l.atualizado)}</div>
    </div>`;
}

function renderResumoSecoes() {
  const c = document.getElementById('content');
  if (!window.supabaseAtores) {
    c.innerHTML = '<div class="import-card"><div class="import-result ir-warn">Entre com a conta da equipe pra ver o dashboard.</div></div>';
    return;
  }
  if (!rsDados) {
    c.innerHTML = '<div class="import-card"><div class="ic-title">📊 Dashboard</div><div class="ic-sub">Carregando…</div></div>';
    rsCarregar();
    return;
  }
  if (rsDados.erro) {
    c.innerHTML = `<div class="import-card"><div class="import-result ir-warn">⚠ ${rsDados.erro}</div></div>`;
    return;
  }

  const { linhas, porLocal } = rsCalcular();

  const statsHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
      <div class="import-card" style="border-left:4px solid #2e7d32;padding:14px 16px">
        <div class="ic-sub" style="margin-bottom:2px">Locais de votação</div>
        <div style="font-size:1.6rem;font-weight:900">${porLocal.length}</div>
      </div>
      <div class="import-card" style="border-left:4px solid #1565c0;padding:14px 16px">
        <div class="ic-sub" style="margin-bottom:2px">Seções</div>
        <div style="font-size:1.6rem;font-weight:900">${linhas.length}</div>
      </div>
      <div class="import-card" style="border-left:4px solid #e65100;padding:14px 16px">
        <div class="ic-sub" style="margin-bottom:2px">Mesários</div>
        <div style="font-size:1.6rem;font-weight:900">${rsDados.totalMesarios}</div>
      </div>
      <div class="import-card" style="border-left:4px solid #6a1b9a;padding:14px 16px">
        <div class="ic-sub" style="margin-bottom:2px">Apoio logístico</div>
        <div style="font-size:1.6rem;font-weight:900">${rsDados.totalApoio}</div>
      </div>
    </div>`;

  // ── Drilldown de um local: seções daquele local, com os 4 cargos ──
  if (rsLocalAberto) {
    const loc = porLocal.find(l => l.chave === rsLocalAberto);
    if (!loc) { rsLocalAberto = null; } else {
      c.innerHTML = `
        ${statsHTML}
        <div class="import-card" style="padding:12px 16px;display:flex;align-items:center;gap:10px">
          <button class="btn btn-out" style="padding:6px 12px;font-size:.76rem" onclick="rsFecharLocal()">← Voltar</button>
          <div>
            <div style="font-weight:800">${loc.local_nome || '(sem local)'}</div>
            <div class="ic-sub" style="margin-bottom:0">📍 ${loc.municipio || ''} — ${loc.secoes.length} seção(ões), ${loc.designados}/${loc.totalCargos} cargos designados</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
          ${loc.secoes.map(rsCardSecao).join('')}
        </div>`;
      return;
    }
  }

  // ── Grade/lista de locais de votação ──
  const q = rsBusca.trim().toLowerCase();
  const filtrados = q ? porLocal.filter(l => (l.local_nome || '').toLowerCase().includes(q) || (l.municipio || '').toLowerCase().includes(q)) : porLocal;
  const semNenhum = linhas.filter(l => l.designados === 0).length;
  const completas = linhas.filter(l => l.confirmados === 4).length;

  c.innerHTML = `
    ${statsHTML}
    <div class="import-card" style="padding:12px 16px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <input type="text" placeholder="🔍 Pesquisar local de votação…" value="${rsBusca.replace(/"/g, '&quot;')}" oninput="rsBusca=this.value;render()" style="flex:1;min-width:200px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
        <div style="display:flex;gap:4px">
          <button class="btn ${rsModo === 'grade' ? 'btn-dark' : 'btn-out'}" style="padding:7px 10px;font-size:.76rem" onclick="rsModo='grade';render()" aria-label="Ver em grade" aria-pressed="${rsModo === 'grade'}">▦</button>
          <button class="btn ${rsModo === 'lista' ? 'btn-dark' : 'btn-out'}" style="padding:7px 10px;font-size:.76rem" onclick="rsModo='lista';render()" aria-label="Ver em lista" aria-pressed="${rsModo === 'lista'}">☰</button>
        </div>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:.78rem;margin-top:10px">
        <div style="${semNenhum > 0 ? 'color:var(--red);font-weight:700' : 'color:var(--text2)'}">${semNenhum} seção(ões) sem nenhum cargo designado</div>
        <div style="color:var(--text2)">${completas} seção(ões) com mesa completa confirmada</div>
      </div>
    </div>
    ${filtrados.length ? (
      rsModo === 'grade'
        ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px">${filtrados.map(rsCardLocal).join('')}</div>`
        : `<div style="display:flex;flex-direction:column;gap:8px">${filtrados.map(rsLinhaLocal).join('')}</div>`
    ) : '<div class="import-card"><div class="ic-sub" style="margin-bottom:0">Nenhum local encontrado com essa busca.</div></div>'}`;
}
