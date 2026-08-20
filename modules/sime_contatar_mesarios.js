// ══════════════════════════════════════
// CONTATAR MESÁRIOS — quem falta contactar, quem recusou, quem disse que
// não é a pessoa procurada, e o meio alternativo (Carta Registrada/Oficial
// de Justiça) pra quem não responde por WhatsApp.
// ══════════════════════════════════════
//
// "Contato incorreto" (recusou → não é a pessoa) é reclassificação MANUAL do
// cartório, não automática — o Hermes hoje grava 'recusou' tanto pra "não
// sou eu" quanto pra "sou eu mas não vou atuar" (ver comment na coluna
// confirmacao, sql/SIME_atores_meio_contato.sql). O cartório lê o recado
// (observação, anexado por api/hermes-mesarios.js ação 'atualizar') e decide.

const CM_BUCKETS = [
  { valor: '',                  label: 'Todos' },
  { valor: 'pendente',          label: '❌ Falta contactar / sem resposta' },
  { valor: 'confirmado',        label: '✅ Confirmados' },
  { valor: 'recusou',           label: '⚠️ Recusou (é a pessoa certa)' },
  { valor: 'contato_incorreto', label: '🔍 Contato incorreto (não é a pessoa)' },
  { valor: 'substituido',       label: '🔁 Substituído' },
];
const CM_MEIO_LABEL = { whatsapp: 'WhatsApp', carta_registrada: 'Carta Registrada', oficial_justica: 'Oficial de Justiça' };
const CM_STATUS_ALT_LABEL = { a_enviar: 'A enviar', enviado: 'Enviado', entregue: 'Entregue', devolvido: 'Devolvido' };

let cmDados = null; // { pessoas:[...], secoesPorId:{} }
let cmFiltroStatus = '';
let cmBusca = '';
let cmModalId = null;   // id do ator com o modal aberto (só um por vez)
let cmModalHist = null; // { campanhas:[...], logs:[...] } | null enquanto carrega

const CM_CAMP_STATUS_LABEL = { pendente: 'Na fila do Hermes', enviado: 'Enviado', erro: 'Erro no envio' };
const CM_LOG_LABEL = {
  mesario_editar_telefone: () => 'Telefone atualizado manualmente',
  mesario_editar_rastreio: () => 'Código de rastreio atualizado',
  mesario_meio_contato: (p) => `Meio de contato → ${CM_MEIO_LABEL[p.meio_contato] || p.meio_contato}`,
  mesario_status_contato_alt: (p) => `Status do envio → ${CM_STATUS_ALT_LABEL[p.status] || p.status || '—'}`,
  mesario_contato_incorreto: () => 'Marcado como contato incorreto',
};

function cmEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function cmCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { cmDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: pessoas, error: e1 }, { data: secoes, error: e2 }] = await Promise.all([
    sb.from('sime_atores')
      .select('id, nome_completo, telefone_whatsapp, funcao_mesa, secao_id, confirmacao, ativo, observacao, meio_contato, status_contato_alternativo, codigo_rastreio, inscricao_eleitoral')
      .eq('zona_id', zonaId).eq('funcao', 'mesario').eq('ativo', true).order('nome_completo'),
    sb.from('sime_secoes').select('id, numero, local_nome, municipio').eq('zona_id', zonaId),
  ]);
  if (e1 || e2) { cmDados = { erro: (e1 || e2).message }; render(); return; }

  cmDados = { pessoas: pessoas || [], secoesPorId: Object.fromEntries((secoes || []).map(s => [s.id, s])) };
  render();
}

async function cmMarcarContatoIncorreto(id) {
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_atores').update({ confirmacao: 'contato_incorreto' }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  const p = cmDados.pessoas.find(x => x.id === id);
  if (p) p.confirmacao = 'contato_incorreto';
  await log('mesario_contato_incorreto', '', { ator_id: id });
  showToast('🔍 Marcado como contato incorreto — busque um novo contato');
  render();
}

async function cmSalvarMeio(id, meio) {
  const sb = window.supabaseAtores;
  const patch = { meio_contato: meio };
  // Trocar pra WhatsApp não faz sentido manter um status de envio de carta/ofício pendurado.
  if (meio === 'whatsapp') patch.status_contato_alternativo = null;
  const { error } = await sb.from('sime_atores').update(patch).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  const p = cmDados.pessoas.find(x => x.id === id);
  if (p) { p.meio_contato = meio; if (meio === 'whatsapp') p.status_contato_alternativo = null; }
  await log('mesario_meio_contato', '', { ator_id: id, meio_contato: meio });
  showToast('✓ Meio de contato atualizado');
  render();
}

async function cmSalvarStatusAlt(id, status) {
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_atores').update({ status_contato_alternativo: status || null }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  const p = cmDados.pessoas.find(x => x.id === id);
  if (p) p.status_contato_alternativo = status || null;
  await log('mesario_status_contato_alt', '', { ator_id: id, status });
  showToast('✓ Status de envio atualizado');
}

function cmLinkRastreio(codigo) {
  return 'https://rastreamento.correios.com.br/app/index.php?objetos=' + encodeURIComponent(codigo);
}

function cmFmtDataHist(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function cmPessoaModal() {
  return cmDados?.pessoas?.find(x => x.id === cmModalId) || null;
}

// Clicar no nome abre o modal: telefone/rastreio editáveis (um "Salvar" só,
// não um por campo) + duas listas de histórico — tentativas de contato (a
// fila de campanha do Hermes, sime_campanhas_confirmacao) e atualizações
// (sime_logs desta tela, casando por payload->>ator_id). Renderiza a casca
// na hora (sem travar no clique) e busca o histórico em paralelo, só
// re-renderizando quando chega — cmModalId muda de novo se o usuário trocar
// de pessoa antes da resposta voltar, então o resultado tardio é descartado.
async function cmAbrirModal(id) {
  cmModalId = id;
  cmModalHist = null;
  cmRenderModal();
  document.getElementById('overlay')?.classList.add('open');

  const sb = window.supabaseAtores;
  const [{ data: campanhas }, { data: logs }] = await Promise.all([
    sb.from('sime_campanhas_confirmacao')
      .select('id, mensagem_enviada, status, created_at')
      .eq('ator_id', id).order('created_at', { ascending: false }).limit(10),
    sb.from('sime_logs')
      .select('ts, acao, payload')
      .eq('payload->>ator_id', id).order('ts', { ascending: false }).limit(10),
  ]);
  if (cmModalId !== id) return; // trocou de pessoa enquanto carregava
  cmModalHist = {
    campanhas: campanhas || [],
    logs: (logs || []).filter(l => CM_LOG_LABEL[l.acao]),
  };
  cmRenderModal();
}

function cmFecharModal(e) {
  if (!e || e.target === document.getElementById('overlay')) {
    document.getElementById('overlay')?.classList.remove('open');
    cmModalId = null;
    cmModalHist = null;
  }
}

function cmListaHist(itens, vazio, linha) {
  if (!itens.length) return `<div class="ic-sub" style="margin-bottom:0">${vazio}</div>`;
  return `<div class="m-hist">${itens.map(linha).join('')}</div>`;
}

function cmRenderModal() {
  const modal = document.getElementById('modal-body');
  if (!modal) return;
  const p = cmPessoaModal();
  if (!p) { modal.innerHTML = ''; return; }
  const sec = p.secao_id ? cmDados.secoesPorId[p.secao_id] : null;

  const blocoCampanhas = cmModalHist === null
    ? '<div class="ic-sub" style="margin-bottom:0">Carregando…</div>'
    : cmListaHist(cmModalHist.campanhas, 'Nenhuma campanha enviada pra essa pessoa ainda.',
        c => `<div class="m-hist-item"><b>${cmFmtDataHist(c.created_at)}</b> — ${cmEsc(CM_CAMP_STATUS_LABEL[c.status] || c.status || '—')}${c.mensagem_enviada ? ` — "${cmEsc(c.mensagem_enviada.slice(0, 60))}${c.mensagem_enviada.length > 60 ? '…' : ''}"` : ''}</div>`);

  const blocoLogs = cmModalHist === null
    ? '<div class="ic-sub" style="margin-bottom:0">Carregando…</div>'
    : cmListaHist(cmModalHist.logs, 'Nenhuma atualização registrada ainda.',
        l => `<div class="m-hist-item"><b>${cmFmtDataHist(l.ts)}</b> — ${cmEsc((CM_LOG_LABEL[l.acao] || (() => l.acao))(l.payload || {}))}</div>`);

  modal.innerHTML = `
    <div class="m-hdr">
      <div class="m-title">${cmEsc(p.nome_completo)}</div>
      <button class="close-btn" aria-label="Fechar" onclick="cmFecharModal()">✕</button>
    </div>
    <div class="m-body">
      <div class="ic-sub" style="margin-bottom:0">
        ${cmEsc(p.funcao_mesa || '')}${sec ? ` — Seção ${sec.numero} (${cmEsc(sec.local_nome || '')}, ${cmEsc(sec.municipio || '')})` : ''}
        ${p.inscricao_eleitoral ? ` · Título ${cmEsc(p.inscricao_eleitoral)}` : ''}
      </div>
      ${p.observacao ? `<div class="ic-sub" style="background:var(--bg2);border-radius:6px;padding:6px 8px;white-space:pre-wrap;margin-bottom:0">${cmEsc(p.observacao)}</div>` : ''}
      <div class="form-group">
        <label>Telefone (WhatsApp)</label>
        <input id="mm-tel" type="text" value="${cmEsc(fmtTelefone(p.telefone_whatsapp || ''))}" placeholder="(86) 9xxxx-xxxx">
      </div>
      <div class="form-group">
        <label>Código de rastreio (Correios)</label>
        <input id="mm-rastreio" type="text" value="${cmEsc(p.codigo_rastreio || '')}" placeholder="AA123456789BR" style="text-transform:uppercase">
        ${p.codigo_rastreio ? `<div style="margin-top:4px"><a href="${cmLinkRastreio(p.codigo_rastreio)}" target="_blank" rel="noopener" style="font-size:.72rem">📦 Rastrear no site dos Correios</a></div>` : ''}
      </div>
      <div>
        <div style="font-size:.72rem;font-weight:700;color:var(--text2);margin-bottom:6px">📞 Tentativas de contato (campanhas)</div>
        ${blocoCampanhas}
      </div>
      <div>
        <div style="font-size:.72rem;font-weight:700;color:var(--text2);margin-bottom:6px">📜 Atualizações</div>
        ${blocoLogs}
      </div>
    </div>
    <div class="m-foot">
      <button class="btn btn-out" onclick="cmFecharModal()">Fechar</button>
      <button class="btn btn-dark" onclick="cmSalvarModal()">💾 Salvar</button>
    </div>`;
}

async function cmSalvarModal() {
  const id = cmModalId;
  const p = cmPessoaModal();
  if (!p) return;
  const sb = window.supabaseAtores;
  const tel = document.getElementById('mm-tel').value.replace(/\D/g, '');
  const rastreio = document.getElementById('mm-rastreio').value.trim().toUpperCase();
  const patch = {};
  if (tel !== (p.telefone_whatsapp || '')) patch.telefone_whatsapp = tel || null;
  if (rastreio !== (p.codigo_rastreio || '')) patch.codigo_rastreio = rastreio || null;
  if (!Object.keys(patch).length) { cmFecharModal(); return; }

  const { error } = await sb.from('sime_atores').update(patch).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  Object.assign(p, patch);
  if ('telefone_whatsapp' in patch) await log('mesario_editar_telefone', '', { ator_id: id });
  if ('codigo_rastreio' in patch) await log('mesario_editar_rastreio', '', { ator_id: id });
  showToast('✓ Dados atualizados');
  cmFecharModal();
  render();
}

function cmFiltrar() {
  const q = cmBusca.trim().toLowerCase();
  return cmDados.pessoas.filter(p => {
    if (cmFiltroStatus && p.confirmacao !== cmFiltroStatus) return false;
    if (q && !(p.nome_completo || '').toLowerCase().includes(q) && !(p.inscricao_eleitoral || '').includes(q)) return false;
    return true;
  });
}

// Manda o filtro atual (ex.: só "falta contactar") pra aba Disparo em massa
// de SIME_atores.html, já com esse grupo selecionado — reaproveita o motor
// de campanha que já existe lá (modelo, script salvo, imagem) em vez de
// duplicar essa UI aqui dentro. sessionStorage porque são páginas HTML
// separadas, sem estado JS compartilhado; a chave é lida e apagada no
// primeiro uso (não deve sobreviver a uma segunda visita da aba).
function cmCriarCampanha() {
  const alvo = cmFiltrar().filter(p => p.telefone_whatsapp);
  if (!alvo.length) { showToast('⚠ Nenhum mesário com WhatsApp nesse filtro'); return; }
  sessionStorage.setItem('sime_disparo_preselecao', JSON.stringify(alvo.map(p => p.id)));
  location.href = './SIME_atores.html?tab=disparo';
}

function cmBadge(confirmacao) {
  const b = CM_BUCKETS.find(x => x.valor === (confirmacao || 'pendente'));
  return b ? b.label : confirmacao;
}

function renderContatarMesarios() {
  const c = document.getElementById('content');
  if (!window.supabaseAtores) {
    c.innerHTML = '<div class="import-card"><div class="import-result ir-warn">Entre com a conta da equipe.</div></div>';
    return;
  }
  if (!cmDados) {
    c.innerHTML = '<div class="import-card"><div class="ic-title">📞 Contatar mesários</div><div class="ic-sub">Carregando…</div></div>';
    cmCarregar();
    return;
  }
  if (cmDados.erro) {
    c.innerHTML = `<div class="import-card"><div class="import-result ir-warn">⚠ ${cmEsc(cmDados.erro)}</div></div>`;
    return;
  }

  const contagem = {};
  for (const p of cmDados.pessoas) contagem[p.confirmacao || 'pendente'] = (contagem[p.confirmacao || 'pendente'] || 0) + 1;
  const lista = cmFiltrar();

  c.innerHTML = `
    <div class="import-card">
      <div class="ic-title">📞 Contatar mesários</div>
      <div class="ic-sub">Quem falta contactar, quem recusou, e quem precisa de outro meio de contato (Carta Registrada/Oficial
        de Justiça) quando o WhatsApp não funciona.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <select id="cm-filtro" onchange="cmFiltroStatus=this.value;render()">
          ${CM_BUCKETS.map(b => `<option value="${b.valor}" ${cmFiltroStatus === b.valor ? 'selected' : ''}>${b.label}${b.valor ? ` (${contagem[b.valor] || 0})` : ` (${cmDados.pessoas.length})`}</option>`).join('')}
        </select>
        <input type="text" placeholder="Buscar por nome ou título de eleitor…" value="${cmEsc(cmBusca)}" oninput="cmBusca=this.value;render()" style="flex:1;min-width:160px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="ic-sub" style="margin-bottom:0">${lista.length} de ${cmDados.pessoas.length} mesário(s)</div>
        <button class="btn btn-dark" style="font-size:.74rem;padding:6px 12px" onclick="cmCriarCampanha()">📢 Criar campanha com estes (${lista.filter(p => p.telefone_whatsapp).length})</button>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${lista.map(p => {
        const sec = p.secao_id ? cmDados.secoesPorId[p.secao_id] : null;
        const podeMarcarIncorreto = p.confirmacao === 'recusou';
        return `
        <div class="import-card" style="padding:12px 14px">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:flex-start">
            <div>
              <div style="font-weight:800;cursor:pointer" onclick="cmAbrirModal('${p.id}')" title="Clique para editar e ver histórico">${cmEsc(p.nome_completo)} <span style="font-weight:400;font-size:.78rem;color:var(--text2)">✎</span></div>
              <div class="ic-sub" style="margin-bottom:0">
                ${cmEsc(p.funcao_mesa || '')}${sec ? ` — Seção ${sec.numero} (${cmEsc(sec.local_nome || '')}, ${cmEsc(sec.municipio || '')})` : ''}
              </div>
              ${p.inscricao_eleitoral ? `<div class="ic-sub" style="margin-bottom:0">Título ${cmEsc(p.inscricao_eleitoral)}</div>` : ''}
              ${p.telefone_whatsapp ? `<div class="ic-sub" style="margin-bottom:0">${linkWhatsApp(p.telefone_whatsapp) ? `<a href="${linkWhatsApp(p.telefone_whatsapp)}" target="_blank" rel="noopener">${fmtTelefone(p.telefone_whatsapp)}</a>` : fmtTelefone(p.telefone_whatsapp)}</div>` : '<div class="ic-sub" style="margin-bottom:0">Sem telefone cadastrado</div>'}
            </div>
            <span class="import-result ${p.confirmacao === 'confirmado' ? 'ir-ok' : p.confirmacao === 'recusou' || p.confirmacao === 'contato_incorreto' ? 'ir-warn' : ''}" style="margin-top:0;white-space:nowrap">${cmBadge(p.confirmacao)}</span>
          </div>
          ${p.observacao ? `<div class="ic-sub" style="margin-top:8px;background:var(--bg2);border-radius:6px;padding:6px 8px;white-space:pre-wrap">${cmEsc(p.observacao)}</div>` : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
            <label style="font-size:.72rem;color:var(--text2)">Meio de contato:
              <select onchange="cmSalvarMeio('${p.id}',this.value)" style="margin-left:4px">
                ${Object.entries(CM_MEIO_LABEL).map(([v, l]) => `<option value="${v}" ${p.meio_contato === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </label>
            ${p.meio_contato && p.meio_contato !== 'whatsapp' ? `
            <label style="font-size:.72rem;color:var(--text2)">Status do envio:
              <select onchange="cmSalvarStatusAlt('${p.id}',this.value)" style="margin-left:4px">
                <option value="">—</option>
                ${Object.entries(CM_STATUS_ALT_LABEL).map(([v, l]) => `<option value="${v}" ${p.status_contato_alternativo === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </label>` : ''}
            ${podeMarcarIncorreto ? `<button class="btn btn-out" style="font-size:.72rem;padding:5px 10px" onclick="cmMarcarContatoIncorreto('${p.id}')">🔍 Marcar contato incorreto</button>` : ''}
          </div>
        </div>`;
      }).join('') || '<div class="import-card"><div class="ic-sub" style="margin-bottom:0">Ninguém encontrado com esse filtro.</div></div>'}
    </div>`;
}
