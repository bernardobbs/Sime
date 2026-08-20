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

function cmEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function cmCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { cmDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: pessoas, error: e1 }, { data: secoes, error: e2 }] = await Promise.all([
    sb.from('sime_atores')
      .select('id, nome_completo, telefone_whatsapp, funcao_mesa, secao_id, confirmacao, ativo, observacao, meio_contato, status_contato_alternativo')
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

function cmFiltrar() {
  const q = cmBusca.trim().toLowerCase();
  return cmDados.pessoas.filter(p => {
    if (cmFiltroStatus && p.confirmacao !== cmFiltroStatus) return false;
    if (q && !(p.nome_completo || '').toLowerCase().includes(q)) return false;
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
        <input type="text" placeholder="Buscar por nome…" value="${cmEsc(cmBusca)}" oninput="cmBusca=this.value;render()" style="flex:1;min-width:160px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
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
              <div style="font-weight:800">${cmEsc(p.nome_completo)}</div>
              <div class="ic-sub" style="margin-bottom:0">
                ${cmEsc(p.funcao_mesa || '')}${sec ? ` — Seção ${sec.numero} (${cmEsc(sec.local_nome || '')}, ${cmEsc(sec.municipio || '')})` : ''}
              </div>
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
