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

// Mensagem pronta pro botão "🔗 Copiar link do WhatsApp" do modal
// (21/08/2026) — o cartório vai de nome em nome confirmando se o telefone
// cadastrado ainda é da pessoa certa, e digitar essa mesma pergunta toda vez
// que abre uma conversa nova era repetitivo. Pré-preenchida via ?text= do
// wa.me (linkWhatsApp já aceita 2º argumento) — a pessoa ainda precisa colar
// e enviar no WhatsApp, isso não manda nada sozinho.
function cmMsgConfirmarContato(p) {
  return `Bom dia, esse contato é de ${p.nome_completo} ?`;
}

// Copia o link (em vez de abrir), pedido do cartório em 21/08/2026: indo de
// nome em nome, abrir uma aba/app novo do WhatsApp a cada clique era mais
// disruptivo do que precisava — cola o link já pronto (com a mensagem) onde
// for mais conveniente (WhatsApp Web já aberto, etc.). Copiar o link já É
// uma tentativa de contato — registra sozinho na timeline (mesmo dia,
// pedido direto: "atualizar automaticamente que tentei contato"), sem
// precisar preencher a caixa de Nota separada só pra isso.
//
// Generalizado pra aceitar QUALQUER número da pessoa, não só o principal
// (mesmo dia, pedido direto: "o botão de copiar vir antes de cada número,
// apresentando todos os números do mesário") — cada telefone conhecido
// (principal, alternativos do TRE, ou o que o cartório cadastrou à mão)
// vira uma tentativa de contato de verdade quando o cartório copia o link
// pra ele, não só uma cópia de texto sem registro.
async function cmCopiarLinkWhatsAppNumero(id, numero, notaExtra) {
  const p = cmDados.pessoas.find(x => x.id === id);
  if (!p) return;
  const link = linkWhatsApp(numero, cmMsgConfirmarContato(p));
  if (!link) return;
  navigator.clipboard?.writeText(link).then(
    () => showToast('🔗 Link copiado — cole onde precisar'),
    () => showToast('⚠ Não deu pra copiar automaticamente'),
  );
  await cmRegistrarTentativaCore(id, 'whatsapp', notaExtra || 'Copiou o link do WhatsApp pra confirmar contato');
  if (cmModalId === id) await cmAbrirModal(id); // recarrega a timeline pra já mostrar a tentativa nova
}

async function cmCopiarLinkWhatsApp(id) {
  const p = cmDados.pessoas.find(x => x.id === id);
  if (!p) return;
  await cmCopiarLinkWhatsAppNumero(id, p.telefone_whatsapp);
}

// Mesário tem cargo de mesa (funcao_mesa: Presidente/1º Mesário/...); apoio
// logístico (coord_acessibilidade/auxiliar_eleicao) não — o "cargo" dele é a
// própria função. Mesmo rótulo usado por api/hermes-mesarios.js (rotuloFuncao).
const CM_FUNCAO_LABEL = {
  coord_acessibilidade: 'Coordenador(a) de Acessibilidade',
  auxiliar_eleicao: 'Auxiliar de Serviços Eleitorais (apoio logístico)',
};
function cmRotuloFuncao(p) {
  if (p.funcao === 'mesario') return p.funcao_mesa || 'Mesário(a)';
  return CM_FUNCAO_LABEL[p.funcao] || p.funcao || '—';
}

const CM_BUCKETS = [
  { valor: '',                  label: 'Todos' },
  { valor: 'pendente',          label: '❌ Falta contactar / sem resposta' },
  { valor: 'confirmado',        label: '✅ Confirmados' },
  { valor: 'recusou',           label: '⚠️ Recusou (é a pessoa certa)' },
  { valor: 'contato_incorreto', label: '🔍 Contato incorreto (não é a pessoa)' },
  { valor: 'precisa_substituir', label: '🔁 Precisa ser substituído' },
  { valor: 'substituido',       label: '🔁 Já substituído' },
  { valor: 'relato_terceiro_pendente', label: '⚠️ Relato de terceiro — precisa confirmar' },
];
// Filtro por função (21/08/2026) — desde que apoio logístico entrou na
// mesma fila de mesário, dá pra querer ver só um tipo de cada vez.
// Independente do filtro por status (CM_BUCKETS) — os dois se combinam.
const CM_FUNCAO_FILTRO = [
  { valor: '', label: 'Todas as funções' },
  { valor: 'mesario', label: 'Mesário (MRV)' },
  { valor: 'coord_acessibilidade', label: 'Coordenador(a) de Acessibilidade' },
  { valor: 'auxiliar_eleicao', label: 'Auxiliar de Eleição (apoio logístico)' },
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
let cmFiltroFuncao = '';
let cmBusca = '';
let cmModalId = null;   // id do ator com o modal aberto (só um por vez)
let cmModalHist = null; // { campanhas:[...], logs:[...] } | null enquanto carrega

// Rodar script conversacional pra um número indicado (28/08/2026) — pedido
// direto do cartório: mandar a etapa 1 de um script salvo (aba 🧩 Campanhas
// de SIME_atores.html) pra QUALQUER telefone a partir do modal desta
// pessoa, não só pelo Disparo em massa (que dispara em lote pro grupo
// filtrado, sem jeito de mirar um número avulso que não é o cadastrado —
// ex.: a pessoa acabou de informar outro contato por telefone). Reaproveita
// exatamente o mesmo mecanismo do disparo (insere em
// sime_campanhas_confirmacao com campanha_id + etapa_atual:1 — o Hermes lê
// e conduz o script como qualquer outro item da fila), só que um item de
// cada vez. cmScriptCampanhas carrega junto com o resto de cmCarregar()
// (mesma zona pra todo mundo, não muda por pessoa); cmScriptCampanhaId/
// Etapa1 são o estado do script escolhido no <select> do modal — não
// resetam ao trocar de pessoa de propósito (mesmo padrão de dispCampanhaId
// em SIME_atores.html: reusar o mesmo script escolhido pra várias pessoas
// em sequência é o caso comum, ex.: mandando o mesmo script de convocação
// pra cada mesário que ainda falta).
let cmScriptCampanhas = [];
let cmScriptCampanhaId = null;
let cmScriptEtapa1 = '';
let cmScriptEtapa1Imagem = null;

const CM_CAMP_STATUS_LABEL = {
  pendente: 'Na fila do Hermes',
  aguardando_resposta: 'Aguardando resposta',
  confirmado: 'Confirmou identidade (indo enviar convocação)',
  enviado: 'Enviado',
  finalizado: 'Convocação entregue',
  telefone_incorreto: 'Telefone incorreto',
  sem_resposta: 'Sem resposta (esgotou tentativas)',
  fora_do_script: 'Fora do script (fila de atenção)',
  erro: 'Erro no envio',
};
// Ordem de exibição da barra de status da fila (21/08/2026, pedido do dono
// do projeto: "quero ir acompanhando a situação da fila pelo sime" — hoje
// só dava pra ver status por pessoa, abrindo o histórico uma a uma).
const CM_CAMP_STATUS_ORDEM = ['pendente', 'aguardando_resposta', 'confirmado', 'enviado', 'finalizado', 'telefone_incorreto', 'sem_resposta', 'fora_do_script', 'erro'];
const CM_HERMES_ACAO_LABEL = { confirmar: 'Confirmou por WhatsApp', recusar: 'Recusou por WhatsApp', substituir: 'Avisou substituição por WhatsApp' };
// Ações que o SIME grava com payload.ator_id direto — casam por eq() simples.
const CM_LOG_LABEL = {
  mesario_editar_telefone: () => 'Telefone atualizado manualmente',
  mesario_editar_rastreio: () => 'Código de rastreio atualizado',
  mesario_meio_contato: (p) => `Meio de contato → ${CM_MEIO_LABEL[p.meio_contato] || p.meio_contato}`,
  mesario_status_contato_alt: (p) => `Status do contato → ${CM_STATUS_ALL_LABEL[p.status] || p.status || '—'}`,
  mesario_contato_incorreto: () => 'Marcado como contato incorreto',
  mesario_precisa_substituir: (p) => p.precisa_substituir ? 'Marcado para substituição' : 'Desmarcado da substituição',
  mesario_relato_terceiro_resolvido: () => '✓ Relato de terceiro resolvido (confirmado com a pessoa)',
  mesario_confirmado_manual: () => 'Confirmado manualmente pelo cartório',
  mesario_telefone_alt_adicionado: () => 'Telefone alternativo adicionado',
  mesario_telefone_alt_removido: () => 'Telefone alternativo removido',
  mesario_script_enviado: (p) => `🧩 Rodou o script "${p.campanha_nome || '—'}" para ${p.telefone ? fmtTelefone(p.telefone) : '—'}`,
};
// Ações que o Hermes grava (api/hermes-mesarios.js) — não têm payload.ator_id
// direto, têm payload.afetados como lista de {id, nome, ...} (a mesma
// resposta pode afetar mesário E apoio logístico da mesma pessoa). Casam por
// containment (payload->afetados @> [{id}]), não por eq() — ver cmAbrirModal.
const CM_LOG_HERMES_LABEL = {
  hermes_confirmou_mesario: (p) => CM_HERMES_ACAO_LABEL[p.acao] || `Respondeu por WhatsApp (${p.acao})`,
  hermes_atualizou_info: () => 'Mandou recado por WhatsApp (anexado à observação)',
  // Relato de TERCEIRO (21/08/2026) — outro mesário reportou isso sobre esta
  // pessoa (grupo ou DM), não ela mesma falando. Rótulo deixa isso explícito
  // ("via terceiro" + "precisa confirmar") pra não passar por um recado da
  // própria pessoa — o texto completo (com origem e telefone de quem
  // relatou) já está anexado em observacao, ver acao='relatar_terceiro' em
  // api/hermes-mesarios.js.
  hermes_relato_terceiro: (p) => `⚠️ Relato de terceiro via WhatsApp (${p.origem || 'grupo/DM'}) — PRECISA CONFIRMAR`,
};

// Toda ação registrada por esta tela passa por aqui em vez de chamar log()
// direto — achado real em 21/08/2026: nenhuma tentativa/atualização gravava
// QUEM do cartório fez a ação (ex.: "telefone atualizado manualmente" sem
// dizer quem atualizou), só a observação (cmAppendObservacao) já cravava o
// autor no próprio texto. window.nomeDoUsuario() é cacheado (sime_usuarios
// da sessão), então chamar de novo a cada ação não custa uma consulta nova.
async function cmAutorAtual() {
  return window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
}
async function cmLog(acao, secao, payload) {
  const autor = await cmAutorAtual();
  await log(acao, secao, { ...payload, autor });
}

function cmEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function cmCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { cmDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: pessoas, error: e1 }, { data: secoes, error: e2 }, { data: campanhas, error: e3 }, { data: campanhasScript }] = await Promise.all([
    sb.from('sime_atores')
      .select('id, nome_completo, telefone_whatsapp, telefone_alternativo, funcao, funcao_mesa, secao_id, confirmacao, ativo, observacao, meio_contato, status_contato_alternativo, codigo_rastreio, inscricao_eleitoral, precisa_substituir, tem_relato_terceiro_pendente')
      // Mesário (MRV) + apoio logístico (coord_acessibilidade/auxiliar_eleicao)
      // — antes só mesário; apoio ficava contado no Dashboard mas sem fila de
      // contato própria (21/08/2026, achado real: precisavam contactar apoio
      // do mesmo jeito e não tinham como, só pelas ferramentas genéricas de Atores).
      .eq('zona_id', zonaId).in('funcao', ['mesario', 'coord_acessibilidade', 'auxiliar_eleicao']).eq('ativo', true).order('nome_completo'),
    sb.from('sime_secoes').select('id, numero, local_nome, municipio').eq('zona_id', zonaId),
    // ator_id+status de TODA a fila da zona (não só 'enviado' como antes) —
    // dá pra (a) contar quantas campanhas JÁ SAÍRAM por pessoa (como já
    // fazia) e (b) montar a barra de status agregada da fila inteira (ver
    // CM_CAMP_STATUS_ORDEM acima), sem precisar de uma segunda consulta.
    sb.from('sime_campanhas_confirmacao').select('ator_id, status').eq('zona_id', zonaId),
    // Campanhas da zona (qualquer status) — pro botão "🧩 Rodar script
    // conversacional" do modal (28/08/2026). Mesma fonte que
    // carregarCampanhasParaDisparo() em SIME_atores.html; o filtro de
    // "encerrada" é feito no render, não aqui (mesmo padrão de lá) — sem
    // erro aqui não bloqueia o resto da tela, por isso não entra no `if`
    // abaixo (uma campanha faltando não devia impedir de ver a fila de
    // contato inteira).
    sb.from('sime_campanhas').select('id, nome, status').eq('zona_id', zonaId).order('created_at', { ascending: false }),
  ]);
  if (e1 || e2) { cmDados = { erro: (e1 || e2).message }; render(); return; }

  const tentativasPorAtor = {};
  const statusFila = {};
  for (const c of campanhas || []) {
    if (c.status === 'enviado') tentativasPorAtor[c.ator_id] = (tentativasPorAtor[c.ator_id] || 0) + 1;
    statusFila[c.status] = (statusFila[c.status] || 0) + 1;
  }
  for (const p of pessoas || []) p.tentativas = tentativasPorAtor[p.id] || 0;

  cmScriptCampanhas = campanhasScript || [];
  cmDados = { pessoas: pessoas || [], secoesPorId: Object.fromEntries((secoes || []).map(s => [s.id, s])), statusFila };
  render();
}

async function cmMarcarContatoIncorreto(id) {
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_atores').update({ confirmacao: 'contato_incorreto' }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  const p = cmDados.pessoas.find(x => x.id === id);
  if (p) p.confirmacao = 'contato_incorreto';
  await cmLog('mesario_contato_incorreto', '', { ator_id: id });
  showToast('🔍 Marcado como contato incorreto — busque um novo contato');
  render();
}

// Confirmação vinda de FORA do WhatsApp (o cartório viu no sistema do TRE,
// ligou e a pessoa confirmou, confirmou pessoalmente, etc.) — pensado pro
// fluxo "ir de pessoa em pessoa" quando a campanha automática do TRE/Hermes
// não alcançou todo mundo. Marca confirmacao='confirmado' igual o Hermes
// marcaria — SÓ isso.
//
// Bug real corrigido em 21/08/2026: até aqui, este botão também enfileirava
// a mensagem de convocação em sime_campanhas_confirmacao pro Hermes
// entregar (pensado pra fechar o ciclo automaticamente). O cartório pediu
// pra parar — confirmar participação por aqui não deve criar fila de envio
// nenhuma, só marcar. Se quiser mandar mensagem de verdade, o caminho é o
// motor de campanha em massa de SIME_atores.html (disparo com verificação
// SIM/NÃO), não este atalho.
async function cmConfirmarParticipacao(id) {
  const sb = window.supabaseAtores;
  const p = cmDados.pessoas.find(x => x.id === id);
  if (!p) return;
  const { data: ts } = await sb.rpc('sime_now');
  const { error } = await sb.from('sime_atores').update({ confirmacao: 'confirmado', data_confirmacao: ts }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  p.confirmacao = 'confirmado';
  p.data_confirmacao = ts;
  await cmLog('mesario_confirmado_manual', '', { ator_id: id });
  showToast('✅ Participação confirmada');
  render();
  if (cmModalId === id) cmRenderModal();
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
  await cmLog('mesario_precisa_substituir', '', { ator_id: id, precisa_substituir: novo });
  showToast(novo ? '🔁 Marcado — precisa ser substituído' : '✓ Desmarcado');
  render();
  if (cmModalId === id) cmRenderModal(); // botão existe tanto no card quanto dentro do modal aberto
}

// Só desmarca a flag (ver tem_relato_terceiro_pendente, gravada por
// relatar_terceiro em api/hermes-mesarios.js) — nunca mexe em confirmacao
// nem apaga o carimbo já anexado em observacao (fica lá como registro
// histórico de que o relato existiu e foi checado). Uso: o cartório já
// entrou em contato com a PRÓPRIA pessoa e confirmou (ou descartou) o que
// o terceiro relatou.
async function cmResolverRelatoTerceiro(id) {
  const sb = window.supabaseAtores;
  const p = cmDados.pessoas.find(x => x.id === id);
  if (!p) return;
  const { error } = await sb.from('sime_atores').update({ tem_relato_terceiro_pendente: false }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  p.tem_relato_terceiro_pendente = false;
  await cmLog('mesario_relato_terceiro_resolvido', '', { ator_id: id });
  showToast('✓ Relato de terceiro marcado como resolvido');
  render();
  if (cmModalId === id) cmRenderModal();
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
  await cmLog('mesario_meio_contato', '', { ator_id: id, meio_contato: meio });
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
  await cmLog('mesario_status_contato_alt', '', { ator_id: id, status });
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
// Núcleo compartilhado entre o botão próprio ("➕ Adicionar observação") e o
// "Salvar" geral do modal — que também recolhe esse campo, ver cmSalvarModal.
async function cmAppendObservacao(id, texto) {
  const sb = window.supabaseAtores;
  const p = cmDados.pessoas.find(x => x.id === id);
  if (!p) return false;
  const [{ data: ts }, autor] = await Promise.all([sb.rpc('sime_now'), window.nomeDoUsuario ? window.nomeDoUsuario() : 'Cartório']);
  const carimbo = `[${String(ts).slice(0, 16).replace('T', ' ')}] ${autor} (cartório): ${texto}`;
  const nova = p.observacao ? `${p.observacao}\n${carimbo}` : carimbo;
  const { error } = await sb.from('sime_atores').update({ observacao: nova }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return false; }
  p.observacao = nova;
  await cmLog('mesario_observacao_adicionada', '', { ator_id: id });
  return true;
}

async function cmAdicionarObservacao(id) {
  const campo = document.getElementById('mm-obs-nova');
  const texto = campo.value.trim();
  if (!texto) return;
  const ok = await cmAppendObservacao(id, texto);
  if (!ok) return;
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
// Núcleo compartilhado com o "Salvar" geral do modal — ver cmSalvarModal.
async function cmRegistrarTentativaCore(id, meio, nota) {
  await cmLog('mesario_tentativa_contato', '', { ator_id: id, meio, nota });
}

async function cmRegistrarTentativa(id) {
  const meio = document.getElementById('mm-tent-meio').value;
  const nota = document.getElementById('mm-tent-nota').value.trim();
  await cmRegistrarTentativaCore(id, meio, nota);
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
// Campos de telefone que a planilha do TRE (ELO) traz por pessoa — até 5
// diferentes (21/08/2026, achado real: um mesário pode ter mais de um
// telefone de contato no cadastro, mas sime_sync_atores_from_raw só grava
// UM em sime_atores.telefone_whatsapp — COALESCE(telefone_pessoal_mesario,
// telefone_1_eleitor, telefone_2_eleitor, telefone_contato_eleitor), nessa
// ordem — e os outros ficam invisíveis pro cartório, mesmo continuando
// intactos no staging sime_mesarios_raw). Mostrados aqui só como
// referência — nenhum vira telefone_whatsapp sozinho, o cartório decide.
const CM_RAW_TEL_CAMPOS = [
  ['telefone_pessoal_mesario', 'Telefone pessoal (mesário)'],
  ['telefone_1_eleitor', 'Telefone 1 (eleitor)'],
  ['telefone_2_eleitor', 'Telefone 2 (eleitor)'],
  ['telefone_contato_eleitor', 'Telefone contato (eleitor)'],
  ['telefone_comercial_mesario', 'Telefone comercial (mesário)'],
];

// Lista ÚNICA com todos os telefones conhecidos da pessoa — principal +
// alternativos do TRE (ELO) + o que o cartório cadastrou à mão
// (telefone_alternativo, quando o número não veio de nenhuma fonte oficial)
// — pedido direto em 21/08/2026: "o botão de copiar vir antes de cada
// número, apresentando todos os números do mesário". Dedupe contra o
// principal e entre si (comparando só dígitos, sem o "55", já que o TRE não
// segue convenção nenhuma de formato).
function cmListaTelefones(p, raw) {
  const vistos = new Set();
  const lista = [];
  const add = (label, valor, extra) => {
    const digitos = telSemPais(valor || '');
    if (!digitos || digitos.length < 8 || vistos.has(digitos)) return;
    vistos.add(digitos);
    lista.push({ label, valor, ...extra });
  };
  add('WhatsApp (principal)', p.telefone_whatsapp, { principal: true });
  if (raw) for (const [campo, label] of CM_RAW_TEL_CAMPOS) add(label, raw[campo]);
  add('Telefone alternativo (cartório)', p.telefone_alternativo, { removivel: true });
  return lista;
}

// Ao trocar o script escolhido no <select> do modal, busca a mensagem/
// imagem da etapa 1 só pra mostrar em preview — o texto de verdade,
// personalizado por pessoa, é resolvido de novo em cmEnviarScript() (mesmo
// padrão de selecionarCampanhaDisparo()/confirmarDisparo() em
// SIME_atores.html).
async function cmScriptSelecionarCampanha(id) {
  cmScriptCampanhaId = id || null;
  cmScriptEtapa1 = ''; cmScriptEtapa1Imagem = null;
  if (cmScriptCampanhaId) {
    const sb = window.supabaseAtores;
    const { data, error } = await sb.from('sime_campanha_etapas')
      .select('mensagem, imagem_url').eq('campanha_id', cmScriptCampanhaId).eq('etapa_numero', 1).maybeSingle();
    if (!error && data) { cmScriptEtapa1 = data.mensagem; cmScriptEtapa1Imagem = data.imagem_url || null; }
  }
  cmRenderModal();
}

// Mesmos placeholders que o Disparo em massa (personalizarMensagem() em
// SIME_atores.html) — duplicado aqui porque SIME_convocacao.html não carrega
// aquele arquivo. {nome}/{funcao}/{secao}/{local}/{municipio}.
function cmPersonalizarScript(msg, p, sec) {
  return (msg || '')
    .replaceAll('{nome}', p.nome_completo || '')
    .replaceAll('{funcao}', cmRotuloFuncao(p))
    .replaceAll('{secao}', sec ? String(sec.numero) : '')
    .replaceAll('{local}', sec?.local_nome || 'local a confirmar')
    .replaceAll('{municipio}', sec?.municipio || '');
}

// Manda a etapa 1 do script escolhido pro telefone digitado no campo "Número
// indicado" — igual ao que o Disparo em massa faz em lote, só que um item
// por vez e pra QUALQUER número (não precisa ser o telefone_whatsapp
// cadastrado da pessoa). ator_id continua sendo o da pessoa mesmo quando o
// número é outro — é o que faz o item aparecer na timeline "Tentativas de
// contato" dela (essa consulta já filtra por ator_id, não por telefone).
async function cmEnviarScript(id) {
  const p = cmDados.pessoas.find(x => x.id === id);
  if (!p) return;
  if (!cmScriptCampanhaId) { showToast('⚠ Escolha um script salvo'); return; }
  if (!cmScriptEtapa1) { showToast('⚠ Este script não tem etapa 1 — abra-o na aba 🧩 Campanhas e confira'); return; }

  const campoTel = document.getElementById('mm-script-tel');
  const normalizado = normalizarTelefoneWhatsapp(campoTel ? campoTel.value : '');
  const digitos = telSemPais(normalizado);
  if (!digitos || digitos.length < 10) { showToast('⚠ Telefone indicado inválido'); return; }
  const telefone = '55' + digitos;

  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { showToast('⚠ Não foi possível resolver sua zona'); return; }
  const sec = p.secao_id ? cmDados.secoesPorId[p.secao_id] : null;
  const mensagem = cmPersonalizarScript(cmScriptEtapa1, p, sec);
  const campanhaEscolhida = cmScriptCampanhas.find(c => c.id === cmScriptCampanhaId);

  const { error } = await sb.from('sime_campanhas_confirmacao').insert({
    ator_id: p.id,
    telefone_whatsapp: telefone,
    zona_id: zonaId,
    mensagem_enviada: mensagem,
    status: 'pendente',
    campanha_id: cmScriptCampanhaId,
    etapa_atual: 1,
  });
  if (error) { showToast('⚠ ' + error.message); return; }

  await cmLog('mesario_script_enviado', '', { ator_id: p.id, campanha_id: cmScriptCampanhaId, campanha_nome: campanhaEscolhida?.nome, telefone });
  showToast(campanhaEscolhida && campanhaEscolhida.status !== 'ativa'
    ? `✓ Enfileirado — mas a campanha está "${campanhaEscolhida.status}", só sai quando ela for ativada`
    : '✓ Etapa 1 enfileirada — sai pelo Hermes');
  if (cmModalId === id) await cmAbrirModal(id); // recarrega a timeline pra já mostrar o item novo
}

async function cmAbrirModal(id) {
  cmModalId = id;
  cmModalHist = null;
  document.getElementById('overlay')?.classList.add('open');
  if (!cmDados) { await cmCarregar(); if (cmModalId !== id) return; }
  cmRenderModal();

  const sb = window.supabaseAtores;
  const p = cmPessoaModal();
  const [{ data: campanhas }, { data: logsSime }, { data: logsHermes }, rawResult] = await Promise.all([
    sb.from('sime_campanhas_confirmacao')
      .select('id, mensagem_enviada, status, erro_msg, created_at')
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
    // Telefones alternativos do TRE — só busca se a pessoa tem título de
    // eleitor (nem todo ator manual tem); sime_mesarios_raw é lida por
    // título porque ator_id nunca foi preenchido nela (a sincronização casa
    // por inscricao_eleitoral, não grava o id de volta no staging).
    p?.inscricao_eleitoral
      ? sb.from('sime_mesarios_raw')
          .select('telefone_pessoal_mesario, telefone_1_eleitor, telefone_2_eleitor, telefone_contato_eleitor, telefone_comercial_mesario')
          .eq('inscricao', p.inscricao_eleitoral).order('importado_em', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
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

  const telefones = cmListaTelefones(p, rawResult?.data);

  cmModalHist = { tentativas, logs, telefones };
  cmRenderModal();
}

// Telefone extra que o cartório descobriu por fora (ligação, parente,
// alguém do local de votação) — quando NÃO está em nenhum campo oficial do
// TRE. Pedido direto em 21/08/2026: "poderíamos ter uma forma de cadastrar
// outro telefone". Fica em sime_atores (first-class, não se perde numa
// recarga de sime_mesarios_raw), separado do telefone_whatsapp principal —
// o Hermes/campanha em massa continua usando só o principal.
async function cmAdicionarTelefoneAlt(id) {
  const campo = document.getElementById('mm-tel-alt-novo');
  const digitos = telSemPais(campo.value);
  if (!digitos || digitos.length < 10) { showToast('⚠ Telefone inválido'); return; }
  const sb = window.supabaseAtores;
  const valor = '55' + digitos;
  const { error } = await sb.from('sime_atores').update({ telefone_alternativo: valor }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  const p = cmDados.pessoas.find(x => x.id === id);
  if (p) p.telefone_alternativo = valor;
  await cmLog('mesario_telefone_alt_adicionado', '', { ator_id: id });
  showToast('✓ Telefone alternativo adicionado');
  if (cmModalId === id) await cmAbrirModal(id);
  render();
}

async function cmRemoverTelefoneAlt(id) {
  const sb = window.supabaseAtores;
  const { error } = await sb.from('sime_atores').update({ telefone_alternativo: null }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  const p = cmDados.pessoas.find(x => x.id === id);
  if (p) p.telefone_alternativo = null;
  await cmLog('mesario_telefone_alt_removido', '', { ator_id: id });
  showToast('✓ Telefone alternativo removido');
  if (cmModalId === id) await cmAbrirModal(id);
  render();
}

function cmFecharModal(e) {
  if (!e || e.target === document.getElementById('overlay')) {
    document.getElementById('overlay')?.classList.remove('open');
    cmModalId = null;
    cmModalHist = null;
  }
}

// "por Fulano" ao final de um item de histórico — só aparece quando o
// payload tem autor (achado real em 21/08/2026: entradas gravadas antes
// desse campo existir não têm de onde vir esse dado, então ficam sem o
// "por" mesmo, em vez de inventar "Cartório" genérico pra elas).
function cmPorAutor(payload) {
  return payload?.autor ? ` <span style="color:var(--text2)">(por ${cmEsc(payload.autor)})</span>` : '';
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
          const erroTxt = c.status === 'erro' && c.erro_msg ? ` <span style="color:var(--red,#c00)">(motivo: ${cmEsc(c.erro_msg)})</span>` : '';
          return `<div class="m-hist-item"><b>${cmFmtDataHist(c.created_at)}</b> — 📢 ${cmEsc(CM_CAMP_STATUS_LABEL[c.status] || c.status || '—')}${erroTxt}${c.mensagem_enviada ? ` — "${cmEsc(c.mensagem_enviada.slice(0, 60))}${c.mensagem_enviada.length > 60 ? '…' : ''}"` : ''}</div>`;
        }
        const meioLbl = CM_MEIO_LABEL[t.payload.meio] || t.payload.meio || 'Contato';
        return `<div class="m-hist-item"><b>${cmFmtDataHist(t.ts)}</b> — ${cmEsc(meioLbl)}${t.payload.nota ? ` — ${cmEsc(t.payload.nota)}` : ''}${cmPorAutor(t.payload)}</div>`;
      });

  const blocoLogs = cmModalHist === null
    ? '<div class="ic-sub" style="margin-bottom:0">Carregando…</div>'
    : cmListaHist(cmModalHist.logs, 'Nenhuma atualização registrada ainda.',
        l => `<div class="m-hist-item"><b>${cmFmtDataHist(l.ts)}</b> — ${cmEsc(l._label(l.payload || {}))}${cmPorAutor(l.payload)}</div>`);

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
        <div class="m-kv-row"><b>Função</b><span>${cmEsc(cmRotuloFuncao(p))}</span></div>
        <div class="m-kv-row"><b>Seção</b><span>${sec ? `${sec.numero} — ${cmEsc(sec.local_nome || '')}, ${cmEsc(sec.municipio || '')}` : '—'}</span></div>
        <div class="m-kv-row"><b>Título de eleitor</b><span>${p.inscricao_eleitoral ? cmEsc(p.inscricao_eleitoral) : '—'}</span></div>
        <div class="m-kv-row"><b>Situação</b><span>${cmBadge(p.confirmacao)}${p.precisa_substituir ? ' · 🔁 Precisa substituto' : ''}${p.tem_relato_terceiro_pendente ? ' · ⚠️ Relato de terceiro pendente' : ''}</span></div>
      </div>

      ${(p.confirmacao || 'pendente') !== 'confirmado' ? `
      <button class="btn btn-dark" style="width:100%;padding:10px;font-size:.8rem" onclick="cmConfirmarParticipacao('${p.id}')">✅ Confirmar participação</button>
      <div class="ic-sub" style="margin-bottom:0">Use quando já souber que a pessoa confirmou por outro canal (sistema do TRE, ligação, presencial) — não depende de resposta automática por WhatsApp.</div>
      ` : ''}

      <div class="m-section">
        <div class="m-section-hdr">📇 Contato</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <button class="btn btn-out" style="font-size:.72rem;padding:5px 10px" onclick="cmTogglePrecisaSubstituir('${p.id}')">${p.precisa_substituir ? '✓ Desmarcar substituição' : '🔁 Marcar para substituir'}</button>
          ${p.tem_relato_terceiro_pendente ? `<button class="btn btn-out" style="font-size:.72rem;padding:5px 10px" onclick="cmResolverRelatoTerceiro('${p.id}')">✓ Marcar relato como resolvido</button>` : ''}
        </div>
        <div class="ic-sub" style="margin-bottom:4px">📞 Todos os telefones conhecidos — cada um pode ser tentado direto (copia o link do WhatsApp já com a mensagem de confirmação e registra a tentativa sozinho):</div>
        <div class="m-hist" style="margin-bottom:10px">
          ${cmModalHist?.telefones?.length ? cmModalHist.telefones.map(t => `
          <div class="m-hist-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <button class="btn btn-out" style="font-size:.66rem;padding:3px 8px;flex-shrink:0" onclick="cmCopiarLinkWhatsAppNumero('${p.id}','${cmEsc(t.valor).replace(/'/g, "\\'")}')">🔗 Copiar</button>
            <span style="flex:1">${cmEsc(t.label)}: <b>${cmEsc(fmtTelefone(t.valor))}</b></span>
            ${t.removivel ? `<button class="btn btn-out" style="font-size:.66rem;padding:3px 8px;flex-shrink:0" onclick="cmRemoverTelefoneAlt('${p.id}')" title="Remover telefone alternativo">✕</button>` : ''}
          </div>`).join('') : '<div class="ic-sub" style="margin-bottom:0">Nenhum telefone cadastrado ainda.</div>'}
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:10px">
          <label style="font-size:.72rem;color:var(--text2);flex:1;min-width:140px">+ Adicionar outro telefone (fora do cadastro do TRE)
            <input id="mm-tel-alt-novo" type="text" placeholder="(86) 9xxxx-xxxx" style="display:block;width:100%;margin-top:2px;padding:6px 8px;border-radius:6px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
          </label>
          <button class="btn btn-out" style="font-size:.72rem;padding:6px 10px" onclick="cmAdicionarTelefoneAlt('${p.id}')">➕ Adicionar telefone</button>
        </div>
        <div class="form-group">
          <label>Telefone (WhatsApp) — principal</label>
          <input id="mm-tel" type="text" value="${cmEsc(fmtTelefone(p.telefone_whatsapp || ''))}" placeholder="(86) 9xxxx-xxxx">
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
        ${p.meio_contato === 'carta_registrada' ? `
        <div class="form-group" style="margin-top:10px">
          <label>Código de rastreio (Correios)</label>
          <input id="mm-rastreio" type="text" value="${cmEsc(p.codigo_rastreio || '')}" placeholder="AA123456789BR" style="text-transform:uppercase">
          ${p.codigo_rastreio ? `<div style="margin-top:4px"><a href="${cmLinkRastreio(p.codigo_rastreio)}" target="_blank" rel="noopener" style="font-size:.72rem">📦 Rastrear no site dos Correios</a></div>` : ''}
        </div>` : ''}
      </div>

      <div class="m-section">
        <div class="m-section-hdr">🧩 Rodar script conversacional</div>
        <div class="ic-sub">Manda a etapa 1 de um script salvo (aba 🧩 Campanhas, em Cadastro de Atores) pra qualquer número — não precisa ser o telefone cadastrado desta pessoa. As etapas seguintes seguem sozinhas, de acordo com a resposta; o envio de fato depende do Hermes estar com o disparo ligado.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          <label style="font-size:.72rem;color:var(--text2);flex:2;min-width:180px">Script
            <select id="mm-script-campanha" onchange="cmScriptSelecionarCampanha(this.value)" style="display:block;width:100%;margin-top:2px;padding:6px 8px;border-radius:6px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
              <option value="">— escolha um script salvo —</option>
              ${cmScriptCampanhas.filter(c => c.status !== 'encerrada').map(c => `<option value="${c.id}" ${cmScriptCampanhaId === c.id ? 'selected' : ''}>${cmEsc(c.nome)} (${c.status})</option>`).join('')}
            </select>
          </label>
          <label style="font-size:.72rem;color:var(--text2);flex:1;min-width:150px">Número indicado
            <input id="mm-script-tel" type="text" value="${cmEsc(fmtTelefone(p.telefone_whatsapp || ''))}" placeholder="(86) 9xxxx-xxxx" style="display:block;width:100%;margin-top:2px;padding:6px 8px;border-radius:6px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
          </label>
          <button class="btn btn-dark" style="font-size:.72rem;padding:6px 12px" onclick="cmEnviarScript('${p.id}')">▶ Enviar</button>
        </div>
        ${!cmScriptCampanhas.filter(c => c.status !== 'encerrada').length ? '<div class="ic-sub" style="margin-top:4px;margin-bottom:0">Nenhum script salvo nesta zona ainda — crie um na aba 🧩 Campanhas de Cadastro de Atores.</div>' : ''}
        ${cmScriptEtapa1 ? `<div class="ic-sub" style="margin-top:8px;margin-bottom:0"><b>Prévia da etapa 1:</b><br><pre style="white-space:pre-wrap;font-family:inherit;margin:4px 0 0">${cmEsc(cmScriptEtapa1)}</pre>${cmScriptEtapa1Imagem ? `<img src="${cmEsc(cmScriptEtapa1Imagem)}" alt="Prévia da imagem da etapa 1" style="max-width:160px;max-height:160px;border-radius:6px;margin-top:6px;display:block">` : ''}</div>` : ''}
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
  // Bug real corrigido em 21/08/2026: o campo mostra o telefone formatado
  // por fmtTelefone(), que já tira o "55" da frente (telSemPais) — comparar
  // esse valor direto com p.telefone_whatsapp (guardado COM 55) sempre dava
  // "mudou", mesmo sem editar nada, e reescrevia o telefone sem o 55 a cada
  // "Salvar". Normaliza os dois lados do mesmo jeito antes de comparar, e
  // grava de volta no formato com 55 (mesma convenção do resto do sistema —
  // Ciente/colar-lista já gravam assim).
  const telDigitado = telSemPais(document.getElementById('mm-tel').value);
  const telAtual = telSemPais(p.telefone_whatsapp || '');
  const telMudou = telDigitado !== telAtual;
  // Campo só existe no DOM quando meio_contato==='carta_registrada' — fora
  // disso não mexe em codigo_rastreio (preserva o que já tinha).
  const rastreioEl = document.getElementById('mm-rastreio');
  const rastreio = rastreioEl ? rastreioEl.value.trim().toUpperCase() : (p.codigo_rastreio || '');
  const patch = {};
  if (telMudou) patch.telefone_whatsapp = telDigitado ? '55' + telDigitado : null;
  if (rastreioEl && rastreio !== (p.codigo_rastreio || '')) patch.codigo_rastreio = rastreio || null;
  // Mesma lógica do telefone principal: só grava se realmente digitou algo
  // novo (não sobrescreve com vazio o que já tinha por engano).
  const telAltEl = document.getElementById('mm-tel-alt-novo');
  const telAltDigitado = telAltEl ? telSemPais(telAltEl.value) : '';
  if (telAltDigitado && telAltDigitado.length >= 10) patch.telefone_alternativo = '55' + telAltDigitado;

  // "Salvar" recolhe também o que ficou digitado nas caixas de ação rápida
  // (tentativa/observação/telefone alternativo) mesmo sem clicar no botão
  // próprio de cada uma — achado real (21/08/2026): a pessoa digita numa
  // dessas caixas e clica no "Salvar" do rodapé (o botão mais visível,
  // parece "salvar a tela toda"), e o texto sumia sem aviso porque só
  // telefone/rastreio eram cobertos aqui. Sem isso ficaria fácil perder uma
  // nota, observação ou telefone por engano.
  const notaTentativaEl = document.getElementById('mm-tent-nota');
  const notaTentativa = notaTentativaEl ? notaTentativaEl.value.trim() : '';
  const obsNovaEl = document.getElementById('mm-obs-nova');
  const obsNova = obsNovaEl ? obsNovaEl.value.trim() : '';

  if (!Object.keys(patch).length && !notaTentativa && !obsNova) {
    showToast('Nada para salvar');
    cmFecharModal();
    return;
  }

  // Bug real reportado em 21/08/2026: "clico em Salvar e o modal não fecha".
  // sb.from(...).update(...) não rejeita em erro de banco (resolve
  // {data,error} normalmente, já tratado acima) — mas um erro de REDE de
  // verdade (sem sinal, timeout) FAZ o await rejeitar, e isso não tinha
  // try/catch nenhum: a exceção saía sem tratamento, cmFecharModal() nunca
  // era alcançado, e não aparecia toast nenhum — parecia que o clique não
  // fez nada. Envolve tudo num try/catch: em qualquer falha inesperada,
  // mostra o motivo e MANTÉM o modal aberto (não perde o que a pessoa
  // digitou), em vez de falhar em silêncio.
  try {
    if (Object.keys(patch).length) {
      const { error } = await sb.from('sime_atores').update(patch).eq('id', id);
      if (error) { showToast('⚠ ' + error.message); return; }
      Object.assign(p, patch);
      if ('telefone_whatsapp' in patch) await cmLog('mesario_editar_telefone', '', { ator_id: id });
      if ('codigo_rastreio' in patch) await cmLog('mesario_editar_rastreio', '', { ator_id: id });
      if ('telefone_alternativo' in patch) await cmLog('mesario_telefone_alt_adicionado', '', { ator_id: id });
    }
    if (notaTentativa) {
      const meioEl = document.getElementById('mm-tent-meio');
      await cmRegistrarTentativaCore(id, meioEl ? meioEl.value : (p.meio_contato || 'whatsapp'), notaTentativa);
    }
    if (obsNova) await cmAppendObservacao(id, obsNova);
  } catch (e) {
    showToast('⚠ Falha ao salvar — verifique a conexão e tente de novo');
    console.error('cmSalvarModal', e);
    return;
  }

  showToast('✓ Dados atualizados');
  cmFecharModal();
  render();
}

function cmFiltrar() {
  const q = cmBusca.trim().toLowerCase();
  return cmDados.pessoas.filter(p => {
    if (cmFiltroStatus === 'precisa_substituir') { if (!p.precisa_substituir) return false; }
    else if (cmFiltroStatus === 'relato_terceiro_pendente') { if (!p.tem_relato_terceiro_pendente) return false; }
    else if (cmFiltroStatus && p.confirmacao !== cmFiltroStatus) return false;
    if (cmFiltroFuncao && p.funcao !== cmFiltroFuncao) return false;
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
  contagem.relato_terceiro_pendente = cmDados.pessoas.filter(p => p.tem_relato_terceiro_pendente).length;
  const contagemFuncao = {};
  for (const p of cmDados.pessoas) contagemFuncao[p.funcao] = (contagemFuncao[p.funcao] || 0) + 1;
  const lista = cmFiltrar();

  c.innerHTML = `
    <div class="import-card">
      <div class="ic-title">📞 Contatar mesários</div>
      <div class="ic-sub">Mesários e apoio logístico — quem falta contactar, quem recusou, e quem precisa de outro meio de
        contato (Carta Registrada/Oficial de Justiça) quando o WhatsApp não funciona.</div>
      ${CM_CAMP_STATUS_ORDEM.some(s => cmDados.statusFila[s]) ? `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        ${CM_CAMP_STATUS_ORDEM.filter(s => cmDados.statusFila[s]).map(s => `
          <span title="${cmEsc(CM_CAMP_STATUS_LABEL[s] || s)}" style="font-size:.72rem;padding:4px 9px;border-radius:99px;border:1px solid var(--border2);background:${s === 'erro' ? 'var(--red-bg,#fee)' : 'var(--bg2)'};color:${s === 'erro' ? 'var(--red,#c00)' : 'var(--text)'}">
            ${s === 'erro' ? '⚠️' : '•'} ${cmEsc(CM_CAMP_STATUS_LABEL[s] || s)}: <b>${cmDados.statusFila[s]}</b>
          </span>`).join('')}
      </div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <select id="cm-filtro" onchange="cmFiltroStatus=this.value;render()">
          ${CM_BUCKETS.map(b => `<option value="${b.valor}" ${cmFiltroStatus === b.valor ? 'selected' : ''}>${b.label}${b.valor ? ` (${contagem[b.valor] || 0})` : ` (${cmDados.pessoas.length})`}</option>`).join('')}
        </select>
        <select id="cm-filtro-funcao" onchange="cmFiltroFuncao=this.value;render()">
          ${CM_FUNCAO_FILTRO.map(f => `<option value="${f.valor}" ${cmFiltroFuncao === f.valor ? 'selected' : ''}>${f.label}${f.valor ? ` (${contagemFuncao[f.valor] || 0})` : ` (${cmDados.pessoas.length})`}</option>`).join('')}
        </select>
        <input type="text" placeholder="Buscar por nome ou título de eleitor…" value="${cmEsc(cmBusca)}" oninput="cmBusca=this.value;render()" style="flex:1;min-width:160px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="ic-sub" style="margin-bottom:0">${lista.length} de ${cmDados.pessoas.length} pessoa(s)</div>
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
                ${cmEsc(cmRotuloFuncao(p))}${sec ? ` — Seção ${sec.numero} (${cmEsc(sec.local_nome || '')}, ${cmEsc(sec.municipio || '')})` : ''}
              </div>
              ${p.inscricao_eleitoral ? `<div class="ic-sub" style="margin-bottom:0">Título ${cmEsc(p.inscricao_eleitoral)}</div>` : ''}
              ${p.telefone_whatsapp ? `<div class="ic-sub" style="margin-bottom:0">${linkWhatsApp(p.telefone_whatsapp) ? `<a href="${linkWhatsApp(p.telefone_whatsapp)}" target="_blank" rel="noopener">${fmtTelefone(p.telefone_whatsapp)}</a>` : fmtTelefone(p.telefone_whatsapp)}</div>` : '<div class="ic-sub" style="margin-bottom:0">Sem telefone cadastrado</div>'}
              ${(p.confirmacao || 'pendente') === 'pendente' && p.tentativas > 0 ? `<div class="ic-sub" style="margin-bottom:0">📨 Já contactado (${p.tentativas}x) — aguardando resposta</div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
              <span class="import-result ${p.confirmacao === 'confirmado' ? 'ir-ok' : p.confirmacao === 'recusou' || p.confirmacao === 'contato_incorreto' ? 'ir-warn' : ''}" style="margin-top:0;white-space:nowrap">${cmBadge(p.confirmacao)}</span>
              ${p.precisa_substituir ? `<span class="import-result ir-warn" style="margin-top:0;white-space:nowrap">🔁 Precisa substituto</span>` : ''}
              ${p.tem_relato_terceiro_pendente ? `<span class="import-result ir-warn" style="margin-top:0;white-space:nowrap">⚠️ Relato de terceiro pendente</span>` : ''}
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
            ${(p.confirmacao || 'pendente') !== 'confirmado' ? `<button class="btn btn-dark" style="font-size:.72rem;padding:5px 10px" onclick="cmConfirmarParticipacao('${p.id}')" title="Pra quando você já sabe que a pessoa confirmou por outro canal (sistema do TRE, ligação, presencial) — só marca confirmado, não manda mensagem nenhuma">✅ Confirmar participação</button>` : ''}
            ${podeMarcarIncorreto ? `<button class="btn btn-out" style="font-size:.72rem;padding:5px 10px" onclick="cmMarcarContatoIncorreto('${p.id}')">🔍 Marcar contato incorreto</button>` : ''}
            <button class="btn btn-out" style="font-size:.72rem;padding:5px 10px" onclick="cmTogglePrecisaSubstituir('${p.id}')">${p.precisa_substituir ? '✓ Desmarcar substituição' : '🔁 Marcar para substituir'}</button>
            ${p.tem_relato_terceiro_pendente ? `<button class="btn btn-out" style="font-size:.72rem;padding:5px 10px" onclick="cmResolverRelatoTerceiro('${p.id}')">✓ Marcar relato como resolvido</button>` : ''}
          </div>
        </div>`;
      }).join('') || '<div class="import-card"><div class="ic-sub" style="margin-bottom:0">Ninguém encontrado com esse filtro.</div></div>'}
    </div>`;
}
