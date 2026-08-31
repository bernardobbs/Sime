// ══════════════════════════════════════
// OFICIAL DE JUSTIÇA — aba "⚖️ Oficial de Justiça" de SIME_convocacao.html.
// Pedido direto (31/08/2026): "ELABORE MAIS UMA ABA PARA O OFICIAL DE
// JUSTIÇA CONTROLE A CONVOCAÇÃO DOS MESÁRIOS".
//
// Mesmo espírito da aba 📬 Correspondência (que cobre "Carta Registrada"),
// mas pro OUTRO meio de contato alternativo que já existia no cadastro
// (`sime_atores.meio_contato='oficial_justica'`, ver
// sql/SIME_atores_meio_contato.sql) e nunca tinha uma tela própria — ficava
// só dentro da fila geral de "📞 Contatar mesários", sem uma visão
// dedicada de quem está nessa fila nem uma relação pra entregar ao oficial.
//
// Reaproveita o que já existe em vez de duplicar:
// - `CM_MEIO_LABEL`/`cmStatusLabelSet` (sime_contatar_mesarios.js) — Carta
//   Registrada e Oficial de Justiça já compartilham o mesmo vocabulário de
//   status (a_enviar/enviado/entregue/devolvido).
// - `coEnderecoDestinatario()`/`coFmtCep()` (sime_correspondencia.js) — o
//   endereço vem da mesma fonte (sime_mesarios_raw, casando por título de
//   eleitor, mesma prioridade dados do mesário → eleitor → comercial).
// - `cmLog()` (grava com autor) usando a MESMA ação `mesario_status_contato_alt`
//   que o modal de "Contatar mesários" já usa — assim uma mudança de status
//   feita aqui aparece certinho na timeline "📜 Atualizações" da pessoa lá,
//   sem duplicar rótulo de log nem criar uma ação nova.
//
// Diferente da Correspondência: aqui não tem etiqueta nem AR (isso é fluxo
// postal — Correios). O oficial de justiça entrega em mão, então o que o
// cartório precisa é uma RELAÇÃO simples pra entregar a ele: nome, função,
// endereço, e espaço pra assinatura/data de cumprimento. Não existe
// referência de um "mandado" oficial do TJ-PI pra reproduzir (diferente do
// AR, onde tínhamos o PDF real do gerador dos Correios) — então a relação é
// deliberadamente um documento de CONTROLE INTERNO do SIME, não uma peça
// processual, e não finge ser uma.

let ojDados = null; // { pessoas:[...], zona:{...} }
let ojSelecionados = new Set();

function ojEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function ojCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { ojDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: pessoas, error: e1 }, { data: zona, error: e2 }, { data: secoes }] = await Promise.all([
    sb.from('sime_atores')
      .select('id, nome_completo, funcao, funcao_mesa, secao_id, inscricao_eleitoral, status_contato_alternativo')
      .eq('zona_id', zonaId).eq('ativo', true).eq('meio_contato', 'oficial_justica')
      .in('funcao', ['mesario', 'coord_acessibilidade', 'auxiliar_eleicao']).order('nome_completo'),
    sb.from('sime_zonas').select('id, numero, nome, municipio').eq('id', zonaId).maybeSingle(),
    sb.from('sime_secoes').select('id, numero, local_nome, municipio').eq('zona_id', zonaId),
  ]);
  if (e1 || e2) { ojDados = { erro: (e1 || e2).message }; render(); return; }

  const titulos = [...new Set((pessoas || []).map(p => p.inscricao_eleitoral).filter(Boolean))];
  const titulosBusca = [...new Set(titulos.flatMap(t => [t, t.replace(/^0+/, '') || t]))];
  const { data: raw } = titulosBusca.length
    ? await sb.from('sime_mesarios_raw').select('inscricao, endereco_dados_mesario, bairro_dados_mesario, cep_dados_mesario, nome_municipio_dados_mesario, uf_dados_mesario, endereco_eleitor, bairro_eleitor, cep_eleitor, nome_municipio_endereco_eleitor, uf_endereco_eleitor, endereco_comercial_mesario, bairro_comercial_mesario, cep_comercial_mesario, nome_municipio_comercial_mesario, uf_comercial_mesario').in('inscricao', titulosBusca)
    : { data: [] };

  const rawPorTitulo = {};
  for (const r of raw || []) {
    const chave = normalizarTituloEleitor(r.inscricao);
    if (!rawPorTitulo[chave]) rawPorTitulo[chave] = r;
  }
  const secoesPorId = Object.fromEntries((secoes || []).map(s => [s.id, s]));

  for (const p of pessoas || []) {
    const r = p.inscricao_eleitoral ? rawPorTitulo[p.inscricao_eleitoral] : null;
    p.endereco = coEnderecoDestinatario(r);
    p.sec = p.secao_id ? secoesPorId[p.secao_id] : null;
  }

  ojDados = { pessoas: pessoas || [], zona: zona || {} };
  render();
}

function ojToggleSelecionado(id) {
  if (ojSelecionados.has(id)) ojSelecionados.delete(id); else ojSelecionados.add(id);
  render();
}

async function ojSalvarStatus(id, status) {
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_atores').update({ status_contato_alternativo: status || null }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  const p = ojDados.pessoas.find(x => x.id === id);
  if (p) p.status_contato_alternativo = status || null;
  // Mesma ação que o modal de "Contatar mesários" já usa (cmSalvarStatusAlt)
  // — uma mudança feita aqui aparece na timeline de Atualizações da pessoa
  // lá, sem precisar de um rótulo de log próprio.
  await cmLog('mesario_status_contato_alt', '', { ator_id: id, status });
  showToast('✓ Status atualizado');
  render();
}

// Relação impressa pro oficial de justiça — não é etiqueta nem AR (isso é
// fluxo postal); é uma lista de controle interno do SIME, com espaço pra
// assinatura/data de cumprimento de cada item.
function ojHtmlRelacao(pessoas, zona) {
  const hoje = new Date();
  const dataEmissao = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
  const linhas = pessoas.map((p, i) => `
    <tr>
      <td class="oj-col-num">${i + 1}</td>
      <td>
        <b>${ojEsc(p.nome_completo)}</b><br>
        <span class="oj-sub">${ojEsc(coRotuloFuncao(p))}${p.sec ? ` — Seção ${ojEsc(p.sec.numero)}, ${ojEsc(p.sec.local_nome || '')}` : ''}</span>
      </td>
      <td>${p.endereco
        ? `${ojEsc(p.endereco.endereco)}${p.endereco.bairro ? ', ' + ojEsc(p.endereco.bairro) : ''}<br>${coFmtCep(p.endereco.cep)} — ${ojEsc(p.endereco.municipio || '')}${p.endereco.uf ? ' - ' + ojEsc(p.endereco.uf) : ''}`
        : '<span class="oj-sub">⚠ Sem endereço no ELO</span>'}</td>
      <td class="oj-col-assinatura"></td>
      <td class="oj-col-data"></td>
    </tr>`).join('');
  return `
    <div class="oj-pagina-relacao">
      <div class="oj-cabecalho">
        <div class="oj-titulo">Relação para Convocação via Oficial de Justiça</div>
        <div class="oj-sub">${zona.numero ? `${ojEsc(zona.numero)}ª Zona Eleitoral` : 'Zona Eleitoral'}${zona.municipio ? ` — ${ojEsc(zona.municipio)}` : ''} · Emitida em ${dataEmissao} · ${pessoas.length} nome(s)</div>
      </div>
      <table class="oj-tabela">
        <colgroup><col class="oj-col-num"><col class="oj-col-nome"><col class="oj-col-end"><col class="oj-col-assinatura"><col class="oj-col-data"></colgroup>
        <thead><tr>
          <th>Nº</th><th>Nome / Função</th><th>Endereço</th><th>Assinatura / recebimento</th><th>Data</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <div class="oj-rodape">Relação de controle interno do SIME — não substitui o mandado/certidão próprios do processo de convocação. Preencher assinatura e data no ato do cumprimento.</div>
    </div>`;
}

async function ojImprimir(ids) {
  const pessoas = ojDados.pessoas.filter(p => ids.includes(p.id));
  if (!pessoas.length) return;
  const area = document.getElementById('print-area');
  area.innerHTML = ojHtmlRelacao(pessoas, ojDados.zona);
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log('oficial_justica_relacao_impressa', '', { autor, quantidade: pessoas.length, atores: pessoas.map(p => p.id) });
  window.print();
}

function renderOficialJustica() {
  const c = document.getElementById('content');
  if (!window.supabaseAtores) {
    c.innerHTML = '<div class="import-card"><div class="import-result ir-warn">Entre com a conta da equipe.</div></div>';
    return;
  }
  if (!ojDados) {
    c.innerHTML = '<div class="import-card"><div class="ic-title">⚖️ Oficial de Justiça</div><div class="ic-sub">Carregando…</div></div>';
    ojCarregar();
    return;
  }
  if (ojDados.erro) {
    c.innerHTML = `<div class="import-card"><div class="import-result ir-warn">⚠ ${ojEsc(ojDados.erro)}</div></div>`;
    return;
  }

  const contagem = {};
  for (const p of ojDados.pessoas) { const k = p.status_contato_alternativo || 'a_enviar'; contagem[k] = (contagem[k] || 0) + 1; }
  const comEndereco = ojDados.pessoas.filter(p => p.endereco);
  const semEndereco = ojDados.pessoas.filter(p => !p.endereco);
  const selecionaveis = ojDados.pessoas.filter(p => ojSelecionados.has(p.id));

  c.innerHTML = `
    <div class="import-card">
      <div class="ic-title">⚖️ Oficial de Justiça — controle da convocação</div>
      <div class="ic-sub">Pra quem está marcado com meio de contato "Oficial de Justiça" (aba 📞 Contatar mesários) — acompanha o
        andamento da entrega em mão e gera a relação pra entregar ao oficial. O endereço vem da planilha do TRE (mesma fonte e
        prioridade da aba Correspondência); a convocação formal em si continua sendo o processo de sempre do cartório.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;font-size:.74rem;color:var(--text2)">
        ${Object.entries(CM_STATUS_ALT_LABEL).map(([v, l]) => `<span>${l}: <b>${contagem[v] || 0}</b></span>`).join('')}
      </div>
    </div>

    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">📋 Designados (${ojDados.pessoas.length})</div>
      ${semEndereco.length ? `<div class="import-result ir-warn">⚠️ ${semEndereco.length} sem endereço disponível no ELO — entram na relação mesmo assim, marcados à parte.</div>` : ''}
      ${ojDados.pessoas.length ? `
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <button class="btn btn-out" onclick="ojSelecionados=new Set(ojDados.pessoas.map(p=>p.id));render()">Selecionar todos</button>
        <button class="btn btn-out" onclick="ojSelecionados=new Set();render()">Limpar seleção</button>
        <button class="btn btn-dark" ${!selecionaveis.length ? 'disabled' : ''} onclick="ojImprimir([...ojSelecionados])">🖨️ Imprimir relação selecionados (${selecionaveis.length})</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${[...comEndereco, ...semEndereco].map(p => `
          <div data-ator-id="${p.id}" style="display:flex;align-items:flex-start;gap:10px;padding:10px;border:1px solid var(--border2);border-radius:8px">
            <input type="checkbox" style="width:20px;height:20px;margin-top:2px" ${ojSelecionados.has(p.id) ? 'checked' : ''} onchange="ojToggleSelecionado('${p.id}')">
            <div style="flex:1">
              <div style="font-weight:700">${ojEsc(p.nome_completo)}</div>
              <div style="font-size:.72rem;color:var(--text2)">${ojEsc(coRotuloFuncao(p))}${p.sec ? ` — Seção ${ojEsc(p.sec.numero)}, ${ojEsc(p.sec.local_nome || '')}` : ''}</div>
              ${p.endereco
                ? `<div style="font-size:.72rem;color:var(--text2);margin-top:2px">📍 ${ojEsc(p.endereco.endereco)}${p.endereco.bairro ? ', ' + ojEsc(p.endereco.bairro) : ''} — ${coFmtCep(p.endereco.cep)} <span style="opacity:.7">(${ojEsc(p.endereco.fonte)})</span></div>`
                : `<div class="ic-sub" style="margin:2px 0 0">⚠ Sem endereço no ELO</div>`}
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
              <select onchange="ojSalvarStatus('${p.id}', this.value)">
                ${Object.entries(CM_STATUS_ALT_LABEL).map(([v, l]) => `<option value="${v}" ${(p.status_contato_alternativo || 'a_enviar') === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
              <button class="btn btn-out btn-xs" onclick="ojImprimir(['${p.id}'])">🖨️ Relação</button>
            </div>
          </div>`).join('')}
      </div>` : '<div class="ic-sub" style="margin-bottom:0">Ninguém marcado com "Oficial de Justiça" no momento.</div>'}
    </div>
  `;
}
