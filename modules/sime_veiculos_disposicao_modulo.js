// sime_veiculos_disposicao_modulo.js — Cadastro de veículos de órgãos
// públicos cedidos à Justiça Eleitoral na véspera e no Dia D
// (SIME_veiculos_disposicao.html).
//
// Pedido direto (28/09/2026): "precisamos cadastrar os veiculos dos orgãos
// publicos que ficarão a disposição da justiça eleitoral na vespera e dia
// da eleição", com uma tabela colada (cidade, Qtd., Veículo, Placa,
// Lotação, RENAVAM, Motorista, Fone) — 19 veículos das 3 cidades da 7ª
// Zona, já carregados em produção (sql/SIME_veiculos_disposicao.sql).
//
// Diferente de sime_rotas/sime_empresas (frota CONTRATADA especificamente
// pra rodar rota de distribuição/recolhimento de urna, com paradas e
// motorista fixo) — isto é um cadastro mais simples, sem rota nem paradas:
// veículo emprestado por secretaria/prefeitura/câmara/autarquia pra ficar
// de plantão/reserva no D-1 e no Dia D. Mesmo padrão de acesso do resto das
// ferramentas de cartório (sem trava de perfil — qualquer um da equipe
// grava, exceto Auxiliar de Eleição, que nem abre esta tela, ver
// sime_acesso_perfil.js).

function mensagemErroAmigavel(error, fallback) {
  const msg = error?.message || '';
  if (/duplicate key|unique constraint/i.test(msg)) return 'Já existe um registro com esse valor';
  if (/foreign key|violates.*constraint/i.test(msg)) return 'Não é possível: há dados vinculados a isso';
  if (/permission denied|row-level security|RLS/i.test(msg)) return 'Sem permissão para esta ação';
  if (/JWT|token.*expired|not authenticated/i.test(msg)) return 'Sessão expirada — saia e entre de novo';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Sem conexão com o servidor';
  return fallback || 'Falha ao salvar. Tente novamente';
}

let vdDados = null; // { veiculos:[...], municipios:[...], zonaId }
let vdBusca = '';
let vdFiltroMunicipio = '';
let vdMostrarInativos = false;
let vdModalId = null; // null = fechado; '' = criando novo; id = editando

function vdEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function vdCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { vdDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: veiculos, error: e1 }, { data: secoes, error: e2 }] = await Promise.all([
    sb.from('sime_veiculos_disposicao').select('*').eq('zona_id', zonaId).order('municipio').order('veiculo'),
    sb.from('sime_secoes').select('municipio').eq('zona_id', zonaId),
  ]);
  if (e1 || e2) { vdDados = { erro: (e1 || e2).message }; render(); return; }

  const municipios = [...new Set((secoes || []).map(s => s.municipio).filter(Boolean))].sort();
  vdDados = { veiculos: veiculos || [], municipios, zonaId };
  render();
}

function vdFiltrar() {
  const q = vdBusca.trim().toLowerCase();
  return (vdDados.veiculos || []).filter(v => {
    if (!vdMostrarInativos && !v.ativo) return false;
    if (vdFiltroMunicipio && v.municipio !== vdFiltroMunicipio) return false;
    if (q) {
      const campos = [v.veiculo, v.placa, v.lotacao, v.motorista_nome, v.renavam];
      if (!campos.some(c => (c || '').toLowerCase().includes(q))) return false;
    }
    return true;
  });
}

function vdAgrupar(lista) {
  const grupos = {};
  for (const v of lista) (grupos[v.municipio] ||= []).push(v);
  return Object.keys(grupos).sort().map(m => ({ municipio: m, itens: grupos[m] }));
}

function renderVeiculosDisposicao() {
  const content = document.getElementById('content');
  if (!vdDados) { content.innerHTML = '<div class="import-card">Carregando…</div>'; vdCarregar(); return; }
  if (vdDados.erro) { content.innerHTML = `<div class="import-card"><div class="import-result ir-err">⚠ ${vdEsc(vdDados.erro)}</div></div>`; return; }

  const lista = vdFiltrar();
  const grupos = vdAgrupar(lista);
  const ativos = vdDados.veiculos.filter(v => v.ativo);
  const semMotorista = ativos.filter(v => !v.motorista_nome).length;

  content.innerHTML = `
    <div class="import-card">
      <div class="ic-title">🚙 Veículos à disposição da Justiça Eleitoral</div>
      <div class="ic-sub">Veículos cedidos por órgãos públicos (prefeituras, secretarias, câmaras, autarquias) pra ficar de plantão na véspera e no Dia D — reforço e imprevisto, não uma rota cadastrada. Rota de distribuição/recolhimento de urna continua no módulo 🗺️ Rotas.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-dark" onclick="vdAbrirNovo()">➕ Novo veículo</button>
        <button class="btn btn-out" onclick="vdImprimir()">🖨️ Imprimir lista</button>
      </div>
    </div>

    <div class="import-card">
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:4px">
        <div><b>${ativos.length}</b> <span class="ic-sub" style="margin:0">veículo(s) ativo(s)</span></div>
        <div><b>${vdDados.municipios.length ? vdAgrupar(ativos).length : 0}</b> <span class="ic-sub" style="margin:0">município(s) com veículo cadastrado</span></div>
        ${semMotorista ? `<div><b style="color:var(--yellow)">${semMotorista}</b> <span class="ic-sub" style="margin:0">ainda sem motorista designado</span></div>` : ''}
      </div>
    </div>

    <div class="import-card">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <select id="vd-filtro-municipio" onchange="vdFiltroMunicipio=this.value;render()">
          <option value="">Todos os municípios</option>
          ${vdDados.municipios.map(m => `<option value="${vdEsc(m)}" ${vdFiltroMunicipio === m ? 'selected' : ''}>${vdEsc(m)}</option>`).join('')}
        </select>
        <input type="text" placeholder="Buscar por veículo, placa, lotação ou motorista…" value="${vdEsc(vdBusca)}" oninput="vdBusca=this.value;render()" style="flex:1;min-width:200px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
        <label style="display:flex;align-items:center;gap:6px;font-size:.78rem;color:var(--text2);white-space:nowrap;cursor:pointer">
          <input type="checkbox" id="vd-mostrar-inativos" ${vdMostrarInativos ? 'checked' : ''} onchange="vdMostrarInativos=this.checked;render()"> mostrar removidos
        </label>
      </div>
      <div class="ic-sub" style="margin-bottom:0">${lista.length} de ${vdMostrarInativos ? vdDados.veiculos.length : ativos.length} veículo(s) visível(is)</div>
    </div>

    ${grupos.length ? grupos.map(g => `
    <div class="import-card" style="padding:12px 14px">
      <div class="ic-title" style="font-size:.82rem;margin-bottom:8px">${vdEsc(g.municipio)} <span class="ic-sub" style="margin:0">(${g.itens.length})</span></div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${g.itens.map(v => vdCard(v)).join('')}
      </div>
    </div>`).join('') : '<div class="import-card"><div class="ic-sub" style="margin-bottom:0">Nenhum veículo cadastrado ainda com esse filtro.</div></div>'}
  `;
}

function vdCard(v) {
  const inativo = !v.ativo;
  return `
  <div data-vid="${v.id}" style="border:1px solid var(--border2);border-radius:9px;padding:10px 12px;${inativo ? 'opacity:.55' : ''}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
      <div>
        <div style="font-weight:800;font-size:.86rem;cursor:pointer" onclick="vdAbrirEditar('${v.id}')" title="Clique pra editar">${vdEsc(v.veiculo)}${v.quantidade > 1 ? ` (×${v.quantidade})` : ''}</div>
        <div class="ic-sub" style="margin:2px 0 0">${v.placa ? `Placa <b class="mono">${vdEsc(v.placa)}</b> · ` : ''}${vdEsc(v.lotacao || '— lotação não informada —')}${v.renavam ? ` · RENAVAM <span class="mono">${vdEsc(v.renavam)}</span>` : ''}</div>
        ${v.observacao ? `<div class="ic-sub" style="margin:2px 0 0">${vdEsc(v.observacao)}</div>` : ''}
      </div>
      ${inativo ? '<span class="import-result" style="margin-top:0;white-space:nowrap">removido</span>' : ''}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">
      ${v.motorista_nome
        ? `<span class="ic-sub" style="margin:0">👤 ${vdEsc(v.motorista_nome)}</span>${v.motorista_telefone ? `<button class="btn btn-out" style="font-size:.7rem;padding:5px 10px" onclick="vdCopiarLink('${v.id}')" title="Copiar link do WhatsApp">💬 ${vdEsc(fmtTelefone(v.motorista_telefone))}</button>` : ''}`
        : '<span class="import-result ir-warn" style="margin-top:0">sem motorista designado</span>'}
      <button class="btn btn-out" style="font-size:.7rem;padding:5px 10px;margin-left:auto" onclick="vdAbrirEditar('${v.id}')">✏️ Editar</button>
      ${inativo
        ? `<button class="btn btn-out" style="font-size:.7rem;padding:5px 10px" onclick="vdReativar('${v.id}')">↺ Reativar</button>`
        : `<button class="btn btn-out" style="font-size:.7rem;padding:5px 10px" onclick="vdRemover('${v.id}')">✕ Remover</button>`}
    </div>
  </div>`;
}

function vdAbrirNovo() { vdModalId = ''; vdRenderModal(); }
function vdAbrirEditar(id) { vdModalId = id; vdRenderModal(); }
// Mesmo guard de vlFecharModal()/cmFecharModal() — o clique dentro do modal
// também borbulha até #overlay (é filho dele), então sem checar
// `e.target === overlay` qualquer clique no formulário fecharia o modal.
function vdFecharModal(e) {
  if (vdModalId === null) return;
  if (!e || e.target === document.getElementById('overlay')) {
    vdModalId = null;
    document.getElementById('overlay')?.classList.remove('open');
  }
}

function vdRenderModal() {
  const v = vdModalId ? (vdDados.veiculos || []).find(x => x.id === vdModalId) : null;
  const isNovo = vdModalId === '';

  document.getElementById('modal-body')?.classList.remove('cm-modal-wide');
  document.getElementById('modal-body').innerHTML = `
    <div class="m-hdr">
      <div class="m-title">${isNovo ? '➕ Novo veículo' : '✏️ Editar veículo'}</div>
      <button class="close-btn" aria-label="Fechar" onclick="vdFecharModal()">✕</button>
    </div>
    <div class="m-body">
      <div class="form-group"><label for="vd-municipio">Município</label>
        <input type="text" id="vd-municipio" list="vd-municipios-list" value="${vdEsc(v?.municipio || '')}" placeholder="ex.: Campo Maior">
        <datalist id="vd-municipios-list">${vdDados.municipios.map(m => `<option value="${vdEsc(m)}">`).join('')}</datalist>
      </div>
      <div class="form-group"><label for="vd-veiculo">Veículo</label>
        <input type="text" id="vd-veiculo" value="${vdEsc(v?.veiculo || '')}" placeholder="ex.: Toyota Hilux, cor branca"></div>
      <div class="form-group"><label for="vd-placa">Placa</label>
        <input type="text" id="vd-placa" value="${vdEsc(v?.placa || '')}" placeholder="ABC1D23" maxlength="10"></div>
      <div class="form-group"><label for="vd-lotacao">Lotação (órgão cedente)</label>
        <input type="text" id="vd-lotacao" value="${vdEsc(v?.lotacao || '')}" placeholder="ex.: Prefeitura, SEFAZ, Câmara..."></div>
      <div class="form-group"><label for="vd-renavam">RENAVAM (opcional)</label>
        <input type="text" id="vd-renavam" value="${vdEsc(v?.renavam || '')}" placeholder="opcional"></div>
      <div class="form-group"><label for="vd-quantidade">Quantidade</label>
        <input type="number" id="vd-quantidade" value="${v?.quantidade || 1}" min="1" step="1"></div>
      <div class="form-group"><label for="vd-motorista">Motorista (opcional)</label>
        <input type="text" id="vd-motorista" value="${vdEsc(v?.motorista_nome || '')}" placeholder="deixe em branco se ainda não tiver"></div>
      <div class="form-group"><label for="vd-telefone">WhatsApp do motorista (opcional)</label>
        <input type="text" id="vd-telefone" value="${v?.motorista_telefone ? vdEsc(fmtTelefone(v.motorista_telefone)) : ''}" placeholder="(86) 9xxxx-xxxx"></div>
      <div class="form-group"><label for="vd-obs">Observação (opcional)</label>
        <input type="text" id="vd-obs" value="${vdEsc(v?.observacao || '')}" placeholder="opcional"></div>
    </div>
    <div class="m-foot">
      <button class="btn btn-out" onclick="vdFecharModal()">Cancelar</button>
      <button class="btn btn-dark" onclick="vdSalvar()">💾 Salvar</button>
    </div>`;
  document.getElementById('overlay').classList.add('open');
}

async function vdSalvar() {
  const sb = window.supabaseAtores;
  const municipio = document.getElementById('vd-municipio').value.trim();
  const veiculo = document.getElementById('vd-veiculo').value.trim();
  if (!municipio) { showToast('⚠ Município obrigatório'); return; }
  if (!veiculo) { showToast('⚠ Descrição do veículo obrigatória'); return; }

  const placa = document.getElementById('vd-placa').value.trim().toUpperCase().replace(/\s+/g, '') || null;
  const lotacao = document.getElementById('vd-lotacao').value.trim() || null;
  const renavam = document.getElementById('vd-renavam').value.trim().replace(/\s+/g, '') || null;
  const quantidade = Math.max(1, parseInt(document.getElementById('vd-quantidade').value, 10) || 1);
  const motorista_nome = document.getElementById('vd-motorista').value.trim() || null;
  const telDigitos = document.getElementById('vd-telefone').value.trim();
  const motorista_telefone = telDigitos ? normalizarTelefoneWhatsapp(telDigitos) || null : null;
  const observacao = document.getElementById('vd-obs').value.trim() || null;

  const zonaId = vdDados.zonaId;
  const isNovo = vdModalId === '';

  try {
    if (isNovo) {
      const { data: { user } } = await sb.auth.getUser();
      const { data: meu } = await sb.from('sime_usuarios').select('id').eq('auth_user_id', user?.id).maybeSingle();
      const { error } = await sb.from('sime_veiculos_disposicao').insert({
        zona_id: zonaId, municipio, quantidade, veiculo, placa, lotacao, renavam, motorista_nome, motorista_telefone, observacao,
        created_by: meu?.id || null,
      });
      if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return; }
      await log('veiculo_disposicao_criado', '', { municipio, veiculo, placa });
      showToast('✓ Veículo cadastrado');
    } else {
      const { data: ts } = await sb.rpc('sime_now');
      const { error } = await sb.from('sime_veiculos_disposicao').update({
        municipio, quantidade, veiculo, placa, lotacao, renavam, motorista_nome, motorista_telefone, observacao, updated_at: ts,
      }).eq('id', vdModalId);
      if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return; }
      await log('veiculo_disposicao_editado', '', { id: vdModalId, municipio, veiculo });
      showToast('✓ Dados atualizados');
    }
  } catch (e) {
    showToast('⚠ Falha ao salvar — verifique a conexão e tente de novo');
    return;
  }

  vdFecharModal();
  vdDados = null;
  render();
}

// Soft-delete — nunca apaga de verdade, mesmo padrão de todo o resto do
// sistema (o veículo pode voltar a ser cedido numa eleição futura).
async function vdRemover(id) {
  const sb = window.supabaseAtores;
  const v = (vdDados.veiculos || []).find(x => x.id === id);
  if (!v) return;
  const { data: ts } = await sb.rpc('sime_now');
  const { error } = await sb.from('sime_veiculos_disposicao').update({ ativo: false, updated_at: ts }).eq('id', id);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return; }
  v.ativo = false;
  await log('veiculo_disposicao_removido', '', { id, veiculo: v.veiculo });
  showToast('✓ Removido da lista');
  render();
}

async function vdReativar(id) {
  const sb = window.supabaseAtores;
  const v = (vdDados.veiculos || []).find(x => x.id === id);
  if (!v) return;
  const { data: ts } = await sb.rpc('sime_now');
  const { error } = await sb.from('sime_veiculos_disposicao').update({ ativo: true, updated_at: ts }).eq('id', id);
  if (error) { showToast('⚠ ' + mensagemErroAmigavel(error)); return; }
  v.ativo = true;
  await log('veiculo_disposicao_reativado', '', { id, veiculo: v.veiculo });
  showToast('✓ Reativado');
  render();
}

async function vdCopiarLink(id) {
  const v = (vdDados.veiculos || []).find(x => x.id === id);
  if (!v || !v.motorista_telefone) return;
  const msg = `Olá, ${v.motorista_nome}! Aqui é do cartório eleitoral, sobre o veículo ${v.veiculo} (${v.placa || 'sem placa cadastrada'}) à disposição na eleição.`;
  const link = linkWhatsApp(v.motorista_telefone, msg);
  if (!link) { showToast('⚠ Telefone inválido'); return; }
  try {
    await navigator.clipboard.writeText(link);
    showToast('🔗 Link do WhatsApp copiado');
  } catch (e) {
    showToast('⚠ Não deu pra copiar — copie manualmente');
  }
}

// Impressão sem popup — mesmo mecanismo (#print-area, sem window.open()) já
// usado em Rotas/Correspondência/Oficial de Justiça. Lista de controle
// interno pro cartório, agrupada por município, na ordem em que já aparece
// na tela (mesmo filtro/busca aplicado no momento do clique).
function vdImprimir() {
  const lista = vdFiltrar();
  const grupos = vdAgrupar(lista);
  const hoje = new Date().toLocaleDateString('pt-BR');
  const linhas = grupos.map(g => `
    <tr><td colspan="5" class="vd-grupo">${vdEsc(g.municipio)}</td></tr>
    ${g.itens.map(v => `
    <tr>
      <td>${vdEsc(v.veiculo)}${v.quantidade > 1 ? ` (×${v.quantidade})` : ''}</td>
      <td>${vdEsc(v.placa || '—')}</td>
      <td>${vdEsc(v.lotacao || '—')}</td>
      <td>${vdEsc(v.motorista_nome || '— sem motorista designado —')}</td>
      <td>${v.motorista_telefone ? vdEsc(fmtTelefone(v.motorista_telefone)) : '—'}</td>
    </tr>`).join('')}
  `).join('');

  document.getElementById('print-area').innerHTML = `
    <div class="vd-pagina">
      <div class="vd-cabecalho">
        <div class="vd-titulo">Veículos à disposição da Justiça Eleitoral</div>
        <div class="vd-sub">Véspera e Dia D · gerado em ${hoje}</div>
      </div>
      <table class="vd-tabela">
        <thead><tr><th>Veículo</th><th>Placa</th><th>Lotação</th><th>Motorista</th><th>Contato</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <div class="vd-rodape">${lista.length} veículo(s) · Documento de controle interno do SIME — gerado a partir do cadastro informado pelos órgãos cedentes.</div>
    </div>`;
  log('veiculo_disposicao_lista_impressa', '', { quantidade: lista.length });
  window.print();
}
