// sime_rotas_modulo.js — módulo "🗺️ Rotas" (SIME_rotas.html, 04/09/2026).
//
// Pedido direto: "vamos fazer um modulo de rotas precisa ser rota poder
// cadastrar rotas de recolhimento de midias, distribuição e recolhimento de
// urnas, rotas de instalação de seção".
//
// Contexto que faltava antes disso existir: `sime_rotas` já existia, mas sem
// nenhum jeito de dizer PRA QUE ela serve — as 35 linhas atuais da 7ª Zona (+7
// da 94ª) vieram do export do MaxLog (Sistema de Logística das Eleições do
// TRE, 31/08/2026) e — CONFIRMADO com o dono do projeto em 04/09/2026, antes
// de mexer no schema — cobrem ida (distribuição) E volta (recolhimento de
// urna) pelo MESMO trajeto físico (mesmo veículo leva a urna e traz de
// volta); `urnas_estimadas` preenchido em quase todas bate com isso, não com
// recolhimento de mídia (cartão de memória, logística bem mais leve). Ver
// sql/SIME_rotas_modulo.sql pro detalhe da migração (`sime_rotas.tipos[]` +
// tabela nova `sime_rota_secoes`).
//
// Por que uma rota pode ter mais de um tipo (array, não um valor só): as 42
// rotas atuais já são exatamente esse caso (distribuição + recolhimento de
// urna, mesmo cadastro pros dois sentidos) — um enum de valor único não
// serviria nem pro dado que já existe.
//
// Por que uma seção pode estar em MAIS de uma rota ao mesmo tempo (tabela de
// junção `sime_rota_secoes`, não mais um FK único): uma seção pode precisar
// de uma rota de instalação (D-X, convocado externo) DIFERENTE da rota de
// distribuição/recolhimento de urna (D-1/Dia D) — datas e veículos diferentes,
// não dá pra guardar num único `sime_secoes.rota_id`.
//
// `sime_secoes.rota_id`/`parada` CONTINUAM existindo e são a fonte real pra
// quem já lê direto de lá sem passar por este módulo (Motorista, Conferente,
// TV Distribuição, sime_dados.js getRotas/getSecoes) — por isso toda escrita
// aqui que mexe numa rota com tipo 'distribuicao' ou 'recolhimento_urna'
// também atualiza esses dois campos (rtRotaTemTipoLegado), pra edição feita
// aqui valer de verdade nos módulos operacionais. Pra 'recolhimento_midia' e
// 'instalacao' — que não têm consumidor legado nenhum ainda — só
// `sime_rota_secoes` é tocada.

const RT_TIPO_LABEL = {
  distribuicao: '🚚 Distribuição de urnas',
  recolhimento_urna: '🗳️ Recolhimento de urnas',
  recolhimento_midia: '📦 Recolhimento de mídias',
  instalacao: '🛠️ Instalação de seção',
};
const RT_TIPOS = Object.keys(RT_TIPO_LABEL);
// Tipos que já têm consumidor legado (sime_secoes.rota_id/parada) — decide
// se uma escrita em sime_rota_secoes precisa espelhar pra lá também.
const RT_TIPOS_LEGADO = ['distribuicao', 'recolhimento_urna'];

let rtDados = null; // { rotas:[...], secoesZona:[...], secoesPorRota: Map(rota_id -> [{...secao, parada}]), zonaId }
let rtFiltroTipo = '';
let rtBusca = '';
let rtBuscaTimer = null;
let rtModalId = null; // null = fechado; '' = criando nova rota; id = editando
let rtSecoesModalRotaId = null; // id da rota com o modal "Seções" aberto, ou null
let rtSecaoBusca = '';
let rtSecaoBuscaTimer = null;

function rtEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function rtRotaTemTipoLegado(rota) {
  return !!(rota && (rota.tipos || []).some(t => RT_TIPOS_LEGADO.includes(t)));
}

// opts.silencioso: não chama render() nem mostra erro — usado quando quem
// chamou (rtAdicionarSecao/rtRemoverSecao/rtSalvarParada) precisa recarregar
// os dados por trás de um modal que já está aberto e vai se re-renderizar
// sozinho em seguida, sem piscar a tela toda.
async function rtCarregar(opts = {}) {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) {
    if (!opts.silencioso) { rtDados = { erro: 'Conta sem zona associada' }; render(); }
    return;
  }

  const [{ data: rotas, error: e1 }, { data: secoesZona, error: e2 }, { data: rotaSecoes, error: e3 }] = await Promise.all([
    sb.from('sime_rotas').select('id, codigo, nome, municipios, tipos, itinerario, urnas_estimadas, ativo').eq('zona_id', zonaId).order('codigo'),
    sb.from('sime_secoes').select('id, numero, local_nome, municipio, rota_id, ativo').eq('zona_id', zonaId).eq('ativo', true).order('numero'),
    sb.from('sime_rota_secoes').select('rota_id, secao_id, parada'),
  ]);
  if (e1 || e2 || e3) {
    if (!opts.silencioso) { rtDados = { erro: (e1 || e2 || e3).message }; render(); }
    return;
  }

  const secoesPorId = new Map((secoesZona || []).map(s => [s.id, s]));
  const porRota = new Map();
  for (const rs of rotaSecoes || []) {
    const sec = secoesPorId.get(rs.secao_id);
    if (!sec) continue; // seção de outra zona, ou inativa — RLS/filtro já resolveu, isso é só defesa extra
    if (!porRota.has(rs.rota_id)) porRota.set(rs.rota_id, []);
    porRota.get(rs.rota_id).push({ ...sec, parada: rs.parada });
  }
  for (const arr of porRota.values()) arr.sort((a, b) => (a.parada ?? 999) - (b.parada ?? 999) || a.numero - b.numero);

  rtDados = { rotas: rotas || [], secoesZona: secoesZona || [], secoesPorRota: porRota, zonaId };
  if (!opts.silencioso) render();
}

function rtFiltrar() {
  const q = rtBusca.trim().toLowerCase();
  return (rtDados.rotas || []).filter(r => {
    if (rtFiltroTipo && !(r.tipos || []).includes(rtFiltroTipo)) return false;
    if (q && !`${r.codigo} ${r.nome} ${(r.municipios || []).join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function rtOnBuscaInput(v) {
  rtBusca = v;
  clearTimeout(rtBuscaTimer);
  rtBuscaTimer = setTimeout(render, 250);
}

function renderRotas() {
  const c = document.getElementById('content');
  const buscaEl = document.getElementById('rt-busca');
  const buscaAtiva = document.activeElement === buscaEl;
  const buscaSelStart = buscaAtiva ? buscaEl.selectionStart : null;
  const buscaSelEnd = buscaAtiva ? buscaEl.selectionEnd : null;

  if (!rtDados) { c.innerHTML = '<div class="import-card"><div class="ic-title">🗺️ Rotas</div><div class="ic-sub">Carregando…</div></div>'; rtCarregar(); return; }
  if (rtDados.erro) { c.innerHTML = `<div class="import-card"><div class="import-result ir-err">⚠ ${rtEsc(rtDados.erro)}</div></div>`; return; }

  const lista = rtFiltrar();
  const contagem = {};
  for (const r of rtDados.rotas) for (const t of (r.tipos || [])) contagem[t] = (contagem[t] || 0) + 1;

  c.innerHTML = `
    <div class="import-card">
      <div class="ic-title">🗺️ Rotas</div>
      <div class="ic-sub">Cadastro das rotas de distribuição de urnas, recolhimento de urnas, recolhimento de mídias e instalação de seção. Uma mesma rota pode servir mais de um propósito ao mesmo tempo (ex.: o mesmo veículo leva e depois traz a urna pelo mesmo trajeto).</div>
      <button class="btn btn-dark" onclick="rtAbrirNovo()">➕ Nova rota</button>
    </div>

    <div class="import-card">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <select id="rt-filtro-tipo" onchange="rtFiltroTipo=this.value;render()">
          <option value="" ${rtFiltroTipo === '' ? 'selected' : ''}>Todos os tipos (${rtDados.rotas.length})</option>
          ${RT_TIPOS.map(t => `<option value="${t}" ${rtFiltroTipo === t ? 'selected' : ''}>${RT_TIPO_LABEL[t]} (${contagem[t] || 0})</option>`).join('')}
        </select>
        <input type="text" id="rt-busca" value="${rtEsc(rtBusca)}" oninput="rtOnBuscaInput(this.value)" placeholder="Buscar por código, nome ou município…" style="flex:1;min-width:160px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
      </div>
      <div class="ic-sub" style="margin-bottom:0">${lista.length} de ${rtDados.rotas.length} rota(s)</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px">
      ${lista.length ? lista.map(r => {
        const secoes = rtDados.secoesPorRota.get(r.id) || [];
        return `
      <div class="import-card" style="padding:12px 14px;${r.ativo ? '' : 'opacity:.6'}">
        <div style="font-weight:800;font-size:.86rem">Rota ${rtEsc(r.codigo)} — ${rtEsc(r.nome)}</div>
        <div class="ic-sub" style="margin:2px 0 0">${(r.municipios || []).map(rtEsc).join(', ') || '—'} · ${secoes.length} seção(ões) vinculada(s)</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">
          ${(r.tipos || []).map(t => `<span class="import-result ir-ok" style="margin:0;padding:3px 8px;font-size:.68rem">${RT_TIPO_LABEL[t] || t}</span>`).join('')}
        </div>
        ${r.itinerario ? `<div class="ic-sub" style="margin:6px 0 0">${rtEsc(r.itinerario)}</div>` : ''}
        ${r.urnas_estimadas != null ? `<div class="ic-sub" style="margin:2px 0 0">Urnas estimadas: ${r.urnas_estimadas}</div>` : ''}
        ${!r.ativo ? '<div class="ic-sub" style="margin:2px 0 0;color:var(--red)">Inativa</div>' : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <button class="btn btn-out" style="font-size:.72rem;padding:6px 10px" onclick="rtAbrirEditar('${r.id}')">✏️ Editar</button>
          <button class="btn btn-out" style="font-size:.72rem;padding:6px 10px" onclick="rtAbrirSecoes('${r.id}')">👥 Seções (${secoes.length})</button>
          <button class="btn btn-out" style="font-size:.72rem;padding:6px 10px" onclick="rtToggleAtivo('${r.id}',${!r.ativo})">${r.ativo ? '🚫 Desativar' : '✓ Reativar'}</button>
        </div>
      </div>`;
      }).join('') : '<div class="import-card"><div class="ic-sub" style="margin-bottom:0">Nenhuma rota cadastrada ainda com esse filtro.</div></div>'}
    </div>
  `;
  if (buscaAtiva) {
    const el = document.getElementById('rt-busca');
    if (el) { el.focus(); try { el.setSelectionRange(buscaSelStart, buscaSelEnd); } catch (e) { /* ignora */ } }
  }
}

// ── Modal: nova/editar rota ──
function rtAbrirNovo() { rtModalId = ''; rtRenderModalRota(); }
function rtAbrirEditar(id) { rtModalId = id; rtRenderModalRota(); }
function rtFecharModal(e) {
  if (rtModalId === null) return;
  if (!e || e.target === document.getElementById('overlay')) {
    rtModalId = null;
    document.getElementById('overlay')?.classList.remove('open');
  }
}
function rtRenderModalRota() {
  const isNovo = rtModalId === '';
  const r = isNovo ? null : rtDados.rotas.find(x => x.id === rtModalId);
  const tiposAtuais = r?.tipos || [];

  document.getElementById('modal-body').innerHTML = `
    <div class="m-hdr">
      <div class="m-title">${isNovo ? '➕ Nova rota' : `✏️ Editar Rota ${rtEsc(r.codigo)}`}</div>
      <button class="close-btn" aria-label="Fechar" onclick="rtFecharModal()">✕</button>
    </div>
    <div class="m-body">
      <div class="form-group"><label for="rt-codigo">Código</label>
        <input type="text" id="rt-codigo" value="${rtEsc(r?.codigo || '')}" placeholder="ex.: 036" maxlength="3"></div>
      <div class="form-group"><label for="rt-nome">Nome</label>
        <input type="text" id="rt-nome" value="${rtEsc(r?.nome || '')}" placeholder="ex.: Rota 036"></div>
      <div class="form-group"><label for="rt-municipios">Municípios (separados por vírgula)</label>
        <input type="text" id="rt-municipios" value="${rtEsc((r?.municipios || []).join(', '))}" placeholder="ex.: Campo Maior, Jatobá do Piauí"></div>
      <div class="form-group"><label>Tipo (marque quantos precisar)</label>
        ${RT_TIPOS.map(t => `
        <label style="display:flex;align-items:center;gap:6px;font-size:.8rem;margin-top:4px;cursor:pointer">
          <input type="checkbox" class="rt-tipo-check" value="${t}" ${tiposAtuais.includes(t) ? 'checked' : ''}> ${RT_TIPO_LABEL[t]}
        </label>`).join('')}
      </div>
      <div class="form-group"><label for="rt-itinerario">Itinerário (descrição livre das paradas)</label>
        <textarea id="rt-itinerario" rows="3" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);font-size:.85rem;color:var(--text);font-family:inherit" placeholder="ex.: Escola A → Escola B → Sede da Zona">${rtEsc(r?.itinerario || '')}</textarea></div>
      <div class="form-group"><label for="rt-urnas">Urnas estimadas (opcional)</label>
        <input type="number" id="rt-urnas" min="0" value="${r?.urnas_estimadas ?? ''}"></div>
      ${!isNovo ? `
      <label style="display:flex;align-items:center;gap:6px;font-size:.8rem;cursor:pointer">
        <input type="checkbox" id="rt-ativo" ${r?.ativo ? 'checked' : ''}> Rota ativa
      </label>` : ''}
    </div>
    <div class="m-foot">
      <button class="btn btn-out" onclick="rtFecharModal()">Cancelar</button>
      <button class="btn btn-dark" onclick="rtSalvarRota()">💾 Salvar</button>
    </div>`;
  document.getElementById('overlay').classList.add('open');
}

async function rtSalvarRota() {
  const sb = window.supabaseAtores;
  const codigo = document.getElementById('rt-codigo').value.trim();
  const nome = document.getElementById('rt-nome').value.trim();
  const municipiosRaw = document.getElementById('rt-municipios').value.trim();
  const municipios = municipiosRaw ? municipiosRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const tipos = [...document.querySelectorAll('.rt-tipo-check:checked')].map(el => el.value);
  const itinerario = document.getElementById('rt-itinerario').value.trim() || null;
  const urnasRaw = document.getElementById('rt-urnas').value.trim();
  const urnas_estimadas = urnasRaw ? parseInt(urnasRaw, 10) : null;
  const isNovo = rtModalId === '';
  const ativoEl = document.getElementById('rt-ativo');
  const ativo = isNovo ? true : (ativoEl ? ativoEl.checked : true);

  if (!codigo) { showToast('⚠ Código obrigatório'); return; }
  if (!nome) { showToast('⚠ Nome obrigatório'); return; }
  if (!tipos.length) { showToast('⚠ Marque ao menos um tipo de rota'); return; }

  const zonaId = rtDados.zonaId;
  const payload = { nome, municipios, tipos, itinerario, urnas_estimadas };
  try {
    if (isNovo) {
      const { error } = await sb.from('sime_rotas').insert({ ...payload, codigo, zona_id: zonaId, ativo: true });
      if (error) {
        if (/duplicate key|unique constraint/i.test(error.message)) { showToast('⚠ Já existe uma rota com esse código nesta zona'); return; }
        showToast('⚠ ' + error.message); return;
      }
      await log('rota_criada', '', { codigo, nome, tipos });
      showToast('✓ Rota criada');
    } else {
      const { error } = await sb.from('sime_rotas').update({ ...payload, codigo, ativo }).eq('id', rtModalId);
      if (error) {
        if (/duplicate key|unique constraint/i.test(error.message)) { showToast('⚠ Já existe uma rota com esse código nesta zona'); return; }
        showToast('⚠ ' + error.message); return;
      }
      await log('rota_editada', '', { id: rtModalId, codigo, nome, tipos });
      showToast('✓ Rota atualizada');
    }
  } catch (e) {
    showToast('⚠ Falha ao salvar — verifique a conexão e tente de novo');
    return;
  }
  rtFecharModal();
  rtDados = null;
  render();
}

async function rtToggleAtivo(id, ativo) {
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_rotas').update({ ativo }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  await log(ativo ? 'rota_reativada' : 'rota_desativada', '', { id });
  rtDados = null;
  render();
}

// ── Modal: seções da rota ──
function rtAbrirSecoes(rotaId) { rtSecoesModalRotaId = rotaId; rtSecaoBusca = ''; rtRenderModalSecoes(); }
function rtFecharModalSecoes(e) {
  if (rtSecoesModalRotaId === null) return;
  if (!e || e.target === document.getElementById('overlay')) {
    rtSecoesModalRotaId = null;
    document.getElementById('overlay')?.classList.remove('open');
  }
}
function rtOnSecaoBuscaInput(v) {
  rtSecaoBusca = v;
  clearTimeout(rtSecaoBuscaTimer);
  rtSecaoBuscaTimer = setTimeout(rtRenderModalSecoes, 250);
}
function rtRenderModalSecoes() {
  const rota = rtDados.rotas.find(r => r.id === rtSecoesModalRotaId);
  if (!rota) { rtSecoesModalRotaId = null; return; }
  const atuais = rtDados.secoesPorRota.get(rota.id) || [];
  const atuaisIds = new Set(atuais.map(s => s.id));
  const q = rtSecaoBusca.trim().toLowerCase();
  const candidatas = rtDados.secoesZona
    .filter(s => !atuaisIds.has(s.id) && (!q || `${s.numero} ${s.local_nome} ${s.municipio}`.toLowerCase().includes(q)))
    .slice(0, 30);

  const buscaEl = document.getElementById('rt-secao-busca');
  const buscaAtiva = document.activeElement === buscaEl;
  const buscaSelStart = buscaAtiva ? buscaEl.selectionStart : null;
  const buscaSelEnd = buscaAtiva ? buscaEl.selectionEnd : null;

  document.getElementById('modal-body').innerHTML = `
    <div class="m-hdr">
      <div class="m-title">👥 Seções da Rota ${rtEsc(rota.codigo)}</div>
      <button class="close-btn" aria-label="Fechar" onclick="rtFecharModalSecoes()">✕</button>
    </div>
    <div class="m-body">
      <div class="ic-sub" style="margin:0">${atuais.length} seção(ões) nesta rota${rtRotaTemTipoLegado(rota) ? ' — também usada por Motorista/Conferente/TV Distribuição' : ''}.</div>
      <div class="m-hist">
        ${atuais.length ? atuais.map(s => `
        <div class="m-hist-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span><input type="number" value="${s.parada ?? ''}" min="1" style="width:48px;padding:3px 5px;border-radius:5px;border:1px solid var(--border2);background:var(--bg);color:var(--text)" onblur="rtSalvarParada('${rota.id}','${s.id}',this.value)"> <b>${rtEsc(String(s.numero))}</b> — ${rtEsc(s.local_nome)}, ${rtEsc(s.municipio)}</span>
          <button class="btn btn-out" style="font-size:.68rem;padding:3px 8px" onclick="rtRemoverSecao('${rota.id}','${s.id}')">✕</button>
        </div>`).join('') : '<div class="ic-sub" style="margin:0">Nenhuma seção vinculada ainda.</div>'}
      </div>
      <div class="form-group"><label for="rt-secao-busca">Adicionar seção</label>
        <input type="text" id="rt-secao-busca" value="${rtEsc(rtSecaoBusca)}" oninput="rtOnSecaoBuscaInput(this.value)" placeholder="Buscar por número, local ou município…"></div>
      <div class="m-hist">
        ${candidatas.length ? candidatas.map(s => `
        <div class="m-hist-item" style="cursor:pointer" onclick="rtAdicionarSecao('${rota.id}','${s.id}')">➕ <b>${rtEsc(String(s.numero))}</b> — ${rtEsc(s.local_nome)}, ${rtEsc(s.municipio)}</div>`).join('')
          : (q ? '<div class="ic-sub" style="margin:0">Nenhuma seção encontrada.</div>' : '')}
      </div>
    </div>
    <div class="m-foot">
      <button class="btn btn-dark" onclick="rtFecharModalSecoes()">Fechar</button>
    </div>`;
  document.getElementById('overlay').classList.add('open');
  if (buscaAtiva) {
    const el = document.getElementById('rt-secao-busca');
    if (el) { el.focus(); try { el.setSelectionRange(buscaSelStart, buscaSelEnd); } catch (e) { /* ignora */ } }
  }
}

async function rtAdicionarSecao(rotaId, secaoId) {
  const sb = window.supabaseAtores;
  const rota = rtDados.rotas.find(r => r.id === rotaId);
  const atuais = rtDados.secoesPorRota.get(rotaId) || [];
  const proximaParada = atuais.length ? Math.max(...atuais.map(s => s.parada || 0)) + 1 : 1;

  const { error } = await sb.from('sime_rota_secoes').insert({ rota_id: rotaId, secao_id: secaoId, parada: proximaParada });
  if (error) { showToast('⚠ ' + error.message); return; }

  if (rtRotaTemTipoLegado(rota)) {
    const secao = rtDados.secoesZona.find(s => s.id === secaoId);
    const jaTinhaOutraRota = secao && secao.rota_id && secao.rota_id !== rotaId;
    const { error: eLeg } = await sb.from('sime_secoes').update({ rota_id: rotaId, parada: proximaParada }).eq('id', secaoId);
    if (eLeg) {
      showToast('⚠ Seção vinculada aqui, mas falhou ao sincronizar com Distribuição/Conferente: ' + eLeg.message);
    } else if (jaTinhaOutraRota) {
      showToast('✓ Seção movida pra esta rota — estava em outra rota de distribuição/recolhimento de urna');
    }
  }

  await log('rota_secao_adicionada', '', { rota_id: rotaId, secao_id: secaoId, parada: proximaParada });
  await rtRenderModalSecoesAposRecarregar(rotaId);
}

async function rtRemoverSecao(rotaId, secaoId) {
  const sb = window.supabaseAtores;
  const rota = rtDados.rotas.find(r => r.id === rotaId);
  const { error } = await sb.from('sime_rota_secoes').delete().eq('rota_id', rotaId).eq('secao_id', secaoId);
  if (error) { showToast('⚠ ' + error.message); return; }

  // Só limpa o campo legado se ele ainda apontar pra ESTA rota — nunca
  // sobrescrever uma reatribuição que já tenha acontecido por outro caminho.
  if (rtRotaTemTipoLegado(rota)) {
    await sb.from('sime_secoes').update({ rota_id: null, parada: null }).eq('id', secaoId).eq('rota_id', rotaId);
  }

  await log('rota_secao_removida', '', { rota_id: rotaId, secao_id: secaoId });
  await rtRenderModalSecoesAposRecarregar(rotaId);
}

async function rtSalvarParada(rotaId, secaoId, valor) {
  const sb = window.supabaseAtores;
  const parada = valor === '' ? null : parseInt(valor, 10);
  const rota = rtDados.rotas.find(r => r.id === rotaId);

  const { error } = await sb.from('sime_rota_secoes').update({ parada }).eq('rota_id', rotaId).eq('secao_id', secaoId);
  if (error) { showToast('⚠ ' + error.message); return; }
  if (rtRotaTemTipoLegado(rota)) {
    await sb.from('sime_secoes').update({ parada }).eq('id', secaoId).eq('rota_id', rotaId);
  }
  const arr = rtDados.secoesPorRota.get(rotaId) || [];
  const s = arr.find(x => x.id === secaoId);
  if (s) s.parada = parada;
  showToast('✓ Ordem atualizada');
}

// rtCarregar({silencioso:true}) recarrega sem tocar na tela — o modal de
// seções continua aberto (rtSecoesModalRotaId não muda) e precisa
// re-renderizar ele mesmo em cima do dado novo, senão ele fecharia sozinho
// ao perder rtDados; render() por fora redesenha a lista de rotas por trás
// (contagem de seções nos cards muda também).
async function rtRenderModalSecoesAposRecarregar(rotaId) {
  await rtCarregar({ silencioso: true });
  rtSecoesModalRotaId = rotaId;
  rtRenderModalSecoes();
  render();
}
