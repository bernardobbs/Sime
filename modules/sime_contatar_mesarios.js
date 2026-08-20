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
  { valor: 'precisa_substituir', label: '🔁 Precisa ser substituído' },
  { valor: 'substituido',       label: '🔁 Já substituído' },
];
const CM_MEIO_LABEL = { whatsapp: 'WhatsApp', ligacao: 'Ligação telefônica', carta_registrada: 'Carta Registrada', oficial_justica: 'Oficial de Justiça' };
// Dois vocabulários de status diferentes pro mesmo campo (status_contato_alternativo)
// — "enviado/entregue" não faz sentido pra uma ligação, e "atendeu/não atendeu"
// não faz sentido pra uma carta. cmStatusLabelSet() escolhe qual mostrar.
const CM_STATUS_ALT_LABEL = { a_enviar: 'A enviar', enviado: 'Enviado', entregue: 'Entregue', devolvido: 'Devolvido' };
const CM_STATUS_LIGACAO_LABEL = { a_ligar: 'A ligar', atendeu: 'Atendeu', nao_atendeu: 'Não atendeu', numero_errado: 'Número errado' };
const CM_STATUS_ALL_LABEL = { ...CM_STATUS_ALT_LABEL, ...CM_STATUS_LIGACAO_LABEL };
function cmStatusLabelSet(meio) { return meio === 'ligacao' ? CM_STATUS_LIGACAO_LABEL : CM_STATUS_ALT_LABEL; }

let cmDados = null; // { pessoas:[...], secoesPorId:{} }
let cmFiltroStatus = '';
let cmBusca = '';
let cmModalId = null;   // id do ator com o modal aberto (só um por vez)
let cmModalHist = null; // { campanhas:[...], logs:[...] } | null enquanto carrega

const CM_CAMP_STATUS_LABEL = { pendente: 'Na fila do Hermes', enviado: 'Enviado', erro: 'Erro no envio' };
const CM_HERMES_ACAO_LABEL = { confirmar: 'Confirmou por WhatsApp', recusar: 'Recusou por WhatsApp', substituir: 'Avisou substituição por WhatsApp' };
// Ações que o SIME grava com payload.ator_id direto — casam por eq() simples.
const CM_LOG_LABEL = {
  mesario_editar_telefone: () => 'Telefone atualizado manualmente',
  mesario_editar_rastreio: () => 'Código de rastreio atualizado',
  mesario_meio_contato: (p) => `Meio de contato → ${CM_MEIO_LABEL[p.meio_contato] || p.meio_contato}`,
  mesario_status_contato_alt: (p) => `Status do contato → ${CM_STATUS_ALL_LABEL[p.status] || p.status || '—'}`,
  mesario_contato_incorreto: () => 'Marcado como contato incorreto',
  mesario_precisa_substituir: (p) => p.precisa_substituir ? 'Marcado para substituição' : 'Desmarcado da substituição',
};
// Ações que o Hermes grava (api/hermes-mesarios.js) — não têm payload.ator_id
// direto, têm payload.afetados como lista de {id, nome, ...} (a mesma
// resposta pode afetar mesário E apoio logístico da mesma pessoa). Casam por
// containment (payload->afetados @> [{id}]), não por eq() — ver cmAbrirModal.
const CM_LOG_HERMES_LABEL = {
  hermes_confirmou_mesario: (p) => CM_HERMES_ACAO_LABEL[p.acao] || `Respondeu por WhatsApp (${p.acao})`,
  hermes_atualizou_info: () => 'Mandou recado por WhatsApp (anexado à observação)',
};

function cmEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function cmCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { cmDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: pessoas, error: e1 }, { data: secoes, error: e2 }, { data: campanhas, error: e3 }] = await Promise.all([
    sb.from('sime_atores')
      .select('id, nome_completo, telefone_whatsapp, funcao_mesa, secao_id, confirmacao, ativo, observacao, meio_contato, status_contato_alternativo, codigo_rastreio, inscricao_eleitoral, precisa_substituir')
      .eq('zona_id', zonaId).eq('funcao', 'mesario').eq('ativo', true).order('nome_completo'),
    sb.from('sime_secoes').select('id, numero, local_nome, municipio').eq('zona_id', zonaId),
    // Só pra contar quantas campanhas JÁ SAÍRAM por pessoa — distingue, dentro
    // do bucket "pendente", quem nunca foi contactado de quem foi contactado
    // e não respondeu ainda (hoje esses dois casos eram indistinguíveis).
    sb.from('sime_campanhas_confirmacao').select('ator_id').eq('zona_id', zonaId).eq('status', 'enviado'),
  ]);
  if (e1 || e2) { cmDados = { erro: (e1 || e2).message }; render(); return; }

  const tentativasPorAtor = {};
  for (const c of campanhas || []) tentativasPorAtor[c.ator_id] = (tentativasPorAtor[c.ator_id] || 0) + 1;
  for (const p of pessoas || []) p.tentativas = tentativasPorAtor[p.id] || 0;

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

// Flag manual e independente de `confirmacao` — não é o Hermes que decide
// "essa pessoa precisa ser trocada", é o cartório (ex.: recusou e ninguém
// mais tentou o contato, ou já foi contactado várias vezes sem resposta).
// Por isso fica num campo próprio (precisa_substituir), não reaproveita
// confirmacao='substituido' — esse último é o status JÁ RESOLVIDO (a pessoa
// confirmou que vai ser trocada); este aqui é o item de trabalho "ainda
// falta resolver".
async function cmTogglePrecisaSubstituir(id) {
  const sb = window.supabaseAtores;
  const p = cmDados.pessoas.find(x => x.id === id);
  if (!p) return;
  const novo = !p.precisa_substituir;
  const { error } = await sb.from('sime_atores').update({ precisa_substituir: novo }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  p.precisa_substituir = novo;
  await log('mesario_precisa_substituir', '', { ator_id: id, precisa_substituir: novo });
  showToast(novo ? '🔁 Marcado — precisa ser substituído' : '✓ Desmarcado');
  render();
  if (cmModalId === id) cmRenderModal(); // botão existe tanto no card quanto dentro do modal aberto
}

async function cmSalvarMeio(id, meio) {
  const sb = window.supabaseAtores;
  const patch = { meio_contato: meio };
  // Trocar de meio zera o status anterior se o vocabulário mudou — "Enviado"
  // (carta) não tem sentido depois de trocar pra Ligação, e "Atendeu"
  // (ligação) não tem sentido depois de trocar pra Carta/Ofício (que
  // compartilham o mesmo vocabulário entre si, esse caso não zera).
  const p0 = cmDados.pessoas.find(x => x.id === id);
  if (meio === 'whatsapp' || cmStatusLabelSet(meio) !== cmStatusLabelSet(p0?.meio_contato)) {
    patch.status_contato_alternativo = null;
  }
  const { error } = await sb.from('sime_atores').update(patch).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  if (p0) Object.assign(p0, patch);
  await log('mesario_meio_contato', '', { ator_id: id, meio_contato: meio });
  showToast('✓ Meio de contato atualizado');
  render();
  if (cmModalId === id) cmRenderModal(); // seletor existe tanto no card quanto dentro do modal aberto
}

async function cmSalvarStatusAlt(id, status) {
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_atores').update({ status_contato_alternativo: status || null }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  const p = cmDados.pessoas.find(x => x.id === id);
  if (p) p.status_contato_alternativo = status || null;
  await log('mesario_status_contato_alt', '', { ator_id: id, status });
  showToast('✓ Status de envio atualizado');
  if (cmModalId === id) cmRenderModal();
}

function cmLinkRastreio(codigo) {
  return 'https://rastreamento.correios.com.br/app/index.php?objetos=' + encodeURIComponent(codigo);
}

// Quebra o texto acumulado de sime_atores.observacao em entradas individuais.
// O formato é sempre "[AAAA-MM-DD HH:MM] Autor: texto", um atrás do outro
// (Hermes anexa recados assim desde sempre, ver api/hermes-mesarios.js) — a
// quebra é feita ANTES de cada carimbo (lookahead), não por linha, porque um
// recado em si pode ter quebra de linha (mensagem de WhatsApp com Enter).
function cmParseObservacoes(texto) {
  if (!texto) return [];
  return texto.split(/(?=\[\d{4}-\d{2}-\d{2})/).map(s => s.trim()).filter(Boolean);
}

// Observação manual do cartório — mesmo padrão append-only do recado que o
// Hermes anexa (nunca sobrescreve, só acrescenta); só muda o autor no
// carimbo ("Fulano (cartório)" em vez de "Recado via Hermes").
async function cmAdicionarObservacao(id) {
  const campo = document.getElementById('mm-obs-nova');
  const texto = campo.value.trim();
  if (!texto) return;
  const sb = window.supabaseAtores;
  const p = cmDados.pessoas.find(x => x.id === id);
  if (!p) return;
  const [{ data: ts }, autor] = await Promise.all([sb.rpc('sime_now'), window.nomeDoUsuario ? window.nomeDoUsuario() : 'Cartório']);
  const carimbo = `[${String(ts).slice(0, 16).replace('T', ' ')}] ${autor} (cartório): ${texto}`;
  const nova = p.observacao ? `${p.observacao}\n${carimbo}` : carimbo;
  const { error } = await sb.from('sime_atores').update({ observacao: nova }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  p.observacao = nova;
  await log('mesario_observacao_adicionada', '', { ator_id: id });
  campo.value = '';
  showToast('✓ Observação adicionada');
  render();
  if (cmModalId === id) cmRenderModal();
}

// Registro manual de uma tentativa de contato (ligou, foi na casa, mandou
// WhatsApp fora de campanha, etc.) — mesma tabela de log das outras ações
// desta tela, mas SEM entrada em CM_LOG_LABEL (não aparece em
// "Atualizações"): entra em "Tentativas de contato", junto com o que o
// Hermes já mandou via campanha, pra virar uma timeline só do histórico de
// abordagem — inclusive a evolução WhatsApp → Carta → Ofício, já que cada
// tentativa registra o meio usado.
async function cmRegistrarTentativa(id) {
  const meio = document.getElementById('mm-tent-meio').value;
  const nota = document.getElementById('mm-tent-nota').value.trim();
  await log('mesario_tentativa_contato', '', { ator_id: id, meio, nota });
  showToast('✓ Tentativa registrada');
  if (cmModalId === id) await cmAbrirModal(id); // recarrega a timeline pra já mostrar a tentativa nova
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
//
// Também é chamado a partir do Dashboard (nome do mesário no drilldown por
// seção, sime_resumo_secoes.js) — que pode acontecer antes da aba "Contatar
// mesários" ter sido visitada nesta sessão, com cmDados ainda null. Carrega
// na hora nesse caso, em vez de abrir um modal vazio.
async function cmAbrirModal(id) {
  cmModalId = id;
  cmModalHist = null;
  document.getElementById('overlay')?.classList.add('open');
  if (!cmDados) { await cmCarregar(); if (cmModalId !== id) return; }
  cmRenderModal();

  const sb = window.supabaseAtores;
  const [{ data: campanhas }, { data: logsSime }, { data: logsHermes }] = await Promise.all([
    sb.from('sime_campanhas_confirmacao')
      .select('id, mensagem_enviada, status, created_at')
      .eq('ator_id', id).order('created_at', { ascending: false }).limit(10),
    sb.from('sime_logs')
      .select('ts, acao, payload')
      .eq('payload->>ator_id', id).order('ts', { ascending: false }).limit(10),
    // Hermes não grava ator_id direto (payload.afetados é uma lista, a
    // resposta pode valer pra mais de uma convocação da mesma pessoa) —
    // casa por containment em vez de igualdade.
    sb.from('sime_logs')
      .select('ts, acao, payload')
      .contains('payload->afetados', [{ id }]).order('ts', { ascending: false }).limit(10),
  ]);
  if (cmModalId !== id) return; // trocou de pessoa enquanto carregava
  const logs = [
    // mesario_tentativa_contato fica de fora daqui de propósito — não tem
    // entrada em CM_LOG_LABEL, então esse filtro já a exclui; ela vira parte
    // da timeline de "tentativas" abaixo, não de "Atualizações".
    ...(logsSime || []).filter(l => CM_LOG_LABEL[l.acao]).map(l => ({ ...l, _label: CM_LOG_LABEL[l.acao] })),
    ...(logsHermes || []).filter(l => CM_LOG_HERMES_LABEL[l.acao]).map(l => ({ ...l, _label: CM_LOG_HERMES_LABEL[l.acao] })),
  ].sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, 15);

  // Timeline única de "tentativas": o que o Hermes de fato mandou via
  // campanha (sime_campanhas_confirmacao) + o que o cartório registrou à
  // mão (ligou, foi na casa, etc.) — junto dá pra ver a evolução do meio
  // usado (WhatsApp → Carta → Ofício) num lugar só.
  const tentativasManuais = (logsSime || []).filter(l => l.acao === 'mesario_tentativa_contato');
  const tentativas = [
    ...(campanhas || []).map(c => ({ tipo: 'campanha', ts: c.created_at, campanha: c })),
    ...tentativasManuais.map(l => ({ tipo: 'manual', ts: l.ts, payload: l.payload || {} })),
  ].sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, 15);

  cmModalHist = { tentativas, logs };
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

  const blocoTentativas = cmModalHist === null
    ? '<div class="ic-sub" style="margin-bottom:0">Carregando…</div>'
    : cmListaHist(cmModalHist.tentativas, 'Nenhuma tentativa de contato registrada ainda.', t => {
        if (t.tipo === 'campanha') {
          const c = t.campanha;
          return `<div class="m-hist-item"><b>${cmFmtDataHist(c.created_at)}</b> — 📢 ${cmEsc(CM_CAMP_STATUS_LABEL[c.status] || c.status || '—')}${c.mensagem_enviada ? ` — "${cmEsc(c.mensagem_enviada.slice(0, 60))}${c.mensagem_enviada.length > 60 ? '…' : ''}"` : ''}</div>`;
        }
        const meioLbl = CM_MEIO_LABEL[t.payload.meio] || t.payload.meio || 'Contato';
        return `<div class="m-hist-item"><b>${cmFmtDataHist(t.ts)}</b> — ${cmEsc(meioLbl)}${t.payload.nota ? ` — ${cmEsc(t.payload.nota)}` : ''}</div>`;
      });

  const blocoLogs = cmModalHist === null
    ? '<div class="ic-sub" style="margin-bottom:0">Carregando…</div>'
    : cmListaHist(cmModalHist.logs, 'Nenhuma atualização registrada ainda.',
        l => `<div class="m-hist-item"><b>${cmFmtDataHist(l.ts)}</b> — ${cmEsc(l._label(l.payload || {}))}</div>`);

  const observacoes = cmParseObservacoes(p.observacao);
  const blocoObservacoes = cmListaHist([...observacoes].reverse(), 'Nenhuma observação registrada ainda.',
    txt => `<div class="m-hist-item">${cmEsc(txt)}</div>`);

  modal.innerHTML = `
    <div class="m-hdr">
      <div class="m-title">${cmEsc(p.nome_completo)}</div>
      <button class="close-btn" aria-label="Fechar" onclick="cmFecharModal()">✕</button>
    </div>
    <div class="m-body">
      <div class="m-kv">
        <div class="m-kv-row"><b>Função</b><span>${cmEsc(p.funcao_mesa || '—')}</span></div>
        <div class="m-kv-row"><b>Seção</b><span>${sec ? `${sec.numero} — ${cmEsc(sec.local_nome || '')}, ${cmEsc(sec.municipio || '')}` : '—'}</span></div>
        <div class="m-kv-row"><b>Título de eleitor</b><span>${p.inscricao_eleitoral ? cmEsc(p.inscricao_eleitoral) : '—'}</span></div>
        <div class="m-kv-row"><b>Situação</b><span>${cmBadge(p.confirmacao)}${p.precisa_substituir ? ' · 🔁 Precisa substituto' : ''}</span></div>
      </div>

      <div class="m-section">
        <div class="m-section-hdr">📇 Contato</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <button class="btn btn-out" style="font-size:.72rem;padding:5px 10px" onclick="cmTogglePrecisaSubstituir('${p.id}')">${p.precisa_substituir ? '✓ Desmarcar substituição' : '🔁 Marcar para substituir'}</button>
          ${p.telefone_whatsapp && linkWhatsApp(p.telefone_whatsapp) ? `<a class="btn btn-out" style="font-size:.72rem;padding:5px 10px;text-decoration:none" href="${linkWhatsApp(p.telefone_whatsapp)}" target="_blank" rel="noopener">💬 Abrir WhatsApp</a>` : ''}
        </div>
        <div class="form-group">
          <label>Telefone (WhatsApp)</label>
          <input id="mm-tel" type="text" value="${cmEsc(fmtTelefone(p.telefone_whatsapp || ''))}" placeholder="(86) 9xxxx-xxxx">
        </div>
        <div class="form-group">
          <label>Código de rastreio (Correios)</label>
          <input id="mm-rastreio" type="text" value="${cmEsc(p.codigo_rastreio || '')}" placeholder="AA123456789BR" style="text-transform:uppercase">
          ${p.codigo_rastreio ? `<div style="margin-top:4px"><a href="${cmLinkRastreio(p.codigo_rastreio)}" target="_blank" rel="noopener" style="font-size:.72rem">📦 Rastrear no site dos Correios</a></div>` : ''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          <label style="font-size:.72rem;color:var(--text2);flex:1;min-width:140px">Meio de contato atual
            <select onchange="cmSalvarMeio('${p.id}',this.value)" style="display:block;width:100%;margin-top:2px;padding:6px 8px;border-radius:6px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
              ${Object.entries(CM_MEIO_LABEL).map(([v, l]) => `<option value="${v}" ${p.meio_contato === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
          ${p.meio_contato && p.meio_contato !== 'whatsapp' ? `
          <label style="font-size:.72rem;color:var(--text2);flex:1;min-width:140px">${p.meio_contato === 'ligacao' ? 'Resultado da ligação' : 'Status do envio'}
            <select onchange="cmSalvarStatusAlt('${p.id}',this.value)" style="display:block;width:100%;margin-top:2px;padding:6px 8px;border-radius:6px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
              <option value="">—</option>
              ${Object.entries(cmStatusLabelSet(p.meio_contato)).map(([v, l]) => `<option value="${v}" ${p.status_contato_alternativo === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>` : ''}
        </div>
      </div>

      <div class="m-section">
        <div class="m-section-hdr">📞 Tentativas de contato</div>
        ${blocoTentativas}
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px">
          <label style="font-size:.72rem;color:var(--text2);flex:1;min-width:120px">Meio usado
            <select id="mm-tent-meio" style="display:block;width:100%;margin-top:2px;padding:6px 8px;border-radius:6px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
              ${Object.entries(CM_MEIO_LABEL).map(([v, l]) => `<option value="${v}" ${p.meio_contato === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
          <label style="font-size:.72rem;color:var(--text2);flex:2;min-width:160px">Nota (opcional)
            <input id="mm-tent-nota" type="text" placeholder="ex.: não atendeu, ligar de novo à tarde" style="display:block;width:100%;margin-top:2px;padding:6px 8px;border-radius:6px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
          </label>
          <button class="btn btn-out" style="font-size:.72rem;padding:6px 10px" onclick="cmRegistrarTentativa('${p.id}')">➕ Registrar tentativa</button>
        </div>
      </div>

      <div class="m-section">
        <div class="m-section-hdr">📜 Atualizações</div>
        ${blocoLogs}
      </div>

      <div class="m-section">
        <div class="m-section-hdr">📝 Observações</div>
        ${blocoObservacoes}
        <div class="form-group" style="margin-top:10px">
          <textarea id="mm-obs-nova" rows="2" placeholder="Adicionar observação…" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);font-size:.85rem;color:var(--text);font-family:inherit;resize:vertical"></textarea>
        </div>
        <button class="btn btn-out" style="font-size:.72rem;padding:5px 10px" onclick="cmAdicionarObservacao('${p.id}')">➕ Adicionar observação</button>
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
    if (cmFiltroStatus === 'precisa_substituir') { if (!p.precisa_substituir) return false; }
    else if (cmFiltroStatus && p.confirmacao !== cmFiltroStatus) return false;
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
  contagem.precisa_substituir = cmDados.pessoas.filter(p => p.precisa_substituir).length;
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
              ${(p.confirmacao || 'pendente') === 'pendente' && p.tentativas > 0 ? `<div class="ic-sub" style="margin-bottom:0">📨 Já contactado (${p.tentativas}x) — aguardando resposta</div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
              <span class="import-result ${p.confirmacao === 'confirmado' ? 'ir-ok' : p.confirmacao === 'recusou' || p.confirmacao === 'contato_incorreto' ? 'ir-warn' : ''}" style="margin-top:0;white-space:nowrap">${cmBadge(p.confirmacao)}</span>
              ${p.precisa_substituir ? `<span class="import-result ir-warn" style="margin-top:0;white-space:nowrap">🔁 Precisa substituto</span>` : ''}
            </div>
          </div>
          ${p.observacao ? `<div class="ic-sub" style="margin-top:8px;background:var(--bg2);border-radius:6px;padding:6px 8px;white-space:pre-wrap">${cmEsc(p.observacao)}</div>` : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
            <label style="font-size:.72rem;color:var(--text2)">Meio de contato:
              <select onchange="cmSalvarMeio('${p.id}',this.value)" style="margin-left:4px">
                ${Object.entries(CM_MEIO_LABEL).map(([v, l]) => `<option value="${v}" ${p.meio_contato === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </label>
            ${p.meio_contato && p.meio_contato !== 'whatsapp' ? `
            <label style="font-size:.72rem;color:var(--text2)">${p.meio_contato === 'ligacao' ? 'Resultado da ligação' : 'Status do envio'}:
              <select onchange="cmSalvarStatusAlt('${p.id}',this.value)" style="margin-left:4px">
                <option value="">—</option>
                ${Object.entries(cmStatusLabelSet(p.meio_contato)).map(([v, l]) => `<option value="${v}" ${p.status_contato_alternativo === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </label>` : ''}
            ${podeMarcarIncorreto ? `<button class="btn btn-out" style="font-size:.72rem;padding:5px 10px" onclick="cmMarcarContatoIncorreto('${p.id}')">🔍 Marcar contato incorreto</button>` : ''}
            <button class="btn btn-out" style="font-size:.72rem;padding:5px 10px" onclick="cmTogglePrecisaSubstituir('${p.id}')">${p.precisa_substituir ? '✓ Desmarcar substituição' : '🔁 Marcar para substituir'}</button>
          </div>
        </div>`;
      }).join('') || '<div class="import-card"><div class="ic-sub" style="margin-bottom:0">Ninguém encontrado com esse filtro.</div></div>'}
    </div>`;
}
