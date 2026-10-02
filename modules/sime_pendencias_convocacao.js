// ══════════════════════════════════════
// PENDÊNCIAS DE CONVOCAÇÃO — quem já está no roster (convocado pelo TRE/ELO
// — é por isso que a pessoa existe em sime_atores) mas o SIME ainda não
// avançou o status pra "Convocado" nem "Confirmado". Pedido direto
// (03/09/2026): "quero um relatorio para saber todos que estão como
// convocados no elo e ainda não estão convocados ou confirmados no sime" —
// entregue primeiro como CSV avulso; virou tela permanente no mesmo dia:
// "pode fazer isso um relatorio do sime convocações? permanente? por
// exemplo, os mesários que copiamos o link e nunca foram marcados como
// convocados ou confirmados".
//
// "Convocado no ELO" = está ativo no roster sincronizado — nenhuma consulta
// extra ao staging é necessária, sime_atores JÁ É o roster. "Ainda não
// avançou no SIME" = confirmacao NOT IN ('convocado','confirmado') — inclui
// pendente/contato_incorreto/recusou. 'substituido' fica de fora de
// propósito: é um desfecho já resolvido (a vaga foi preenchida por outra
// pessoa), não uma pendência de contato — mesmo critério do CSV avulso
// entregue antes desta tela.
//
// Duas situações, mesmo critério de tentativas de sime_contatar_mesarios.js
// (cmCarregar — campanha 'enviado'/'aguardando_resposta' + sime_logs
// 'mesario_tentativa_contato', que inclui "copiou o link do WhatsApp pra
// confirmar contato"):
//   🔴 nunca contactado (tentativas === 0)
//   🟡 já contactado, mas nunca virou Convocado/Confirmado (tentativas > 0)
//      — é literalmente o exemplo do pedido ("copiamos o link e nunca
//      marcamos").
// ══════════════════════════════════════

let pcDados = null; // { pessoas:[...], secoesPorId:{} }
let pcFiltroSituacao = ''; // '' | 'nunca' | 'ja_contactado'
let pcFiltroFuncao = '';
let pcFiltroMunicipio = '';
let pcBusca = '';
let pcBuscaTimer = null;

async function pcCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { pcDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: pessoas, error: e1 }, { data: secoes, error: e2 }, { data: campanhas }, { data: tentativasManuais }] = await Promise.all([
    sb.from('sime_atores')
      .select('id, nome_completo, inscricao_eleitoral, telefone_whatsapp, funcao, funcao_mesa, secao_id, confirmacao, meio_contato')
      .eq('zona_id', zonaId).eq('ativo', true)
      .in('funcao', ['mesario', 'coord_acessibilidade', 'auxiliar_eleicao'])
      .not('confirmacao', 'in', '(convocado,confirmado,substituido)')
      .order('nome_completo'),
    sb.from('sime_secoes').select('id, numero, local_nome, municipio').eq('zona_id', zonaId),
    // Mesma fonte de "tentativas" que Contatar mesários — campanha enviada
    // (fluxo simples ou motor de script) OU tentativa manual registrada
    // (➕ Registrar tentativa / 🔗 Copiar link do WhatsApp).
    sb.from('sime_campanhas_confirmacao').select('ator_id, status, created_at').eq('zona_id', zonaId),
    sb.from('sime_logs').select('payload, ts').eq('acao', 'mesario_tentativa_contato'),
  ]);
  if (e1 || e2) { pcDados = { erro: (e1 || e2).message }; render(); return; }

  const tentativasPorAtor = {};
  const ultimaTentativaPorAtor = {};
  const marcaUltima = (atorId, ts) => {
    if (!atorId || !ts) return;
    if (!ultimaTentativaPorAtor[atorId] || ts > ultimaTentativaPorAtor[atorId]) ultimaTentativaPorAtor[atorId] = ts;
  };
  for (const c of campanhas || []) {
    if (c.status === 'enviado' || c.status === 'aguardando_resposta') {
      tentativasPorAtor[c.ator_id] = (tentativasPorAtor[c.ator_id] || 0) + 1;
      marcaUltima(c.ator_id, c.created_at);
    }
  }
  for (const l of tentativasManuais || []) {
    const atorId = l.payload?.ator_id;
    if (atorId) { tentativasPorAtor[atorId] = (tentativasPorAtor[atorId] || 0) + 1; marcaUltima(atorId, l.ts); }
  }

  const secoesPorId = Object.fromEntries((secoes || []).map(s => [s.id, s]));
  const pessoasProntas = (pessoas || []).map(p => ({
    ...p,
    sec: p.secao_id ? secoesPorId[p.secao_id] : null,
    tentativas: tentativasPorAtor[p.id] || 0,
    ultimaTentativaTs: ultimaTentativaPorAtor[p.id] || null,
  }));

  pcDados = { pessoas: pessoasProntas, secoesPorId };
  render();
}

function pcEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pcOnBuscaInput(v) {
  pcBusca = v;
  clearTimeout(pcBuscaTimer);
  pcBuscaTimer = setTimeout(render, 250);
}

function pcFiltrar(pessoas) {
  const q = pcBusca.trim().toLowerCase();
  return pessoas.filter(p => {
    if (pcFiltroSituacao === 'nunca' && p.tentativas > 0) return false;
    if (pcFiltroSituacao === 'ja_contactado' && p.tentativas === 0) return false;
    if (pcFiltroFuncao && p.funcao !== pcFiltroFuncao) return false;
    if (pcFiltroMunicipio && (p.sec?.municipio || '') !== pcFiltroMunicipio) return false;
    if (q && !(p.nome_completo || '').toLowerCase().includes(q) && !(p.inscricao_eleitoral || '').includes(q)) return false;
    return true;
  });
}

function pcExportarCSV() {
  if (!pcDados?.pessoas?.length) { if (window.showToast) window.showToast('⚠ Nada para exportar'); return; }
  const linhas = pcFiltrar(pcDados.pessoas);
  const headers = ['Município', 'Seção', 'Local de Votação', 'Nome', 'Função', 'Cargo de Mesa', 'Título de Eleitor', 'Status no SIME', 'Tentativas de Contato', 'Última Tentativa', 'Telefone'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linha = p => [
    p.sec?.municipio || '', p.sec?.numero || '', p.sec?.local_nome || '',
    p.nome_completo || '', cmRotuloFuncao(p), p.funcao === 'mesario' ? (p.funcao_mesa || '') : '',
    p.inscricao_eleitoral || '', cmBadge(p.confirmacao), p.tentativas,
    p.ultimaTentativaTs ? new Date(p.ultimaTentativaTs).toLocaleDateString('pt-BR') : '',
    p.telefone_whatsapp || '',
  ];
  const csv = [headers.map(esc).join(','), ...linhas.map(p => linha(p).map(esc).join(','))].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sime_pendencias_convocacao_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  if (window.showToast) window.showToast('✓ CSV exportado');
}

function renderPendenciasConvocacao() {
  const c = document.getElementById('content');
  if (!window.supabaseAtores) {
    c.innerHTML = '<div class="import-card"><div class="import-result ir-warn">Entre com a conta da equipe.</div></div>';
    return;
  }
  if (!pcDados) {
    c.innerHTML = '<div class="import-card"><div class="ic-title">🚦 Pendências de Convocação</div><div class="ic-sub">Carregando…</div></div>';
    pcCarregar();
    return;
  }
  if (pcDados.erro) {
    c.innerHTML = `<div class="import-card"><div class="import-result ir-warn">⚠ ${pcEsc(pcDados.erro)}</div></div>`;
    return;
  }

  const todos = pcDados.pessoas;
  const jaContactados = todos.filter(p => p.tentativas > 0);
  const municipios = [...new Set(todos.map(p => p.sec?.municipio).filter(Boolean))].sort();
  const lista = pcFiltrar(todos).sort((a, b) => (b.tentativas - a.tentativas) || (a.nome_completo || '').localeCompare(b.nome_completo || ''));

  c.innerHTML = `
    <div class="import-card">
      <div class="ic-title">🚦 Pendências de Convocação</div>
      <div class="ic-sub">Todo mundo que já está no roster do TRE (é por isso que consta aqui) mas cujo status no
        SIME ainda não chegou a <b>Convocado</b> nem <b>Confirmado</b> — nem sempre é falta de tentativa: às vezes o
        link já foi copiado, a carta já foi marcada como enviada, e ninguém voltou pra marcar o próximo passo.</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div class="import-result" style="margin-top:0">${todos.length} no total</div>
        <div class="import-result ir-warn" style="margin-top:0">🔴 ${todos.length - jaContactados.length} nunca contactado</div>
        <div class="import-result ir-warn" style="margin-top:0">🟡 ${jaContactados.length} já contactado, sem avanço</div>
      </div>
      ${jaContactados.length ? `
      <div class="import-result ir-warn" style="cursor:pointer" onclick="pcFiltroSituacao='ja_contactado';pcFiltroFuncao='';pcFiltroMunicipio='';pcBusca='';render()" title="Clique pra filtrar só esta lista">
        🟡 <b>${jaContactados.length} pessoa(s)</b> já tiveram alguma tentativa de contato (link copiado, carta marcada, campanha enviada) — mas ninguém marcou "Convocado" ou "Confirmado" depois.
        <div style="font-weight:400;margin-top:3px">${jaContactados.slice(0, 6).map(p => pcEsc(p.nome_completo)).join(', ')}${jaContactados.length > 6 ? ` e mais ${jaContactados.length - 6}` : ''}</div>
      </div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <select id="pc-filtro-situacao" onchange="pcFiltroSituacao=this.value;render()">
          <option value="" ${pcFiltroSituacao === '' ? 'selected' : ''}>Todas as situações (${todos.length})</option>
          <option value="nunca" ${pcFiltroSituacao === 'nunca' ? 'selected' : ''}>🔴 Nunca contactado (${todos.length - jaContactados.length})</option>
          <option value="ja_contactado" ${pcFiltroSituacao === 'ja_contactado' ? 'selected' : ''}>🟡 Já contactado, sem avanço (${jaContactados.length})</option>
        </select>
        <select id="pc-filtro-funcao" onchange="pcFiltroFuncao=this.value;render()">
          ${CM_FUNCAO_FILTRO.map(f => `<option value="${f.valor}" ${pcFiltroFuncao === f.valor ? 'selected' : ''}>${f.label}</option>`).join('')}
        </select>
        <select id="pc-filtro-municipio" onchange="pcFiltroMunicipio=this.value;render()">
          <option value="" ${pcFiltroMunicipio === '' ? 'selected' : ''}>Todos os municípios</option>
          ${municipios.map(m => `<option value="${pcEsc(m)}" ${pcFiltroMunicipio === m ? 'selected' : ''}>${pcEsc(m)}</option>`).join('')}
        </select>
        <input id="pc-busca" type="text" placeholder="Buscar por nome ou título de eleitor…" value="${pcEsc(pcBusca)}" oninput="pcOnBuscaInput(this.value)" style="flex:1;min-width:160px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="ic-sub" style="margin-bottom:0">${lista.length} de ${todos.length} pessoa(s)</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-out" style="font-size:.74rem;padding:6px 12px" onclick="pcDados=null;render()">🔄 Atualizar</button>
          <button class="btn btn-dark" style="font-size:.74rem;padding:6px 12px" onclick="pcExportarCSV()">⬇️ Exportar CSV</button>
        </div>
      </div>
    </div>
    <div class="cm-lista-pessoas" style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
      ${lista.length ? lista.map(p => `
        <div class="import-card" style="padding:12px 14px">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:flex-start">
            <div>
              <div style="font-weight:800;cursor:pointer" onclick="cmAbrirModal('${p.id}')" title="Clique para editar e ver histórico">${pcEsc(p.nome_completo)} <span style="font-weight:400;font-size:.78rem;color:var(--text2)">✎</span></div>
              <div class="ic-sub" style="margin-bottom:0">
                ${pcEsc(cmRotuloFuncao(p))}${p.sec ? ` — Seção ${p.sec.numero} (${pcEsc(p.sec.local_nome || '')}, ${pcEsc(p.sec.municipio || '')})` : ''}
              </div>
              ${p.inscricao_eleitoral ? `<div class="ic-sub" style="margin-bottom:0">Título ${pcEsc(p.inscricao_eleitoral)}</div>` : ''}
              ${p.telefone_whatsapp ? `<div class="ic-sub" style="margin-bottom:0">${fmtTelefone(p.telefone_whatsapp)}</div>` : '<div class="ic-sub" style="margin-bottom:0">Sem telefone cadastrado</div>'}
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
              <span class="import-result ir-warn" style="margin-top:0;white-space:nowrap">${cmBadge(p.confirmacao)}</span>
              <span class="import-result ${p.tentativas > 0 ? 'ir-warn' : ''}" style="margin-top:0;white-space:nowrap">
                ${p.tentativas > 0 ? `🟡 ${p.tentativas}x contactado${p.ultimaTentativaTs ? ` — última em ${new Date(p.ultimaTentativaTs).toLocaleDateString('pt-BR')}` : ''}` : '🔴 Nunca contactado'}
              </span>
            </div>
          </div>
        </div>`).join('') : '<div class="import-card"><div class="ic-sub" style="margin-bottom:0">Nenhuma pendência com esse filtro — ou já foi tudo pra Convocado/Confirmado, ou ainda não bate com a busca. 🎉</div></div>'}
    </div>`;
}
