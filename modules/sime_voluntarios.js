// sime_voluntarios.js — Cadastro de mesários voluntários (aba "🙋 Voluntários"
// de SIME_convocacao.html).
//
// Pedido direto (28/08/2026): "quero uma pagina para cadastrar os mesários
// voluntários. no cadastro deve ter cpf nome telefone e selecionar a função
// que quer trabalhar (mesário, apoio logistico, coordenador de
// acessibilidade, todas) e o local que quer trabalhar (cidade, e local de
// votação ou todos). para quando tiver que preencher alguma vaga ir
// selecionando os voluntários a medida que foram sendo cadastrados."
//
// Cadastro PARALELO ao roster oficial (sime_atores, que vem do TRE) — gente
// que se ofereceu como voluntária, esperando ser chamada quando uma vaga
// precisar de gente nova (ex.: quando alguém "precisa substituir", ver
// SIME_atores_convocado_status.sql). Só a equipe do cartório cadastra —
// mesmo padrão de acesso do resto de SIME_convocacao.html, sem trava de
// perfil — não é formulário público.
//
// Escopo desta v1, deliberado: é um REGISTRO com status (disponível/
// convocado/indisponível), não um automatismo que cria sime_atores sozinho —
// converter um voluntário num mesário oficial (secao_id, funcao_mesa,
// inscrição) continua sendo decisão manual do cartório pelas telas de
// sempre.

const VL_FUNCAO_LABEL = { mesario: 'Mesário (MRV)', auxiliar_eleicao: 'Apoio logístico', coord_acessibilidade: 'Coordenador(a) de Acessibilidade' };
const VL_STATUS_LABEL = { disponivel: '🟢 Disponível', convocado: '📋 Convocado', indisponivel: '⚪ Indisponível' };
const VL_STATUS_FILTRO = [
  { valor: '', label: 'Todos os status' },
  { valor: 'disponivel', label: '🟢 Disponíveis' },
  { valor: 'convocado', label: '📋 Já convocados' },
  { valor: 'indisponivel', label: '⚪ Indisponíveis' },
];

let vlDados = null; // { voluntarios:[...], municipiosPorZona:[...], locaisPorMunicipio:{...} }
let vlFiltroStatus = '';
let vlFiltroFuncao = '';
let vlFiltroMunicipio = '';
let vlBusca = '';
let vlModalId = null; // null = fechado; '' = criando novo; id = editando

function vlEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "000.000.000-00" pro CPF; título de eleitor fica cru (mesmo padrão de
// sime_atores.inscricao_eleitoral em todo o resto do sistema — nunca
// formatado com máscara). O que é gravado é sempre dígitos crus (mesmo
// padrão de telefone_whatsapp sem máscara).
function vlSoDigitos(s) { return String(s || '').replace(/\D/g, ''); }
function vlFmtDocumento(documento, tipo) {
  const d = vlSoDigitos(documento);
  if (tipo === 'cpf' && d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return documento || '—';
}
// Detecta CPF (11 dígitos) vs. título de eleitor (12) só pelo TAMANHO —
// pedido direto (28/08/2026): "podemos cadastrar cpf ou titulo, e digitando
// o numero ele escolhe se cpf ou titulo de eleitor". Mesma convenção de 12
// dígitos já usada em normalizarTituloEleitor() (sime_ui_utils.js). Nunca
// adivinha em cima de 11 dígitos "poderia ser um título sem o zero à
// esquerda" — 11 dígitos é CPF válido de sobra, então título incompleto
// exige o zero de propósito (mesmo problema documentado alhures pra
// inscricao_eleitoral: quem digitar sem o zero cai como CPF, precisa
// corrigir manualmente).
function vlDetectarTipoDocumento(digitos) {
  if (digitos.length === 11) return 'cpf';
  if (digitos.length === 12) return 'titulo';
  return null;
}

async function vlCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { vlDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: voluntarios, error: e1 }, { data: secoes, error: e2 }] = await Promise.all([
    sb.from('sime_voluntarios').select('*').eq('zona_id', zonaId).eq('ativo', true).order('created_at', { ascending: false }),
    sb.from('sime_secoes').select('municipio, local_nome').eq('zona_id', zonaId),
  ]);
  if (e1 || e2) { vlDados = { erro: (e1 || e2).message }; render(); return; }

  // Município → conjunto de locais (pro 2º <select> do formulário/filtro,
  // derivado das seções reais da zona — mesma fonte que o resto do sistema
  // usa pra essas duas dimensões, sem precisar de tabela própria).
  const locaisPorMunicipio = {};
  for (const s of secoes || []) {
    if (!s.municipio) continue;
    (locaisPorMunicipio[s.municipio] ||= new Set()).add(s.local_nome || '');
  }
  const municipios = Object.keys(locaisPorMunicipio).sort();
  for (const m of municipios) locaisPorMunicipio[m] = [...locaisPorMunicipio[m]].filter(Boolean).sort();

  vlDados = { voluntarios: voluntarios || [], municipios, locaisPorMunicipio, zonaId };
  // Conferência automática (30/08/2026, pedido direto: "quero que o sistema
  // verifique se os mesários voluntarios já foram atribuidos na parte de
  // convocação e ja marcar como convocado") — roda sozinha toda vez que a
  // aba carrega, silenciosa quando não muda nada (não incomoda o cartório
  // todo dia com um toast à toa); vlVerificarAtribuicoes() já chama render().
  await vlVerificarAtribuicoes({ silencioso: true });
}

// Casa voluntário ↔ roster oficial só por TÍTULO DE ELEITOR — `sime_atores`
// não tem coluna de CPF nenhuma (só o TRE tem esse dado, fora do SIME), então
// um voluntário cadastrado com CPF não tem como ser conferido sozinho; fica
// como está até o cartório mesmo confirmar (mesmo critério "nunca adivinha"
// de sempre). "Atribuído" aqui significa "já existe uma designação ativa no
// roster com esse título" — não exige confirmação, só presença.
async function vlVerificarAtribuicoes(opts = {}) {
  const sb = window.supabaseAtores;
  if (!vlDados || vlDados.erro) return;
  const zonaId = vlDados.zonaId;
  const candidatos = (vlDados.voluntarios || []).filter(v => v.tipo_documento === 'titulo' && v.status !== 'convocado');

  const { data: atores, error } = candidatos.length
    ? await sb.from('sime_atores')
        .select('id, inscricao_eleitoral, funcao, funcao_mesa, secao_id')
        .eq('zona_id', zonaId).eq('ativo', true)
    : { data: [], error: null };
  if (error) { if (!opts.silencioso) showToast('⚠ ' + error.message); render(); return; }

  const porTitulo = new Map();
  for (const a of atores || []) if (a.inscricao_eleitoral) porTitulo.set(a.inscricao_eleitoral, a);
  vlDados.atoresPorId = new Map((atores || []).map(a => [a.id, a]));

  let marcados = 0;
  if (candidatos.length) {
    const { data: ts } = await sb.rpc('sime_now');
    for (const v of candidatos) {
      const ator = porTitulo.get(v.documento);
      if (!ator) continue;
      const { error: eUp } = await sb.from('sime_voluntarios')
        .update({ status: 'convocado', ator_id: ator.id, updated_at: ts })
        .eq('id', v.id);
      if (eUp) continue;
      v.status = 'convocado';
      v.ator_id = ator.id;
      await log('voluntario_convocado_auto', '', {
        id: v.id, nome: v.nome, documento: v.documento, ator_id: ator.id,
        funcao_atribuida: ator.funcao_mesa || VL_FUNCAO_LABEL[ator.funcao] || ator.funcao,
      });
      marcados++;
    }
  }

  if (marcados) {
    showToast(`✓ ${marcados} voluntário(s) já estava(m) no roster oficial — marcado(s) como convocado`);
  } else if (!opts.silencioso) {
    showToast('Nenhum voluntário novo encontrado no roster oficial (conferência é só por título de eleitor)');
  }
  render();
}

function vlFiltrar() {
  const q = vlBusca.trim().toLowerCase();
  return (vlDados.voluntarios || []).filter(v => {
    if (vlFiltroStatus && v.status !== vlFiltroStatus) return false;
    // funcoes vazio = "qualquer função" — sempre casa com qualquer filtro;
    // só exclui quando a lista É específica e não inclui a função filtrada.
    if (vlFiltroFuncao && (v.funcoes || []).length && !v.funcoes.includes(vlFiltroFuncao)) return false;
    // município null = "qualquer município" — mesma lógica: só exclui
    // quando o voluntário tem um município específico diferente do filtro.
    if (vlFiltroMunicipio && v.municipio && v.municipio !== vlFiltroMunicipio) return false;
    if (q) {
      // Bug real: com a query sem dígito nenhum, `''.includes('')` do CPF
      // sempre batia (string vazia é substring de qualquer coisa) e anulava
      // o filtro por nome — buscar "ana" continuava mostrando todo mundo.
      // Só compara CPF quando a busca de fato tem dígito pra comparar.
      const digitos = q.replace(/\D/g, '');
      const bateNome = (v.nome || '').toLowerCase().includes(q);
      const bateDocumento = digitos && vlSoDigitos(v.documento).includes(digitos);
      if (!bateNome && !bateDocumento) return false;
    }
    return true;
  });
}

function vlBadgeFuncoes(v) {
  if (!v.funcoes || !v.funcoes.length) return 'Qualquer função';
  return v.funcoes.map(f => VL_FUNCAO_LABEL[f] || f).join(', ');
}
function vlBadgeLocal(v) {
  if (!v.municipio) return 'Qualquer município';
  return v.local_votacao ? `${vlEsc(v.municipio)} — ${vlEsc(v.local_votacao)}` : `${vlEsc(v.municipio)} (qualquer local)`;
}
// Só existe pra quem a conferência automática (vlVerificarAtribuicoes) já
// achou no roster — nada mais escreve em ator_id ainda.
function vlBadgeAtribuido(v) {
  if (!v.ator_id) return '';
  const ator = vlDados.atoresPorId?.get(v.ator_id);
  const cargo = ator ? (ator.funcao_mesa || VL_FUNCAO_LABEL[ator.funcao] || ator.funcao) : null;
  return `🔗 Já designado no roster oficial${cargo ? ` — ${vlEsc(cargo)}` : ''}`;
}

function renderVoluntarios() {
  const content = document.getElementById('content');
  if (!vlDados) { content.innerHTML = '<div class="import-card">Carregando…</div>'; vlCarregar(); return; }
  if (vlDados.erro) { content.innerHTML = `<div class="import-card"><div class="import-result ir-err">⚠ ${vlEsc(vlDados.erro)}</div></div>`; return; }

  const lista = vlFiltrar();
  const contagem = {};
  for (const v of vlDados.voluntarios) contagem[v.status] = (contagem[v.status] || 0) + 1;

  content.innerHTML = `
    <div class="import-card">
      <div class="ic-title">🙋 Voluntários</div>
      <div class="ic-sub">Cadastro de quem se ofereceu pra ajudar como mesário, apoio logístico ou coordenador de acessibilidade — separado do roster oficial do TRE. Use pra ter de onde tirar gente quando uma vaga precisar ser preenchida (ex.: alguém marcado "precisa substituir" na aba Contatar mesários).</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-dark" onclick="vlAbrirNovo()">➕ Novo voluntário</button>
        <button class="btn btn-out" onclick="vlVerificarAtribuicoes()" title="Confere quem já tem título de eleitor batendo com o roster oficial (sime_atores) e marca como convocado">🔄 Verificar atribuições</button>
      </div>
      <div class="ic-sub" style="margin:6px 0 0">A conferência já roda sozinha toda vez que essa aba abre — o botão é só pra checar de novo na hora, sem sair e voltar (ex.: logo depois de sincronizar o roster). Só confere quem se cadastrou com título de eleitor — CPF não dá pra cruzar com o roster oficial.</div>
    </div>

    <div class="import-card">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <select id="vl-filtro-status" onchange="vlFiltroStatus=this.value;render()">
          ${VL_STATUS_FILTRO.map(b => `<option value="${b.valor}" ${vlFiltroStatus === b.valor ? 'selected' : ''}>${b.label}${b.valor ? ` (${contagem[b.valor] || 0})` : ` (${vlDados.voluntarios.length})`}</option>`).join('')}
        </select>
        <select id="vl-filtro-funcao" onchange="vlFiltroFuncao=this.value;render()">
          <option value="">Todas as funções</option>
          ${Object.entries(VL_FUNCAO_LABEL).map(([v, l]) => `<option value="${v}" ${vlFiltroFuncao === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <select id="vl-filtro-municipio" onchange="vlFiltroMunicipio=this.value;render()">
          <option value="">Todos os municípios</option>
          ${vlDados.municipios.map(m => `<option value="${vlEsc(m)}" ${vlFiltroMunicipio === m ? 'selected' : ''}>${vlEsc(m)}</option>`).join('')}
        </select>
        <input type="text" placeholder="Buscar por nome ou CPF…" value="${vlEsc(vlBusca)}" oninput="vlBusca=this.value;render()" style="flex:1;min-width:160px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
      </div>
      <div class="ic-sub" style="margin-bottom:0">${lista.length} de ${vlDados.voluntarios.length} voluntário(s)</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px">
      ${lista.length ? lista.map(v => `
      <div class="import-card" style="padding:12px 14px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
          <div>
            <div style="font-weight:800;font-size:.86rem;cursor:pointer" onclick="vlAbrirEditar('${v.id}')">${vlEsc(v.nome)}</div>
            <div class="ic-sub" style="margin:2px 0 0">${v.tipo_documento === 'titulo' ? 'Título' : 'CPF'} ${vlEsc(vlFmtDocumento(v.documento, v.tipo_documento))} · ${vlBadgeFuncoes(v)} · ${vlBadgeLocal(v)}</div>
            ${v.observacao ? `<div class="ic-sub" style="margin:2px 0 0">${vlEsc(v.observacao)}</div>` : ''}
            ${v.ator_id ? `<div class="ic-sub" style="margin:2px 0 0;color:var(--green,#2e7d32)">${vlBadgeAtribuido(v)}</div>` : ''}
          </div>
          <span class="import-result ${v.status === 'disponivel' ? 'ir-ok' : v.status === 'indisponivel' ? '' : 'ir-warn'}" style="margin-top:0;white-space:nowrap">${VL_STATUS_LABEL[v.status] || v.status}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">
          ${v.telefone_whatsapp ? `<button class="btn btn-out" style="font-size:.7rem;padding:5px 10px" onclick="vlCopiarLink('${v.id}')" title="Copiar link do WhatsApp">💬 ${vlEsc(fmtTelefone(v.telefone_whatsapp))}</button>` : '<span class="ic-sub" style="margin:0">Sem telefone</span>'}
          <button class="btn ${v.status === 'disponivel' ? 'btn-dark' : 'btn-out'}" style="font-size:.7rem;padding:5px 10px" onclick="vlMudarStatus('${v.id}','disponivel')">🟢 Disponível</button>
          <button class="btn ${v.status === 'convocado' ? 'btn-dark' : 'btn-out'}" style="font-size:.7rem;padding:5px 10px" onclick="vlMudarStatus('${v.id}','convocado')">📋 Convocado</button>
          <button class="btn ${v.status === 'indisponivel' ? 'btn-dark' : 'btn-out'}" style="font-size:.7rem;padding:5px 10px" onclick="vlMudarStatus('${v.id}','indisponivel')">⚪ Indisponível</button>
          <button class="btn btn-out" style="font-size:.7rem;padding:5px 10px" onclick="vlAbrirEditar('${v.id}')">✏️ Editar</button>
          <button class="btn btn-out" style="font-size:.7rem;padding:5px 10px" onclick="vlRemover('${v.id}')">✕ Remover</button>
        </div>
      </div>`).join('') : '<div class="import-card"><div class="ic-sub" style="margin-bottom:0">Nenhum voluntário cadastrado ainda com esse filtro.</div></div>'}
    </div>
  `;
}

function vlAbrirNovo() { vlModalId = ''; vlRenderModal(); }
function vlAbrirEditar(id) { vlModalId = id; vlRenderModal(); }
// Mesmo guard de cmFecharModal() (sime_contatar_mesarios.js) — o clique
// dentro do modal também borbulha até #overlay (é um filho dele), então sem
// checar `e.target === overlay` (só true clicando no fundo escuro) qualquer
// clique dentro do formulário fecharia o modal sozinho.
function vlFecharModal(e) {
  if (vlModalId === null) return; // modal de voluntário nem estava aberto — não mexe no overlay compartilhado
  if (!e || e.target === document.getElementById('overlay')) {
    vlModalId = null;
    document.getElementById('overlay')?.classList.remove('open');
  }
}

function vlRenderModal() {
  const v = vlModalId ? (vlDados.voluntarios || []).find(x => x.id === vlModalId) : null;
  const isNovo = vlModalId === '';
  const funcoesAtuais = v?.funcoes || [];
  const qualquerFuncao = !funcoesAtuais.length;
  const municipioAtual = v?.municipio || '';
  const locais = municipioAtual ? (vlDados.locaisPorMunicipio[municipioAtual] || []) : [];

  // Defesa: #modal-body é compartilhado com o modal de "Contatar mesários",
  // que se marca com `cm-modal-wide` (tela cheia/colunas no desktop) — esse
  // modal aqui nunca deve herdar isso.
  document.getElementById('modal-body')?.classList.remove('cm-modal-wide');
  document.getElementById('modal-body').innerHTML = `
    <div class="m-hdr">
      <div class="m-title">${isNovo ? '➕ Novo voluntário' : '✏️ Editar voluntário'}</div>
      <button class="close-btn" aria-label="Fechar" onclick="vlFecharModal()">✕</button>
    </div>
    <div class="m-body">
      <div class="form-group"><label for="vl-nome">Nome completo</label>
        <input type="text" id="vl-nome" value="${vlEsc(v?.nome || '')}" placeholder="Nome do voluntário"></div>
      <div class="form-group"><label for="vl-doc">CPF ou título de eleitor</label>
        <input type="text" id="vl-doc" value="${v ? vlFmtDocumento(v.documento, v.tipo_documento) : ''}" placeholder="000.000.000-00 ou nº do título (12 dígitos)" maxlength="20">
        <div class="dz-sub" style="margin-top:2px">11 dígitos = CPF · 12 dígitos = título de eleitor — detectado sozinho pelo tamanho</div></div>
      <div class="form-group"><label for="vl-tel">WhatsApp (opcional)</label>
        <input type="text" id="vl-tel" value="${v?.telefone_whatsapp ? vlEsc(fmtTelefone(v.telefone_whatsapp)) : ''}" placeholder="(86) 9xxxx-xxxx"></div>

      <div class="form-group"><label>Função que quer trabalhar</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:.8rem;margin-top:4px;cursor:pointer">
          <input type="checkbox" id="vl-func-qualquer" ${qualquerFuncao ? 'checked' : ''} onchange="vlToggleFuncaoQualquer()"> Qualquer função
        </label>
        ${Object.entries(VL_FUNCAO_LABEL).map(([k, l]) => `
        <label style="display:flex;align-items:center;gap:6px;font-size:.8rem;margin-top:4px;cursor:pointer">
          <input type="checkbox" class="vl-func-especifica" value="${k}" ${funcoesAtuais.includes(k) ? 'checked' : ''} ${qualquerFuncao ? 'disabled' : ''}> ${l}
        </label>`).join('')}
      </div>

      <div class="form-group"><label for="vl-municipio">Município que quer trabalhar</label>
        <select id="vl-municipio" onchange="vlOnMunicipioChange()">
          <option value="">Qualquer município</option>
          ${vlDados.municipios.map(m => `<option value="${vlEsc(m)}" ${municipioAtual === m ? 'selected' : ''}>${vlEsc(m)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" id="vl-grp-local" style="${municipioAtual ? '' : 'display:none'}">
        <label for="vl-local">Local de votação</label>
        <select id="vl-local">
          <option value="">Qualquer local (neste município)</option>
          ${locais.map(l => `<option value="${vlEsc(l)}" ${v?.local_votacao === l ? 'selected' : ''}>${vlEsc(l)}</option>`).join('')}
        </select>
      </div>

      <div class="form-group"><label for="vl-obs">Observação (opcional)</label>
        <input type="text" id="vl-obs" value="${vlEsc(v?.observacao || '')}" placeholder="ex: disponível só de manhã"></div>
    </div>
    <div class="m-foot">
      <button class="btn btn-out" onclick="vlFecharModal()">Cancelar</button>
      <button class="btn btn-dark" onclick="vlSalvar()">💾 Salvar</button>
    </div>`;
  document.getElementById('overlay').classList.add('open');
}

function vlToggleFuncaoQualquer() {
  const qualquer = document.getElementById('vl-func-qualquer').checked;
  document.querySelectorAll('.vl-func-especifica').forEach(el => { el.disabled = qualquer; if (qualquer) el.checked = false; });
}
function vlOnMunicipioChange() {
  const m = document.getElementById('vl-municipio').value;
  const grp = document.getElementById('vl-grp-local');
  const locais = m ? (vlDados.locaisPorMunicipio[m] || []) : [];
  grp.style.display = m ? '' : 'none';
  document.getElementById('vl-local').innerHTML = `<option value="">Qualquer local (neste município)</option>${locais.map(l => `<option value="${vlEsc(l)}">${vlEsc(l)}</option>`).join('')}`;
}

async function vlSalvar() {
  const sb = window.supabaseAtores;
  const nome = document.getElementById('vl-nome').value.trim();
  const documento = vlSoDigitos(document.getElementById('vl-doc').value);
  if (!nome) { showToast('⚠ Nome obrigatório'); return; }
  const tipo_documento = vlDetectarTipoDocumento(documento);
  if (!tipo_documento) { showToast('⚠ Digite um CPF (11 dígitos) ou título de eleitor (12 dígitos) válido'); return; }

  const qualquerFuncao = document.getElementById('vl-func-qualquer').checked;
  const funcoes = qualquerFuncao ? [] : [...document.querySelectorAll('.vl-func-especifica:checked')].map(el => el.value);
  if (!qualquerFuncao && !funcoes.length) { showToast('⚠ Escolha ao menos uma função, ou marque "Qualquer função"'); return; }

  const municipio = document.getElementById('vl-municipio').value || null;
  const local_votacao = municipio ? (document.getElementById('vl-local').value || null) : null;
  const telDigitos = telSemPais(document.getElementById('vl-tel').value);
  const telefone_whatsapp = telDigitos ? '55' + telDigitos : null;
  const observacao = document.getElementById('vl-obs').value.trim() || null;

  const zonaId = vlDados.zonaId;
  const isNovo = vlModalId === '';

  try {
    if (isNovo) {
      const { data: { user } } = await sb.auth.getUser();
      const { data: meu } = await sb.from('sime_usuarios').select('id').eq('auth_user_id', user?.id).maybeSingle();
      const { error } = await sb.from('sime_voluntarios').insert({
        zona_id: zonaId, documento, tipo_documento, nome, telefone_whatsapp, funcoes, municipio, local_votacao, observacao,
        created_by: meu?.id || null,
      });
      if (error) {
        // CPF/título duplicado na mesma zona (idx_voluntarios_zona_documento)
        // — erro amigável em vez do "duplicate key" cru do Postgres.
        if (/duplicate key|unique constraint/i.test(error.message)) { showToast(`⚠ Já existe um voluntário com esse ${tipo_documento === 'titulo' ? 'título de eleitor' : 'CPF'} cadastrado nesta zona`); return; }
        showToast('⚠ ' + error.message); return;
      }
      await log('voluntario_cadastrado', '', { nome, documento, tipo_documento });
      showToast('✓ Voluntário cadastrado');
    } else {
      const { data: ts } = await sb.rpc('sime_now');
      const { error } = await sb.from('sime_voluntarios').update({
        nome, documento, tipo_documento, telefone_whatsapp, funcoes, municipio, local_votacao, observacao, updated_at: ts,
      }).eq('id', vlModalId);
      if (error) {
        if (/duplicate key|unique constraint/i.test(error.message)) { showToast(`⚠ Já existe um voluntário com esse ${tipo_documento === 'titulo' ? 'título de eleitor' : 'CPF'} cadastrado nesta zona`); return; }
        showToast('⚠ ' + error.message); return;
      }
      await log('voluntario_editado', '', { id: vlModalId, nome });
      showToast('✓ Dados atualizados');
    }
  } catch (e) {
    showToast('⚠ Falha ao salvar — verifique a conexão e tente de novo');
    return;
  }

  vlFecharModal();
  vlDados = null;
  render();
}

async function vlMudarStatus(id, novoStatus) {
  const sb = window.supabaseAtores;
  const v = (vlDados.voluntarios || []).find(x => x.id === id);
  if (!v) return;
  const { data: ts } = await sb.rpc('sime_now');
  const { error } = await sb.from('sime_voluntarios').update({ status: novoStatus, updated_at: ts }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  v.status = novoStatus;
  await log('voluntario_status', '', { id, status: novoStatus });
  showToast(`✓ Status: ${VL_STATUS_LABEL[novoStatus] || novoStatus}`);
  render();
}

// Soft-delete (sai da lista, mas o registro continua no banco pra
// auditoria) — pedido de sair da lista (desistiu, achou que não ia mais dar,
// etc.), sem apagar histórico.
async function vlRemover(id) {
  const sb = window.supabaseAtores;
  const v = (vlDados.voluntarios || []).find(x => x.id === id);
  if (!v) return;
  const { data: ts } = await sb.rpc('sime_now');
  const { error } = await sb.from('sime_voluntarios').update({ ativo: false, updated_at: ts }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  await log('voluntario_removido', '', { id, nome: v.nome });
  showToast('✓ Removido da lista');
  vlDados = null;
  render();
}

// Copia o link do WhatsApp já com uma mensagem simples de contato — mesmo
// padrão (copiar, não abrir direto) já usado em Contatar mesários.
async function vlCopiarLink(id) {
  const v = (vlDados.voluntarios || []).find(x => x.id === id);
  if (!v || !v.telefone_whatsapp) return;
  const msg = `Olá, ${v.nome}! Aqui é do cartório eleitoral — vi que você se cadastrou como voluntário(a) e gostaria de conversar sobre uma vaga.`;
  const link = linkWhatsApp(v.telefone_whatsapp, msg);
  if (!link) { showToast('⚠ Telefone inválido'); return; }
  try {
    await navigator.clipboard.writeText(link);
    showToast('🔗 Link do WhatsApp copiado');
  } catch (e) {
    showToast('⚠ Não deu pra copiar — copie manualmente');
  }
}
