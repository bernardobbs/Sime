// ══════════════════════════════════════
// CAMPANHAS — lista/status geral + editor de script (sime_campanhas + sime_campanha_etapas)
// ══════════════════════════════════════
// Nova aba, mesmo padrão de DISPARO EM MASSA (variáveis globais de estado +
// render() por template string + pedirConfirmacao/showToast/log já
// existentes no arquivo). Depende de sql/SIME_campanhas_scripts_schema.sql
// já aplicado.
//
// Fluxo do editor: cria/edita uma "campanha" (nome + zona) com N "etapas".
// Cada etapa tem uma mensagem e uma lista de "ramos" (respostas_esperadas)
// — cada ramo diz quais palavras-chave levam a qual próxima etapa (ou a um
// status final, se for terminal). Isso é o que modules/campanhas/script.js
// do Hermes lê pra casar a resposta de quem recebeu a mensagem. Nem toda
// campanha tem etapas — modelos "simples" (convocação/golpe/livre/etc, ver
// SIME_atores.html) só usam a campanha pelo nome+status, sem script.
//
// Ligação com o disparo em massa: já feita, não é pendência. Desde
// 21/08/2026 ("quero controle total das campanhas", pedido direto do dono
// do projeto) TODO disparo (não só "🧩 Usar script salvo") exige escolher
// uma campanha, e api/hermes-campanhas.js (acao=pendentes) só entrega itens
// cuja campanha esteja com status='ativa' — pausar/encerrar aqui PARA o
// envio de verdade, não é só um rótulo cosmético. Este módulo cobre os dois:
// a LISTA (com contagem de itens por status + os botões de
// iniciar/pausar/retomar/encerrar/excluir) e o EDITOR de etapas (só entra
// quem for usar o modelo "script").

const STATUS_FINAL_OPCOES = [
  { v: 'confirmado', label: 'Confirmado' },
  { v: 'telefone_incorreto', label: 'Telefone incorreto' },
  { v: 'finalizado', label: 'Finalizado' },
  { v: 'sem_resposta', label: 'Sem resposta' },
  { v: 'erro', label: 'Erro' },
];

// Estado da campanha em edição — null até "+ Nova campanha" ou clicar numa
// existente. Espelha o padrão de dispTipo/dispMsg da aba de disparo: estado
// solto em variáveis globais, reconstruído a cada render().
let scEditando = null;      // { id (ou null se nova), nome, zona_id, status, etapas: [...] }
let scListaCampanhas = [];  // cache local, recarregada ao entrar na aba

function scNovaEtapaVazia(numero) {
  return {
    etapa_numero: numero,
    mensagem: '',
    etapa_inicial: numero === 1,
    respostas_esperadas: [scNovoRamoVazio()],
  };
}
function scNovoRamoVazio() {
  return { intencao: '', palavras_chave: [], proxima_etapa: null, acao: '', status_final: null };
}

// Rótulos curtos pra contagem por status na lista — mesmo vocabulário de
// sime_contatar_mesarios.js (CM_CAMP_STATUS_LABEL), versão compacta porque
// aqui é por campanha inteira, não por pessoa.
const SC_STATUS_ITEM_ABREV = {
  pendente: 'pendente', aguardando_resposta: 'aguardando', confirmado: 'confirmado',
  enviado: 'enviado', finalizado: 'finalizado', telefone_incorreto: 'tel. incorreto',
  sem_resposta: 'sem resposta', fora_do_script: 'fora do script', erro: 'erro',
};

async function scCarregarCampanhas() {
  const sb = window.supabaseAtores;
  if (!sb) return [];
  const zonaId = await zonaDoUsuario();
  const { data, error } = await sb
    .from('sime_campanhas')
    .select('id, nome, status, created_at')
    .eq('zona_id', zonaId)
    .order('created_at', { ascending: false });
  if (error) { showToast('⚠ ' + error.message); return []; }
  const campanhas = data || [];

  // Contagem de itens por status, por campanha — uma query só (não N),
  // agregada no cliente (volume por zona é pequeno o bastante). Dá o
  // "controle total" visibilidade real: quantos itens cada campanha tem e
  // em que pé estão, sem precisar abrir a aba "Contatar mesários" ou o
  // Supabase direto.
  const ids = campanhas.map(c => c.id);
  if (ids.length) {
    const { data: itens, error: e2 } = await sb
      .from('sime_campanhas_confirmacao')
      .select('campanha_id, status')
      .in('campanha_id', ids);
    if (!e2) {
      const contagemPorCampanha = {};
      for (const it of itens || []) {
        (contagemPorCampanha[it.campanha_id] ||= {})[it.status] = (contagemPorCampanha[it.campanha_id]?.[it.status] || 0) + 1;
      }
      for (const c of campanhas) c._contagem = contagemPorCampanha[c.id] || {};
    }
  }
  return campanhas;
}

// Transições de status — só as listadas aqui aparecem como botão na lista
// (ver scAcoesStatus). 'encerrada' é terminal: sem botão de volta, só excluir.
const SC_TRANSICOES = {
  rascunho: [{ v: 'ativa', label: '▶ Iniciar campanha' }],
  ativa: [{ v: 'pausada', label: '⏸ Pausar' }, { v: 'encerrada', label: '⏹ Encerrar', confirma: true }],
  pausada: [{ v: 'ativa', label: '▶ Retomar' }, { v: 'encerrada', label: '⏹ Encerrar', confirma: true }],
  encerrada: [],
};

async function scMudarStatusCampanha(id, novoStatus, nome) {
  const sb = window.supabaseAtores;
  const { data: ts } = await sb.rpc('sime_now');
  const { error } = await sb.from('sime_campanhas').update({ status: novoStatus, updated_at: ts }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  await log('campanha_status_mudou', id, { nome, status: novoStatus });
  showToast(`✓ "${nome}" agora está ${novoStatus}`);
  scListaCampanhas = await scCarregarCampanhas();
  render();
}

function scConfirmarMudarStatus(id, novoStatus, nome) {
  const acao = novoStatus === 'encerrada' ? 'Encerrar' : novoStatus;
  pedirConfirmacao(
    `${acao} a campanha "${nome}"?\n\n${novoStatus === 'encerrada' ? 'Itens ainda pendentes dela PARAM de ser enviados pelo Hermes — não é reversível (não dá pra voltar pra ativa/pausada depois).' : ''}`,
    () => { closeModal(); scMudarStatusCampanha(id, novoStatus, nome); },
    { titulo: 'Confirmar', labelOk: acao }
  );
}

// Excluir só é oferecido pra rascunho/encerrada (nunca ativa/pausada — tem
// que encerrar primeiro, de propósito, pra não ser possível "sumir" com uma
// campanha que ainda está mandando mensagem sem passar por esse passo). O
// banco também protege (FK sime_campanhas_confirmacao.campanha_id sem
// CASCADE) — se já tiver item vinculado, o delete falha e mostramos o erro
// em vez de deixar órfão ou perder histórico.
async function scExcluirCampanha(id, nome) {
  pedirConfirmacao(
    `Excluir a campanha "${nome}"? Isso apaga o script (se tiver) junto. Não dá pra desfazer.`,
    async () => {
      closeModal();
      const sb = window.supabaseAtores;
      const { error } = await sb.from('sime_campanhas').delete().eq('id', id);
      if (error) {
        showToast(error.message.includes('foreign key') || error.code === '23503'
          ? '⚠ Não dá pra excluir — já tem mensagens vinculadas a esta campanha no histórico. Encerre em vez de excluir.'
          : '⚠ ' + error.message);
        return;
      }
      await log('campanha_excluida', id, { nome });
      showToast(`✓ "${nome}" excluída`);
      scListaCampanhas = await scCarregarCampanhas();
      render();
    },
    { titulo: 'Excluir campanha', labelOk: 'Excluir' }
  );
}

async function scAbrirNovaCampanha() {
  const zonaId = await zonaDoUsuario();
  scEditando = { id: null, nome: '', zona_id: zonaId, status: 'rascunho', etapas: [scNovaEtapaVazia(1)] };
  render();
}

async function scAbrirCampanhaExistente(id) {
  const sb = window.supabaseAtores;
  const { data: campanha, error: e1 } = await sb.from('sime_campanhas').select('*').eq('id', id).maybeSingle();
  if (e1 || !campanha) { showToast('⚠ Não foi possível abrir esta campanha'); return; }
  const { data: etapas, error: e2 } = await sb
    .from('sime_campanha_etapas')
    .select('*')
    .eq('campanha_id', id)
    .order('etapa_numero', { ascending: true });
  if (e2) { showToast('⚠ ' + e2.message); return; }
  scEditando = {
    id: campanha.id,
    nome: campanha.nome,
    zona_id: campanha.zona_id,
    status: campanha.status,
    etapas: (etapas && etapas.length) ? etapas : [scNovaEtapaVazia(1)],
  };
  render();
}

function scFecharEdicao() { scEditando = null; render(); }

function scAdicionarEtapa() {
  if (!scEditando) return;
  const proximoNumero = Math.max(0, ...scEditando.etapas.map(e => e.etapa_numero)) + 1;
  scEditando.etapas.push(scNovaEtapaVazia(proximoNumero));
  render();
}
function scRemoverEtapa(etapaNumero) {
  if (!scEditando || scEditando.etapas.length <= 1) { showToast('⚠ Um script precisa de pelo menos uma etapa'); return; }
  scEditando.etapas = scEditando.etapas.filter(e => e.etapa_numero !== etapaNumero);
  // Ramos de outras etapas que apontavam pra esta ficam sem destino — limpar
  // aqui (em vez de deixar um número órfão) pra podeSalvar() barrar o salvar
  // até alguém escolher um destino novo, ao invés de silenciosamente gravar
  // uma referência quebrada que só quebra em produção quando o Hermes tenta
  // avançar pra uma etapa que não existe mais.
  let ramosOrfaos = 0;
  scEditando.etapas.forEach(e => {
    e.respostas_esperadas.forEach(r => {
      if (r.proxima_etapa === etapaNumero) { r.proxima_etapa = null; ramosOrfaos++; }
    });
  });
  if (ramosOrfaos > 0) showToast(`⚠ ${ramosOrfaos} ramo(s) ficaram sem destino — escolha um novo antes de salvar`);
  render();
}
function scAdicionarRamo(etapaNumero) {
  const etapa = scEditando.etapas.find(e => e.etapa_numero === etapaNumero);
  if (etapa) etapa.respostas_esperadas.push(scNovoRamoVazio());
  render();
}
function scRemoverRamo(etapaNumero, ramoIdx) {
  const etapa = scEditando.etapas.find(e => e.etapa_numero === etapaNumero);
  if (!etapa) return;
  if (etapa.respostas_esperadas.length <= 1) { showToast('⚠ Uma etapa com resposta esperada precisa de pelo menos um ramo'); return; }
  etapa.respostas_esperadas.splice(ramoIdx, 1);
  render();
}

// Inputs de texto/textarea não recriam a tela a cada tecla (mesmo cuidado
// da aba de disparo com dispMsg) — só atualizam o estado em memória.
function scEditarNome(v) { scEditando.nome = v; }
function scEditarMensagemEtapa(etapaNumero, v) {
  const etapa = scEditando.etapas.find(e => e.etapa_numero === etapaNumero);
  if (etapa) etapa.mensagem = v;
}
function scEditarRamoIntencao(etapaNumero, ramoIdx, v) {
  scEditando.etapas.find(e => e.etapa_numero === etapaNumero).respostas_esperadas[ramoIdx].intencao = v;
}
function scEditarRamoPalavras(etapaNumero, ramoIdx, v) {
  const palavras = v.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  scEditando.etapas.find(e => e.etapa_numero === etapaNumero).respostas_esperadas[ramoIdx].palavras_chave = palavras;
}
function scEditarRamoAcao(etapaNumero, ramoIdx, v) {
  scEditando.etapas.find(e => e.etapa_numero === etapaNumero).respostas_esperadas[ramoIdx].acao = v;
}
// Destino do ramo: ou uma próxima etapa (segue o script), ou "encerrar" com
// um status final (sai do fluxo). Um <select> só resolve os dois porque as
// opções de etapa vêm primeiro e "— Encerrar —" por último; o value
// codifica qual foi escolhido (ver scRenderDestinoSelect).
function scEditarRamoDestino(etapaNumero, ramoIdx, v) {
  const ramo = scEditando.etapas.find(e => e.etapa_numero === etapaNumero).respostas_esperadas[ramoIdx];
  if (v.startsWith('etapa:')) {
    ramo.proxima_etapa = parseInt(v.slice(6), 10);
    ramo.status_final = null;
  } else if (v.startsWith('final:')) {
    ramo.proxima_etapa = null;
    ramo.status_final = v.slice(6);
  } else {
    ramo.proxima_etapa = null;
    ramo.status_final = null;
  }
  // Ao contrário de texto/textarea (sem render a cada tecla, de propósito),
  // um <select> só dispara onchange uma vez por escolha — sem re-renderizar
  // aqui, "Salvar script" fica com o disabled/enabled da renderização
  // anterior, então escolher um destino válido não habilita o botão (nem
  // escolher um inválido desabilita) até algum outro clique re-renderizar
  // por outro motivo. Isso tornava a validação de referência órfã invisível
  // na prática — a leitura de scEditando estava certa, só a tela não refletia.
  render();
}

function scRenderDestinoSelect(etapaNumero, ramoIdx, ramo) {
  const outrasEtapas = scEditando.etapas.filter(e => e.etapa_numero !== etapaNumero);
  const valorAtual = ramo.proxima_etapa ? `etapa:${ramo.proxima_etapa}` : (ramo.status_final ? `final:${ramo.status_final}` : '');
  return `
    <select onchange="scEditarRamoDestino(${etapaNumero},${ramoIdx},this.value)">
      <option value="" ${!valorAtual ? 'selected' : ''}>— escolha o que acontece —</option>
      <optgroup label="Segue para">
        ${outrasEtapas.map(e => `<option value="etapa:${e.etapa_numero}" ${valorAtual===`etapa:${e.etapa_numero}`?'selected':''}>Etapa ${e.etapa_numero}${e.mensagem ? ' — ' + e.mensagem.slice(0,40).replace(/"/g,'') + (e.mensagem.length>40?'…':'') : ''}</option>`).join('')}
      </optgroup>
      <optgroup label="Encerra com status">
        ${STATUS_FINAL_OPCOES.map(s => `<option value="final:${s.v}" ${valorAtual===`final:${s.v}`?'selected':''}>${s.label} (encerra)</option>`).join('')}
      </optgroup>
    </select>`;
}

function scRenderEtapa(etapa) {
  return `
    <div class="import-card" style="margin-bottom:14px;border-left:3px solid var(--accent,#6b6)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="ic-title">Etapa ${etapa.etapa_numero}${etapa.etapa_inicial ? ' <span style="font-size:.75rem;opacity:.7">(inicial — 1ª mensagem enviada)</span>' : ''}</div>
        <button class="btn btn-out" style="font-size:.75rem;padding:3px 8px" onclick="scRemoverEtapa(${etapa.etapa_numero})">✕ Remover etapa</button>
      </div>
      <div class="form-group"><label>Mensagem desta etapa</label>
        <textarea rows="4" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);font-size:.85rem;color:var(--text);font-family:inherit;resize:vertical"
          oninput="scEditarMensagemEtapa(${etapa.etapa_numero},this.value)">${etapa.mensagem}</textarea>
        <div class="ic-sub" style="margin-top:4px">Placeholders {nome}/{funcao}/{secao}/{local}/{municipio} são trocados por pessoa, igual ao disparo em massa hoje.</div>
      </div>
      <div class="form-group"><label>Respostas esperadas nesta etapa</label>
        ${etapa.respostas_esperadas.map((ramo, idx) => `
          <div style="border:1px solid var(--border2);border-radius:7px;padding:8px;margin-bottom:6px">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
              <div style="flex:1;min-width:140px">
                <label style="font-size:.75rem">Intenção (nome interno)</label>
                <input type="text" value="${ramo.intencao}" placeholder="ex: confirmacao" oninput="scEditarRamoIntencao(${etapa.etapa_numero},${idx},this.value)">
              </div>
              <div style="flex:2;min-width:200px">
                <label style="font-size:.75rem">Palavras-chave (separadas por vírgula)</label>
                <input type="text" value="${ramo.palavras_chave.join(', ')}" placeholder="ex: sim, s, sou eu, confirmo" oninput="scEditarRamoPalavras(${etapa.etapa_numero},${idx},this.value)">
              </div>
              <div style="flex:2;min-width:200px">
                <label style="font-size:.75rem">Quando bater, o que acontece</label>
                ${scRenderDestinoSelect(etapa.etapa_numero, idx, ramo)}
              </div>
              <button class="btn btn-out" style="font-size:.75rem;padding:3px 8px" onclick="scRemoverRamo(${etapa.etapa_numero},${idx})">✕</button>
            </div>
          </div>`).join('')}
        <button class="btn btn-out" style="font-size:.78rem;padding:4px 10px" onclick="scAdicionarRamo(${etapa.etapa_numero})">+ Adicionar ramo (outra resposta possível)</button>
      </div>
    </div>`;
}

function scRenderEditor() {
  // proxima_etapa precisa apontar pra uma etapa que ainda existe no script —
  // só checar truthy deixava passar referência órfã (ex.: etapa removida
  // depois de um ramo apontar pra ela), que só quebra em produção quando o
  // Hermes tenta avançar pra uma etapa inexistente (ver avancar_etapa em
  // api/hermes-campanhas.js).
  const etapasExistentes = new Set(scEditando.etapas.map(e => e.etapa_numero));
  const podeSalvar = scEditando.nome.trim() && scEditando.etapas.every(e =>
    e.mensagem.trim() && e.respostas_esperadas.every(r =>
      r.palavras_chave.length && (
        (r.proxima_etapa && etapasExistentes.has(r.proxima_etapa)) || r.status_final
      )
    )
  );
  return `
    <div class="import-card">
      <div class="ic-title">${scEditando.id ? 'Editar' : 'Nova'} campanha — script conversacional</div>
      <div class="ic-sub">Cada etapa manda uma mensagem e espera uma resposta. As palavras-chave decidem pra qual próxima etapa a conversa vai — ou se encerra com um status final. Uma resposta que não bater com nenhum ramo fica marcada como "fora do script" (nenhuma ação automática).</div>
      <div class="form-group"><label>Nome da campanha</label>
        <input type="text" value="${scEditando.nome}" placeholder="ex: Convocação de mesários — Eleições 2026" oninput="scEditarNome(this.value)">
      </div>
      ${scEditando.etapas.map(scRenderEtapa).join('')}
      <button class="btn btn-out" onclick="scAdicionarEtapa()">+ Adicionar etapa</button>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-dark" ${podeSalvar ? '' : 'disabled'} onclick="scSalvarCampanha()">💾 Salvar script</button>
        <button class="btn btn-out" onclick="scFecharEdicao()">Cancelar</button>
      </div>
      ${!podeSalvar ? '<div class="ic-sub" style="margin-top:6px;color:var(--warn,#c90)">Toda etapa precisa de mensagem, e todo ramo precisa de pelo menos uma palavra-chave e um destino (próxima etapa ou status final).</div>' : ''}
    </div>`;
}

const SC_STATUS_COR = { rascunho: 'var(--text2)', ativa: 'var(--accent,#2a2)', pausada: 'var(--warn,#c90)', encerrada: 'var(--text2)' };

function scRenderContagem(c) {
  const contagem = c._contagem || {};
  const total = Object.values(contagem).reduce((a, b) => a + b, 0);
  if (!total) return '<span class="ic-sub">Nenhum item enfileirado ainda</span>';
  const partes = Object.entries(contagem)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${n} ${SC_STATUS_ITEM_ABREV[s] || s}`);
  return `<span class="ic-sub">${total} item${total !== 1 ? 's' : ''} — ${partes.join(' · ')}</span>`;
}

function scRenderAcoesStatus(c) {
  const transicoes = SC_TRANSICOES[c.status] || [];
  const botoes = transicoes.map(t => `
    <button class="btn btn-out" style="font-size:.72rem;padding:3px 8px" onclick="event.stopPropagation();${t.confirma ? `scConfirmarMudarStatus('${c.id}','${t.v}','${(c.nome||'').replace(/'/g, "\\'")}')` : `scMudarStatusCampanha('${c.id}','${t.v}','${(c.nome||'').replace(/'/g, "\\'")}')`}">${t.label}</button>`).join('');
  const podeExcluir = c.status === 'rascunho' || c.status === 'encerrada';
  const excluir = podeExcluir
    ? `<button class="btn btn-out" style="font-size:.72rem;padding:3px 8px" onclick="event.stopPropagation();scExcluirCampanha('${c.id}','${(c.nome||'').replace(/'/g, "\\'")}')">✕ Excluir</button>`
    : '';
  return botoes + excluir;
}

function scRenderLista() {
  return `
    <div class="import-card">
      <div class="ic-title">🧩 Campanhas</div>
      <div class="ic-sub">Toda mensagem enfileirada no Disparo em massa pertence a uma campanha daqui — pause/retome/encerre o envio dela inteira, ou adicione um script conversacional (etapas com respostas esperadas) pra usar no disparo em vez das mensagens fixas.</div>
      <button class="btn btn-dark" onclick="scAbrirNovaCampanha()">+ Nova campanha com script</button>
      <div style="margin-top:12px">
        ${scListaCampanhas.length ? scListaCampanhas.map(c => `
          <div style="padding:10px 12px;border:1px solid var(--border2);border-radius:7px;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
              <div style="cursor:pointer" onclick="scAbrirCampanhaExistente('${c.id}')">
                <div><b>${c.nome}</b> <span style="font-size:.72rem;font-weight:700;color:${SC_STATUS_COR[c.status] || 'var(--text2)'}">● ${c.status}</span></div>
                <div style="margin-top:2px">${scRenderContagem(c)}</div>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                <span class="ic-sub">${new Date(c.created_at).toLocaleDateString('pt-BR')}</span>
                ${scRenderAcoesStatus(c)}
              </div>
            </div>
          </div>`).join('') : '<div class="ic-sub" style="padding:8px">Nenhuma campanha criada ainda nesta zona.</div>'}
      </div>
    </div>`;
}

async function renderScripts() {
  const c = document.getElementById('content');
  if (!window.supabaseAtores) { c.innerHTML = '<div class="import-card"><div class="import-result ir-warn">Entre com a conta da equipe para editar scripts.</div></div>'; return; }
  if (!scEditando) scListaCampanhas = await scCarregarCampanhas();
  c.innerHTML = scEditando ? scRenderEditor() : scRenderLista();
}

async function scSalvarCampanha() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();

  let campanhaId = scEditando.id;
  if (campanhaId) {
    const { data: ts } = await sb.rpc('sime_now'); // NUNCA new Date()/Date.now() — timestamp de ação sempre vem do servidor
    const { error } = await sb.from('sime_campanhas').update({ nome: scEditando.nome, updated_at: ts }).eq('id', campanhaId);
    if (error) { showToast('⚠ ' + error.message); return; }
  } else {
    const { data, error } = await sb.from('sime_campanhas').insert({ nome: scEditando.nome, zona_id: zonaId, status: 'rascunho' }).select('id').single();
    if (error) { showToast('⚠ ' + error.message); return; }
    campanhaId = data.id;
  }

  // Substitui as etapas por completo — mais simples que diff, e o volume
  // por campanha é pequeno (poucas etapas). Apaga e reinsere.
  const { error: delErr } = await sb.from('sime_campanha_etapas').delete().eq('campanha_id', campanhaId);
  if (delErr) { showToast('⚠ ' + delErr.message); return; }

  const linhasEtapas = scEditando.etapas.map(e => ({
    campanha_id: campanhaId,
    etapa_numero: e.etapa_numero,
    mensagem: e.mensagem,
    etapa_inicial: e.etapa_numero === 1,
    respostas_esperadas: e.respostas_esperadas,
  }));
  const { error: insErr } = await sb.from('sime_campanha_etapas').insert(linhasEtapas);
  if (insErr) { showToast('⚠ ' + insErr.message); return; }

  await log('campanha_script_salvo', campanhaId, { nome: scEditando.nome, etapas: linhasEtapas.length });
  showToast('✓ Script salvo — ' + linhasEtapas.length + ' etapa(s)');
  scEditando = null;
  render();
}
