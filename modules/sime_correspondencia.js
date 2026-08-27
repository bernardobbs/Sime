// ══════════════════════════════════════
// CORRESPONDÊNCIA — etiqueta de envelope + modelo de AR (Aviso de
// Recebimento) pra mesários com meio_contato='carta_registrada'. Pedido
// direto (27/08/2026): "marcou para receber por carta, imprime uma etiqueta
// com os dados do destinatario e do remetente e imprime o ar".
//
// Duas limitações de arquitetura, já documentadas alhures e confirmadas com
// o dono do projeto antes de construir isto:
// - Não existe integração com a API paga dos Correios (SIGEP) — incompatível
//   com o custo R$ 0,00/mês do projeto. O "AR" gerado aqui é um MODELO
//   avulso pra preencher/assinar na entrega, não um AR oficial rastreado —
//   o código de objeto (se houver) é só o que o cartório anotou manualmente
//   depois de postar (sime_atores.codigo_rastreio), sem consulta automática.
// - sime_atores não guarda endereço (decisão antiga, documentada no
//   CLAUDE.md: "Carta/Oficial de Justiça usam o endereço já no processo do
//   TRE"). O endereço do destinatário vem de sime_mesarios_raw (staging da
//   planilha do TRE), casando por título de eleitor — mesma junção que
//   SIME_relatorio_elo.js já faz.
// ══════════════════════════════════════

let coDados = null; // { pessoas:[...], zona:{...} }
let coSelecionados = new Set();

// sime_mesarios_raw traz endereço em TRÊS blocos possíveis por pessoa:
// "dados do mesário" (endereco_dados_mesario/...), do cadastro de eleitor
// (endereco_eleitor/...) e comercial (endereco_comercial_mesario/...).
// Checado direto na produção da 7ª Zona em 27/08/2026 antes de decidir a
// prioridade: dados_mesario só vem preenchido em 25 de 735 registros (3%),
// comercial em 1; endereco_eleitor vem preenchido em TODOS os 735 (100%).
// Por isso o endereço do ELEITOR é o fallback confiável, não o padrão —
// COALESCE prioriza "dados do mesário" quando existe (mais provável de
// estar atualizado, é o que a própria pessoa informou ao ser convocada),
// caindo pro cadastro de eleitor (sempre presente) e só por último o
// comercial. Nunca inventa endereço: pessoa sem nenhum dos três fica de
// fora da impressão em massa, listada à parte pra conferência manual —
// mesmo critério "não adivinha" usado em todo o resto do sistema.
function coEnderecoDestinatario(raw) {
  if (!raw) return null;
  const blocos = [
    { fonte: 'Dados do mesário (TRE)', endereco: raw.endereco_dados_mesario, bairro: raw.bairro_dados_mesario, cep: raw.cep_dados_mesario, municipio: raw.nome_municipio_dados_mesario, uf: raw.uf_dados_mesario },
    { fonte: 'Cadastro de eleitor (TRE)', endereco: raw.endereco_eleitor, bairro: raw.bairro_eleitor, cep: raw.cep_eleitor, municipio: raw.nome_municipio_endereco_eleitor, uf: raw.uf_endereco_eleitor },
    { fonte: 'Endereço comercial (TRE)', endereco: raw.endereco_comercial_mesario, bairro: raw.bairro_comercial_mesario, cep: raw.cep_comercial_mesario, municipio: raw.nome_municipio_comercial_mesario, uf: raw.uf_comercial_mesario },
  ];
  return blocos.find(b => (b.endereco || '').trim()) || null;
}

function coFmtCep(cep) {
  const d = String(cep || '').replace(/\D/g, '');
  return d.length === 8 ? d.replace(/(\d{5})(\d{3})/, '$1-$2') : (cep || '—');
}

async function coCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { coDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: pessoas, error: e1 }, { data: zona, error: e2 }, { data: secoes }] = await Promise.all([
    sb.from('sime_atores')
      .select('id, nome_completo, funcao, funcao_mesa, secao_id, inscricao_eleitoral, codigo_rastreio, status_contato_alternativo')
      .eq('zona_id', zonaId).eq('ativo', true).eq('meio_contato', 'carta_registrada')
      .in('funcao', ['mesario', 'coord_acessibilidade', 'auxiliar_eleicao']).order('nome_completo'),
    sb.from('sime_zonas').select('id, numero, municipio, remetente_nome, remetente_endereco, remetente_bairro, remetente_cep, remetente_municipio, remetente_uf').eq('id', zonaId).maybeSingle(),
    sb.from('sime_secoes').select('id, numero, local_nome, municipio').eq('zona_id', zonaId),
  ]);
  if (e1 || e2) { coDados = { erro: (e1 || e2).message }; render(); return; }

  const titulos = [...new Set((pessoas || []).map(p => p.inscricao_eleitoral).filter(Boolean))];
  // Mesmo cuidado de sime_relatorio_elo.js: sime_atores.inscricao_eleitoral
  // vem normalizado (12 dígitos), sime_mesarios_raw.inscricao pode ou não
  // ter o zero à esquerda — busca pelas duas formas.
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

  coDados = { pessoas: pessoas || [], zona: zona || {} };
  render();
}

function coRotuloFuncao(p) {
  if (p.funcao === 'mesario') return p.funcao_mesa || 'Mesário(a)';
  return CM_FUNCAO_LABEL[p.funcao] || p.funcao || '—';
}

function coEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function coToggleSelecionado(id) {
  if (coSelecionados.has(id)) coSelecionados.delete(id); else coSelecionados.add(id);
  render();
}

async function coSalvarRemetente() {
  const sb = window.supabaseAtores;
  const patch = {
    remetente_nome: document.getElementById('co-rem-nome').value.trim() || null,
    remetente_endereco: document.getElementById('co-rem-endereco').value.trim() || null,
    remetente_bairro: document.getElementById('co-rem-bairro').value.trim() || null,
    remetente_cep: document.getElementById('co-rem-cep').value.trim() || null,
    remetente_municipio: document.getElementById('co-rem-municipio').value.trim() || null,
    remetente_uf: document.getElementById('co-rem-uf').value.trim() || null,
  };
  try {
    const { error } = await sb.from('sime_zonas').update(patch).eq('id', coDados.zona.id);
    if (error) throw error;
    coDados.zona = { ...coDados.zona, ...patch };
    showToast('✓ Remetente salvo');
    const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
    await log('correspondencia_remetente_salvo', '', { autor, ...patch });
    render();
  } catch (e) {
    showToast('⚠ Falha ao salvar — verifique a conexão e tente de novo');
  }
}

function coRemetenteCompleto(zona) {
  return !!(zona?.remetente_nome && zona?.remetente_endereco && zona?.remetente_cep && zona?.remetente_municipio && zona?.remetente_uf);
}

// ── IMPRESSÃO — etiqueta e AR são escritos em #print-area (fora do fluxo
// normal da SPA, ver SIME_convocacao.html) e só ficam visíveis via CSS de
// @media print — assim não depende de popup (bloqueado por padrão em muitos
// navegadores) nem de gerar um arquivo à parte.
function coBlocoRemetente(zona) {
  return `<div class="co-remetente"><b>Remetente:</b> ${coEsc(zona.remetente_nome || '—')}<br>
    ${coEsc(zona.remetente_endereco || '—')}${zona.remetente_bairro ? ', ' + coEsc(zona.remetente_bairro) : ''}<br>
    ${coFmtCep(zona.remetente_cep)} — ${coEsc(zona.remetente_municipio || '—')}/${coEsc(zona.remetente_uf || '—')}</div>`;
}

function coBlocoDestinatario(p) {
  const e = p.endereco;
  if (!e) return `<div class="co-destinatario"><div class="co-dest-nome">${coEsc(p.nome_completo)}</div><div>⚠ Sem endereço disponível no ELO</div></div>`;
  return `<div class="co-destinatario">
    <div class="co-dest-nome">${coEsc(p.nome_completo)}</div>
    <div>${coEsc(e.endereco)}</div>
    ${e.bairro ? `<div>${coEsc(e.bairro)}</div>` : ''}
    <div>${coFmtCep(e.cep)} — ${coEsc(e.municipio || '—')}/${coEsc(e.uf || '—')}</div>
  </div>`;
}

async function coImprimir(ids, tipo) {
  const pessoas = coDados.pessoas.filter(p => ids.includes(p.id));
  const zona = coDados.zona;
  const area = document.getElementById('print-area');
  if (tipo === 'etiqueta') {
    area.innerHTML = pessoas.map(p => `
      <div class="co-pagina-etiqueta">
        <div class="co-etiqueta">
          ${coBlocoRemetente(zona)}
          ${coBlocoDestinatario(p)}
        </div>
      </div>`).join('');
  } else {
    area.innerHTML = pessoas.map(p => `
      <div class="co-pagina-ar">
        <div class="co-ar-titulo">AVISO DE RECEBIMENTO — AR</div>
        <div class="co-ar-sub">Modelo avulso pra confirmação de entrega — não substitui o AR oficial dos Correios (sem contrato SIGEP).</div>
        <div class="co-ar-box">${coBlocoRemetente(zona)}</div>
        <div class="co-ar-box">${coBlocoDestinatario(p)}</div>
        <div class="co-ar-box">
          <b>Identificação do objeto</b><br>
          Nº de registro/objeto: ${coEsc(p.codigo_rastreio || '_______________________________')}<br>
          Função: ${coEsc(coRotuloFuncao(p))}${p.sec ? ` — Seção ${coEsc(p.sec.numero)}, ${coEsc(p.sec.local_nome || '')}` : ''}
        </div>
        <div class="co-ar-box co-ar-confirmacao">
          <b>Confirmação de recebimento</b>
          <div class="co-ar-linha">Nome do recebedor: ______________________________________________</div>
          <div class="co-ar-linha">Documento (RG/CPF): ____________________________________________</div>
          <div class="co-ar-linha">Assinatura: ____________________________________________________</div>
          <div class="co-ar-linha">Data do recebimento: ____ / ____ / ________</div>
        </div>
      </div>`).join('');
  }
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log(tipo === 'etiqueta' ? 'correspondencia_etiqueta_impressa' : 'correspondencia_ar_impresso', '', { autor, quantidade: pessoas.length, atores: pessoas.map(p => p.id) });
  window.print();
}

function renderCorrespondencia() {
  const c = document.getElementById('content');
  if (!window.supabaseAtores) {
    c.innerHTML = '<div class="import-card"><div class="import-result ir-warn">Entre com a conta da equipe.</div></div>';
    return;
  }
  if (!coDados) {
    c.innerHTML = '<div class="import-card"><div class="ic-title">📬 Correspondência</div><div class="ic-sub">Carregando…</div></div>';
    coCarregar();
    return;
  }
  if (coDados.erro) {
    c.innerHTML = `<div class="import-card"><div class="import-result ir-warn">⚠ ${coEsc(coDados.erro)}</div></div>`;
    return;
  }

  const zona = coDados.zona;
  const comEndereco = coDados.pessoas.filter(p => p.endereco);
  const semEndereco = coDados.pessoas.filter(p => !p.endereco);
  const remCompleto = coRemetenteCompleto(zona);
  const selecionaveis = comEndereco.filter(p => coSelecionados.has(p.id));

  c.innerHTML = `
    <div class="import-card">
      <div class="ic-title">📬 Correspondência — etiqueta e AR pra convocação por carta</div>
      <div class="ic-sub">Pra quem está marcado com meio de contato "Carta Registrada" (aba 📞 Contatar mesários). O endereço do
        destinatário vem da planilha do TRE (dados do mesário → cadastro de eleitor → comercial, o que existir primeiro nessa
        ordem); a carta de convocação em si continua sendo impressa pelo ELO — aqui é só etiqueta de envio e o modelo de AR.</div>
      ${!remCompleto ? '<div class="import-result ir-warn">⚠️ Preencha o remetente abaixo antes de imprimir — ele entra em toda etiqueta e AR.</div>' : ''}
    </div>

    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">🏢 Remetente (cartório desta zona)</div>
      <div class="ic-sub">Usado em toda etiqueta e AR gerados. Editável por qualquer um da equipe — mesmo padrão do resto desta tela.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group" style="grid-column:1/-1"><label>Nome do cartório</label><input id="co-rem-nome" value="${coEsc(zona.remetente_nome || '')}" placeholder="Cartório da 7ª Zona Eleitoral"></div>
        <div class="form-group" style="grid-column:1/-1"><label>Endereço</label><input id="co-rem-endereco" value="${coEsc(zona.remetente_endereco || '')}" placeholder="Rua, número"></div>
        <div class="form-group"><label>Bairro</label><input id="co-rem-bairro" value="${coEsc(zona.remetente_bairro || '')}"></div>
        <div class="form-group"><label>CEP</label><input id="co-rem-cep" value="${coEsc(zona.remetente_cep || '')}" placeholder="00000-000"></div>
        <div class="form-group"><label>Município</label><input id="co-rem-municipio" value="${coEsc(zona.remetente_municipio || '')}"></div>
        <div class="form-group"><label>UF</label><input id="co-rem-uf" value="${coEsc(zona.remetente_uf || '')}" maxlength="2" placeholder="PI"></div>
      </div>
      <button class="btn btn-dark" style="margin-top:10px" onclick="coSalvarRemetente()">💾 Salvar remetente</button>
    </div>

    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">✉️ Destinatários (${coDados.pessoas.length})</div>
      ${semEndereco.length ? `<div class="import-result ir-warn">⚠️ ${semEndereco.length} sem endereço disponível no ELO — listados à parte abaixo, fora da seleção.</div>` : ''}
      ${comEndereco.length ? `
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <button class="btn btn-out" onclick="coSelecionados=new Set(coDados.pessoas.filter(p=>p.endereco).map(p=>p.id));render()">Selecionar todos</button>
        <button class="btn btn-out" onclick="coSelecionados=new Set();render()">Limpar seleção</button>
        <button class="btn btn-dark" ${(!selecionaveis.length || !remCompleto) ? 'disabled' : ''} onclick="coImprimir([...coSelecionados],'etiqueta')">🏷️ Imprimir etiquetas selecionadas (${selecionaveis.length})</button>
      </div>
      <div class="cm-lista-pessoas" style="display:flex;flex-direction:column;gap:8px">
        ${comEndereco.map(p => `
          <div data-ator-id="${p.id}" style="display:flex;align-items:flex-start;gap:10px;padding:10px;border:1px solid var(--border2);border-radius:8px">
            <input type="checkbox" style="width:20px;height:20px;margin-top:2px" ${coSelecionados.has(p.id) ? 'checked' : ''} onchange="coToggleSelecionado('${p.id}')">
            <div style="flex:1">
              <div style="font-weight:700">${coEsc(p.nome_completo)}</div>
              <div style="font-size:.72rem;color:var(--text2)">${coEsc(coRotuloFuncao(p))}${p.sec ? ` — Seção ${coEsc(p.sec.numero)}, ${coEsc(p.sec.local_nome || '')}` : ''}</div>
              <div style="font-size:.72rem;color:var(--text2);margin-top:2px">📍 ${coEsc(p.endereco.endereco)}${p.endereco.bairro ? ', ' + coEsc(p.endereco.bairro) : ''} — ${coFmtCep(p.endereco.cep)} <span style="opacity:.7">(${coEsc(p.endereco.fonte)})</span></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <button class="btn btn-out btn-xs" ${!remCompleto ? 'disabled' : ''} onclick="coImprimir(['${p.id}'],'etiqueta')">🏷️ Etiqueta</button>
              <button class="btn btn-out btn-xs" ${!remCompleto ? 'disabled' : ''} onclick="coImprimir(['${p.id}'],'ar')">📄 AR</button>
            </div>
          </div>`).join('')}
      </div>` : '<div class="ic-sub" style="margin-bottom:0">Ninguém marcado com "Carta Registrada" e com endereço disponível.</div>'}
    </div>

    ${semEndereco.length ? `
    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">⚠️ Sem endereço no ELO (${semEndereco.length})</div>
      <div class="ic-sub">Nenhum dos três blocos de endereço da planilha do TRE (dados do mesário, cadastro de eleitor, comercial) veio
        preenchido pra estas pessoas — não dá pra montar etiqueta sem adivinhar o endereço.</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${semEndereco.map(p => `<div style="font-size:.8rem">${coEsc(p.nome_completo)} — ${coEsc(coRotuloFuncao(p))}</div>`).join('')}
      </div>
    </div>` : ''}
  `;
}
