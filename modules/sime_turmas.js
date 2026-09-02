// sime_turmas.js — Turmas de treinamento (aba "🎓 Treinamento" de
// SIME_convocacao.html).
//
// Pedido direto (02/09/2026): o cartório colou o conteúdo da tela de turmas
// de treinamento do ELO (identificação + instrutores + mesários alunos) e
// avisou "irei enviar 16 turmas". Por isso a entrada principal aqui é
// COLAR O TEXTO da tela do ELO, não um formulário campo a campo — 16 turmas
// digitadas à mão seriam ~16 formulários e ~600 nomes.
//
// O ELO continua sendo o sistema oficial (é lá que a turma existe, e é de lá
// que saem a carta de convocação e o Título Net). Esta aba é a visão
// OPERACIONAL do cartório: quem já tem turma, quem ficou de fora, e quem
// faltou no dia.

const TU_PRESENCA = {
  pendente:    { label: '⏳ Pendente', cls: '' },
  presente:    { label: '✅ Presente', cls: 'ir-ok' },
  ausente:     { label: '❌ Faltou', cls: 'ir-err' },
  justificado: { label: '📄 Falta justificada', cls: 'ir-warn' },
};

let tuDados = null;      // { turmas:[...], pessoasPorTurma:{}, atoresPorTitulo:Map, semTurma:[...], zonaId }
let tuBusca = '';
let tuTurmaAberta = null; // id da turma no drilldown; null = lista
let tuColarAberto = false;
let tuPreview = null;     // resultado de tuParse() aguardando confirmação

function tuEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function tuJsStr(s) { return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

function tuFmtData(d) {
  if (!d) return 'sem data';
  const [a, m, dia] = String(d).split('-');
  return `${dia}/${m}/${a}`;
}
function tuFmtHora(h) { return h ? String(h).slice(0, 5) : ''; }

// ── Parser do texto colado do ELO ──────────────────────────────────────────
// Formato real (conferido no texto que o cartório colou): rótulo numa linha,
// valor na linha seguinte — ou "Rótulo: valor" na mesma linha, pros três
// campos que o ELO imprime com dois-pontos (Início/Fim/Mostrar instruções…).
// As duas listas de pessoas (instrutores e alunos) são pares de linhas:
// inscrição, depois nome.
const TU_CAMPOS = [
  ['uf', /^UF$/i],
  ['zona', /^Zona$/i],
  ['modalidade', /^Modalidade$/i],
  ['numero', /^N[úu]mero da turma$/i],
  ['nome', /^Nome da turma$/i],
  ['tipo_funcao', /^Tipo fun[çc][ãa]o$/i],
  ['funcao', /^Fun[çc][ãa]o$/i],
  ['local_treinamento', /^Local de treinamento$/i],
  ['endereco_treinamento', /^Endere[çc]o local de treinamento$/i],
  ['data_treinamento', /^Data treinamento$/i],
  ['hora_inicio', /^In[íi]cio:?$/i],
  ['hora_fim', /^Fim:?$/i],
  ['instrucoes', /^Instru[çc][õo]es$/i],
  ['mostrar_titulo_net', /^Mostrar instru[çc][õo]es no T[íi]tulo Net:?$/i],
  ['mostrar_carta', /^Mostrar instru[çc][õo]es na carta de convoca[çc][ãa]o:?$/i],
];

function tuCampoDaLinha(linha) {
  // "Início: 08:00" — rótulo e valor na mesma linha.
  const comValor = linha.match(/^([^:]+:)\s*(.+)$/);
  for (const [campo, re] of TU_CAMPOS) {
    if (re.test(linha)) return { campo, valor: null };
    if (comValor && re.test(comValor[1].trim())) return { campo, valor: comValor[2].trim() };
  }
  return null;
}

function tuSimNao(v) {
  if (v == null) return null;
  if (/^sim$/i.test(String(v).trim())) return true;
  if (/^n[ãa]o$/i.test(String(v).trim())) return false;
  return null;
}
function tuData(v) {
  const m = String(v || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function tuHora(v) {
  const m = String(v || '').match(/(\d{1,2}):(\d{2})/);
  return m ? `${String(m[1]).padStart(2, '0')}:${m[2]}` : null;
}

// Devolve { turmas: [...], avisos: [...] } — nunca lança: texto que não bate
// com nada vira aviso pra conferência manual, mesmo critério "nunca adivinha"
// do resto dos importadores do projeto.
function tuParse(texto) {
  const linhas = String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const turmas = [];
  const avisos = [];
  let atual = null;
  let secao = null;       // null | 'instrutor' | 'aluno'
  let campoAberto = null; // último rótulo visto, esperando o valor na próxima linha
  let inscricaoPend = null;

  const fechar = () => {
    if (!atual) return;
    if (inscricaoPend) { avisos.push(`Inscrição ${inscricaoPend} ficou sem nome na turma ${atual.numero || '?'}`); inscricaoPend = null; }
    turmas.push(atual);
    atual = null;
  };

  for (const linha of linhas) {
    if (/^1\s*[-–]\s*Identifica[çc][ãa]o da turma/i.test(linha)) {
      fechar();
      atual = { pessoas: [] };
      secao = null; campoAberto = null; inscricaoPend = null;
      continue;
    }
    if (/^2\s*[-–]\s*Instrutores/i.test(linha)) { secao = 'instrutor'; campoAberto = null; inscricaoPend = null; continue; }
    if (/^3\s*[-–]\s*Mes[áa]rios? alunos?/i.test(linha)) { secao = 'aluno'; campoAberto = null; inscricaoPend = null; continue; }
    if (!atual) continue; // lixo antes do primeiro "1 - Identificação" (ex.: o título "turmas de treinamento")

    if (secao) {
      // Cabeçalho da tabela do ELO — não é gente.
      if (/^(Inscri[çc][ãa]o|Instrutor|Mes[áa]rio Aluno)$/i.test(linha)) continue;
      const digitos = linha.replace(/\D/g, '');
      if (/^[\d.\s-]+$/.test(linha) && digitos.length >= 10 && digitos.length <= 13) {
        if (inscricaoPend) avisos.push(`Inscrição ${inscricaoPend} ficou sem nome na turma ${atual.numero || '?'}`);
        inscricaoPend = normalizarTituloEleitor(digitos);
        continue;
      }
      if (inscricaoPend) {
        atual.pessoas.push({ papel: secao, inscricao: inscricaoPend, nome: linha });
        inscricaoPend = null;
      } else {
        avisos.push(`Linha sem inscrição antes dela, ignorada: "${linha}"`);
      }
      continue;
    }

    const campo = tuCampoDaLinha(linha);
    if (campo) {
      if (campo.valor != null) { atual[campo.campo] = campo.valor; campoAberto = null; }
      else campoAberto = campo.campo;
      continue;
    }
    if (campoAberto) {
      // Instruções é o único campo multilinha na prática — os demais têm
      // valor de uma linha só, então o rótulo seguinte fecha o anterior.
      atual[campoAberto] = campoAberto === 'instrucoes' && atual.instrucoes
        ? atual.instrucoes + ' ' + linha
        : linha;
      if (campoAberto !== 'instrucoes') campoAberto = null;
    }
  }
  fechar();

  const prontas = [];
  for (const t of turmas) {
    if (!t.numero) { avisos.push(`Uma turma foi ignorada por não ter "Número da turma"${t.nome ? ` (${t.nome})` : ''}`); continue; }
    prontas.push({
      numero: String(t.numero).trim(),
      nome: t.nome || null,
      uf: t.uf || null,
      modalidade: t.modalidade || null,
      tipo_funcao: t.tipo_funcao && t.tipo_funcao !== '-' ? t.tipo_funcao : null,
      funcao: t.funcao && t.funcao !== '-' ? t.funcao : null,
      local_treinamento: t.local_treinamento || null,
      endereco_treinamento: t.endereco_treinamento || null,
      data_treinamento: tuData(t.data_treinamento),
      hora_inicio: tuHora(t.hora_inicio),
      hora_fim: tuHora(t.hora_fim),
      instrucoes: t.instrucoes || null,
      mostrar_titulo_net: tuSimNao(t.mostrar_titulo_net),
      mostrar_carta: tuSimNao(t.mostrar_carta),
      zona_texto: t.zona || null,
      pessoas: t.pessoas,
    });
  }
  return { turmas: prontas, avisos };
}

// ── Carga ──────────────────────────────────────────────────────────────────
async function tuCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { tuDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const { data: turmas, error: e1 } = await sb.from('sime_turmas')
    .select('*').eq('zona_id', zonaId).eq('ativo', true)
    .order('numero', { ascending: true });
  if (e1) { tuDados = { erro: e1.message }; render(); return; }

  const ids = (turmas || []).map(t => t.id);
  const [{ data: pessoas, error: e2 }, { data: atores, error: e3 }] = await Promise.all([
    ids.length
      ? sb.from('sime_turma_pessoas').select('*').in('turma_id', ids).order('nome', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    sb.from('sime_atores')
      .select('id, nome_completo, inscricao_eleitoral, funcao, funcao_mesa, telefone_whatsapp, secao_id, confirmacao')
      .eq('zona_id', zonaId).eq('ativo', true),
  ]);
  if (e2 || e3) { tuDados = { erro: (e2 || e3).message }; render(); return; }

  const atoresPorTitulo = new Map();
  for (const a of atores || []) if (a.inscricao_eleitoral) atoresPorTitulo.set(a.inscricao_eleitoral, a);

  const pessoasPorTurma = {};
  const inscricoesEmTurma = new Set();
  for (const p of pessoas || []) {
    (pessoasPorTurma[p.turma_id] ||= []).push(p);
    if (p.papel === 'aluno') inscricoesEmTurma.add(p.inscricao);
  }

  // Quem está no roster ativo e não aparece como ALUNO de nenhuma turma —
  // é a pergunta que o cartório faz de verdade ("faltou alguém sem
  // treinamento?"). Instrutor não conta: ele treina, não é treinado.
  const semTurma = (atores || [])
    .filter(a => a.inscricao_eleitoral && !inscricoesEmTurma.has(a.inscricao_eleitoral))
    .sort((a, b) => (a.nome_completo || '').localeCompare(b.nome_completo || ''));

  tuDados = { turmas: turmas || [], pessoasPorTurma, atoresPorTitulo, semTurma, zonaId, totalAtores: (atores || []).length };
  render();
}

// ── Gravação ───────────────────────────────────────────────────────────────
// Upsert por (zona_id, numero) na turma e por (turma_id, papel, inscricao)
// nas pessoas — recolar a mesma turma ATUALIZA, nunca duplica, e a presença
// já marcada é preservada (o upsert de pessoa não escreve `presenca`).
async function tuImportar() {
  const sb = window.supabaseAtores;
  if (!tuPreview || !tuPreview.turmas.length) { showToast('⚠ Nada para importar'); return; }
  const zonaId = tuDados.zonaId;

  const { data: { user } } = await sb.auth.getUser();
  const { data: meu } = await sb.from('sime_usuarios').select('id').eq('auth_user_id', user?.id).maybeSingle();
  const { data: ts } = await sb.rpc('sime_now');

  let okTurmas = 0, okPessoas = 0, semRoster = 0;
  try {
    for (const t of tuPreview.turmas) {
      const { pessoas, zona_texto, ...campos } = t;
      const { data: turma, error } = await sb.from('sime_turmas')
        .upsert({ ...campos, zona_id: zonaId, created_by: meu?.id || null, updated_at: ts }, { onConflict: 'zona_id,numero' })
        .select('id').single();
      if (error) { showToast('⚠ ' + error.message); return; }
      okTurmas++;

      const linhas = pessoas.map(p => {
        const ator = tuDados.atoresPorTitulo.get(p.inscricao);
        if (!ator) semRoster++;
        return { turma_id: turma.id, papel: p.papel, inscricao: p.inscricao, nome: p.nome, ator_id: ator?.id || null, updated_at: ts };
      });
      if (linhas.length) {
        const { error: eP } = await sb.from('sime_turma_pessoas')
          .upsert(linhas, { onConflict: 'turma_id,papel,inscricao', ignoreDuplicates: false });
        if (eP) { showToast('⚠ ' + eP.message); return; }
        okPessoas += linhas.length;
      }
      await log('turma_importada', '', { numero: t.numero, nome: t.nome, pessoas: linhas.length });
    }
  } catch (e) {
    showToast('⚠ Falha ao importar — verifique a conexão e tente de novo');
    return;
  }

  showToast(`✓ ${okTurmas} turma(s), ${okPessoas} pessoa(s)${semRoster ? ` — ${semRoster} sem correspondência no roster` : ''}`);
  tuPreview = null; tuColarAberto = false; tuDados = null;
  render();
}

async function tuPrevisualizar() {
  const texto = document.getElementById('tu-colar')?.value || '';
  const r = tuParse(texto);
  if (!r.turmas.length) { showToast('⚠ Não reconheci nenhuma turma nesse texto'); tuPreview = null; render(); return; }
  tuPreview = r;
  render();
}

async function tuMarcarPresenca(pessoaId, valor) {
  const sb = window.supabaseAtores;
  const lista = tuDados.pessoasPorTurma[tuTurmaAberta] || [];
  const p = lista.find(x => x.id === pessoaId);
  if (!p) return;
  const { data: ts } = await sb.rpc('sime_now');
  const { error } = await sb.from('sime_turma_pessoas').update({ presenca: valor, updated_at: ts }).eq('id', pessoaId);
  if (error) { showToast('⚠ ' + error.message); return; }
  p.presenca = valor;
  await log('turma_presenca', '', { turma_id: tuTurmaAberta, pessoa: p.nome, inscricao: p.inscricao, presenca: valor });
  render();
}

// Soft-delete, mesmo padrão do resto do SIME — a turma sai da tela, o
// registro (e a presença já marcada) continua no banco.
async function tuRemoverTurma(id) {
  const sb = window.supabaseAtores;
  const t = (tuDados.turmas || []).find(x => x.id === id);
  if (!t) return;
  if (!confirm(`Remover a turma ${t.numero}${t.nome ? ` (${t.nome})` : ''} desta lista?`)) return;
  const { data: ts } = await sb.rpc('sime_now');
  const { error } = await sb.from('sime_turmas').update({ ativo: false, updated_at: ts }).eq('id', id);
  if (error) { showToast('⚠ ' + error.message); return; }
  await log('turma_removida', '', { id, numero: t.numero });
  showToast('✓ Turma removida da lista');
  tuTurmaAberta = null; tuDados = null;
  render();
}

// Link do WhatsApp com o convite pronto — copiado, não aberto (mesmo padrão
// de "Contatar mesários": abrir aba/app novo a cada pessoa é mais disruptivo
// que colar num WhatsApp Web já aberto).
async function tuCopiarConvite(pessoaId) {
  const lista = tuDados.pessoasPorTurma[tuTurmaAberta] || [];
  const p = lista.find(x => x.id === pessoaId);
  const t = (tuDados.turmas || []).find(x => x.id === tuTurmaAberta);
  if (!p || !t) return;
  const ator = p.ator_id ? [...tuDados.atoresPorTitulo.values()].find(a => a.id === p.ator_id) : tuDados.atoresPorTitulo.get(p.inscricao);
  if (!ator?.telefone_whatsapp) { showToast('⚠ Sem telefone cadastrado no roster para esta pessoa'); return; }
  const quando = `${tuFmtData(t.data_treinamento)}${t.hora_inicio ? `, das ${tuFmtHora(t.hora_inicio)} às ${tuFmtHora(t.hora_fim)}` : ''}`;
  const msg = `${cmSaudacaoPorHora()}, ${p.nome}! Aqui é do cartório eleitoral. Seu treinamento de mesário é ${quando}, em ${t.local_treinamento || 'local a confirmar'}${t.endereco_treinamento ? ` (${t.endereco_treinamento})` : ''}. Podemos contar com sua presença?`;
  const link = linkWhatsApp(ator.telefone_whatsapp, msg);
  if (!link) { showToast('⚠ Telefone inválido'); return; }
  try {
    await navigator.clipboard.writeText(link);
    showToast('🔗 Link do WhatsApp copiado');
  } catch (e) { showToast('⚠ Não deu pra copiar — copie manualmente'); }
}

function tuImprimirLista() {
  const t = (tuDados.turmas || []).find(x => x.id === tuTurmaAberta);
  if (!t) return;
  const pessoas = (tuDados.pessoasPorTurma[t.id] || []);
  const alunos = pessoas.filter(p => p.papel === 'aluno');
  const instrutores = pessoas.filter(p => p.papel === 'instrutor');
  document.getElementById('print-area').innerHTML = `
    <div class="co-pagina-etiqueta">
      <h2 style="margin:0 0 2mm">Lista de presença — Turma ${tuEsc(t.numero)}${t.nome ? ` (${tuEsc(t.nome)})` : ''}</h2>
      <div style="font-size:9pt;margin-bottom:3mm">
        ${tuEsc(tuFmtData(t.data_treinamento))}${t.hora_inicio ? ` · ${tuEsc(tuFmtHora(t.hora_inicio))} às ${tuEsc(tuFmtHora(t.hora_fim))}` : ''}<br>
        ${tuEsc(t.local_treinamento || '')}${t.endereco_treinamento ? `<br>${tuEsc(t.endereco_treinamento)}` : ''}<br>
        Instrutores: ${instrutores.map(i => tuEsc(i.nome)).join(', ') || '—'}
      </div>
      <table class="oj-tabela">
        <thead><tr><th style="width:8%">#</th><th style="width:22%">Inscrição</th><th>Nome</th><th style="width:32%">Assinatura</th></tr></thead>
        <tbody>${alunos.map((p, i) => `<tr><td>${i + 1}</td><td>${tuEsc(p.inscricao)}</td><td>${tuEsc(p.nome)}</td><td>&nbsp;</td></tr>`).join('')}</tbody>
      </table>
      <div style="font-size:7.5pt;margin-top:3mm">Lista de controle interno do SIME — o registro oficial do treinamento é o do ELO.</div>
    </div>`;
  log('turma_lista_impressa', '', { turma_id: t.id, numero: t.numero, alunos: alunos.length });
  window.print();
}

// ── Render ─────────────────────────────────────────────────────────────────
function tuResumo(turmaId) {
  const pessoas = (tuDados.pessoasPorTurma[turmaId] || []).filter(p => p.papel === 'aluno');
  const r = { total: pessoas.length, presente: 0, ausente: 0, justificado: 0, pendente: 0, semRoster: 0 };
  for (const p of pessoas) { r[p.presenca] = (r[p.presenca] || 0) + 1; if (!p.ator_id) r.semRoster++; }
  return r;
}

function renderTurmas() {
  const content = document.getElementById('content');
  if (!tuDados) { content.innerHTML = '<div class="import-card">Carregando…</div>'; tuCarregar(); return; }
  if (tuDados.erro) { content.innerHTML = `<div class="import-card"><div class="import-result ir-err">⚠ ${tuEsc(tuDados.erro)}</div></div>`; return; }
  if (tuTurmaAberta) { tuRenderDrilldown(); return; }

  const q = tuBusca.trim().toLowerCase();
  const lista = (tuDados.turmas || []).filter(t => {
    if (!q) return true;
    const alvo = `${t.numero} ${t.nome || ''} ${t.local_treinamento || ''} ${t.funcao || ''} ${t.tipo_funcao || ''}`.toLowerCase();
    if (alvo.includes(q)) return true;
    // Busca por aluno também — "em que turma o Fulano está?" é a pergunta
    // mais comum depois de importar tudo.
    return (tuDados.pessoasPorTurma[t.id] || []).some(p => p.nome.toLowerCase().includes(q) || p.inscricao.includes(q.replace(/\D/g, '')));
  });

  const totalAlunos = Object.values(tuDados.pessoasPorTurma).flat().filter(p => p.papel === 'aluno').length;

  content.innerHTML = `
    <div class="import-card">
      <div class="ic-title">🎓 Turmas de treinamento</div>
      <div class="ic-sub">Cole aqui o conteúdo da tela de turma do ELO — identificação, instrutores e mesários alunos, do jeito que aparece lá. Recolar a mesma turma atualiza os dados e mantém a presença já marcada; o ELO continua sendo o registro oficial.</div>
      <button class="btn btn-dark" onclick="tuColarAberto=!tuColarAberto;tuPreview=null;render()">${tuColarAberto ? '▾' : '▸'} 📋 Colar turma do ELO</button>
      ${tuColarAberto ? `
      <div style="margin-top:10px">
        <textarea id="tu-colar" rows="10" placeholder="1 - Identificação da turma&#10;UF&#10;PI&#10;Zona&#10;7&#10;…" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:monospace;font-size:.75rem"></textarea>
        <div class="ic-sub" style="margin:4px 0 8px">Dá pra colar várias turmas de uma vez — cada uma começa em "1 - Identificação da turma".</div>
        <button class="btn btn-out" onclick="tuPrevisualizar()">🔍 Conferir antes de importar</button>
      </div>` : ''}
      ${tuPreview ? `
      <div style="margin-top:10px">
        ${tuPreview.turmas.map(t => `<div class="import-result ir-ok">Turma ${tuEsc(t.numero)}${t.nome ? ` — ${tuEsc(t.nome)}` : ''} · ${tuEsc(tuFmtData(t.data_treinamento))} · ${t.pessoas.filter(p => p.papel === 'aluno').length} aluno(s), ${t.pessoas.filter(p => p.papel === 'instrutor').length} instrutor(es)</div>`).join('')}
        ${tuPreview.avisos.map(a => `<div class="import-result ir-warn">⚠ ${tuEsc(a)}</div>`).join('')}
        <button class="btn btn-dark" style="margin-top:8px" onclick="tuImportar()">💾 Importar ${tuPreview.turmas.length} turma(s)</button>
      </div>` : ''}
    </div>

    <div class="import-card">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="text" placeholder="Buscar turma, local ou nome de aluno…" value="${tuEsc(tuBusca)}" oninput="tuBusca=this.value;render()" style="flex:1;min-width:180px;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)">
      </div>
      <div class="ic-sub" style="margin:8px 0 0">${lista.length} de ${tuDados.turmas.length} turma(s) · ${totalAlunos} aluno(s) no total</div>
    </div>

    ${tuDados.semTurma.length ? `
    <div class="import-card">
      <div class="import-result ir-warn" style="margin:0">⚠️ ${tuDados.semTurma.length} pessoa(s) do roster ativo ainda não aparece(m) como aluno(a) em nenhuma turma importada</div>
      <div class="ic-sub" style="margin:6px 0 0">${tuDados.semTurma.slice(0, 8).map(a => tuEsc(a.nome_completo)).join(' · ')}${tuDados.semTurma.length > 8 ? ` · +${tuDados.semTurma.length - 8}` : ''}</div>
      <div class="ic-sub" style="margin:4px 0 0">Enquanto as 16 turmas não estiverem todas importadas, é normal esse número ser alto — ele só vira uma pendência de verdade depois que tudo estiver aqui.</div>
    </div>` : ''}

    <div style="display:flex;flex-direction:column;gap:8px">
      ${lista.length ? lista.map(t => {
        const r = tuResumo(t.id);
        return `
      <div class="import-card" style="padding:12px 14px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
          <div>
            <div style="font-weight:800;font-size:.86rem;cursor:pointer" onclick="tuTurmaAberta='${t.id}';render()">Turma ${tuEsc(t.numero)}${t.nome ? ` — ${tuEsc(t.nome)}` : ''}</div>
            <div class="ic-sub" style="margin:2px 0 0">${tuEsc(tuFmtData(t.data_treinamento))}${t.hora_inicio ? ` · ${tuEsc(tuFmtHora(t.hora_inicio))}–${tuEsc(tuFmtHora(t.hora_fim))}` : ''} · ${tuEsc(t.modalidade || '')}${t.tipo_funcao ? ` · ${tuEsc(t.tipo_funcao)}` : ''}${t.funcao ? ` (${tuEsc(t.funcao)})` : ''}</div>
            <div class="ic-sub" style="margin:2px 0 0">${tuEsc(t.local_treinamento || 'Local não informado')}</div>
          </div>
          <span class="import-result ${r.presente === r.total && r.total ? 'ir-ok' : ''}" style="margin-top:0;white-space:nowrap">${r.total} aluno(s)${r.presente ? ` · ${r.presente} presente(s)` : ''}${r.ausente ? ` · ${r.ausente} falta(s)` : ''}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <button class="btn btn-out" style="font-size:.7rem;padding:5px 10px" onclick="tuTurmaAberta='${t.id}';render()">👥 Abrir lista</button>
          <button class="btn btn-out" style="font-size:.7rem;padding:5px 10px" onclick="tuRemoverTurma('${t.id}')">✕ Remover</button>
          ${r.semRoster ? `<span class="ic-sub" style="margin:0;align-self:center">🔍 ${r.semRoster} sem correspondência no roster</span>` : ''}
        </div>
      </div>`; }).join('') : '<div class="import-card"><div class="ic-sub" style="margin-bottom:0">Nenhuma turma importada ainda — cole a primeira no campo acima.</div></div>'}
    </div>
  `;
}

function tuRenderDrilldown() {
  const t = (tuDados.turmas || []).find(x => x.id === tuTurmaAberta);
  if (!t) { tuTurmaAberta = null; render(); return; }
  const pessoas = tuDados.pessoasPorTurma[t.id] || [];
  const instrutores = pessoas.filter(p => p.papel === 'instrutor');
  const alunos = pessoas.filter(p => p.papel === 'aluno');
  const r = tuResumo(t.id);

  document.getElementById('content').innerHTML = `
    <div class="import-card">
      <button class="btn btn-out" style="font-size:.7rem;padding:5px 10px" onclick="tuTurmaAberta=null;render()">← Todas as turmas</button>
      <div class="ic-title" style="margin-top:8px">Turma ${tuEsc(t.numero)}${t.nome ? ` — ${tuEsc(t.nome)}` : ''}</div>
      <div class="ic-sub">${tuEsc(tuFmtData(t.data_treinamento))}${t.hora_inicio ? ` · ${tuEsc(tuFmtHora(t.hora_inicio))} às ${tuEsc(tuFmtHora(t.hora_fim))}` : ''} · ${tuEsc(t.modalidade || '')}${t.tipo_funcao ? ` · ${tuEsc(t.tipo_funcao)}` : ''}${t.funcao ? ` (${tuEsc(t.funcao)})` : ''}</div>
      <div class="ic-sub">📍 ${tuEsc(t.local_treinamento || '—')}${t.endereco_treinamento ? `<br>${tuEsc(t.endereco_treinamento)}` : ''}</div>
      <div class="ic-sub">🎤 Instrutores: ${instrutores.length ? instrutores.map(i => tuEsc(i.nome)).join(', ') : '—'}</div>
      ${t.instrucoes ? `<div class="ic-sub">📢 ${tuEsc(t.instrucoes)}</div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <button class="btn btn-dark" style="font-size:.7rem;padding:5px 10px" onclick="tuImprimirLista()">🖨️ Lista de presença</button>
      </div>
      <div class="ic-sub" style="margin:8px 0 0">${r.total} aluno(s) · ✅ ${r.presente} · ❌ ${r.ausente} · 📄 ${r.justificado} · ⏳ ${r.pendente}</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px">
      ${alunos.map(p => `
      <div class="import-card" style="padding:10px 14px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
          <div>
            <div style="font-weight:700;font-size:.83rem">${tuEsc(p.nome)}</div>
            <div class="ic-sub" style="margin:2px 0 0">Título ${tuEsc(p.inscricao)}${p.ator_id ? '' : ' · 🔍 não encontrado no roster ativo'}</div>
          </div>
          <span class="import-result ${TU_PRESENCA[p.presenca]?.cls || ''}" style="margin-top:0;white-space:nowrap">${TU_PRESENCA[p.presenca]?.label || p.presenca}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <button class="btn ${p.presenca === 'presente' ? 'btn-dark' : 'btn-out'}" style="font-size:.7rem;padding:5px 10px" onclick="tuMarcarPresenca('${p.id}','presente')">✅ Presente</button>
          <button class="btn ${p.presenca === 'ausente' ? 'btn-dark' : 'btn-out'}" style="font-size:.7rem;padding:5px 10px" onclick="tuMarcarPresenca('${p.id}','ausente')">❌ Faltou</button>
          <button class="btn ${p.presenca === 'justificado' ? 'btn-dark' : 'btn-out'}" style="font-size:.7rem;padding:5px 10px" onclick="tuMarcarPresenca('${p.id}','justificado')">📄 Justificada</button>
          <button class="btn ${p.presenca === 'pendente' ? 'btn-dark' : 'btn-out'}" style="font-size:.7rem;padding:5px 10px" onclick="tuMarcarPresenca('${p.id}','pendente')">⏳ Pendente</button>
          ${p.ator_id ? `<button class="btn btn-out" style="font-size:.7rem;padding:5px 10px" onclick="tuCopiarConvite('${p.id}')" title="Copia um link de WhatsApp com data, hora e local do treinamento">💬 Convite</button>` : ''}
        </div>
      </div>`).join('') || '<div class="import-card"><div class="ic-sub" style="margin-bottom:0">Turma sem alunos importados.</div></div>'}
    </div>
  `;
}
