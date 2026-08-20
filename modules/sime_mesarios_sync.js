// ══════════════════════════════════════
// SINCRONIZAR MESÁRIOS — upload de CSV exportado da planilha "convocação
// mesários" (abas "base geral MRV" / "Base Geral Apoio especializado") direto
// pro Supabase, sem precisar gerar SQL manualmente. Mesmo destino de sempre
// (sime_mesarios_raw → RPC sime_sync_atores_from_raw), só que pelo navegador.
// ══════════════════════════════════════
//
// O cabeçalho das duas abas da planilha é idêntico (confirmado em
// 20/08/2026) — o dump ELO completo do TRE, 81 colunas, com os campos de
// acompanhamento que o Apps Script da planilha (SIME_Sync.gs) já mantém
// (Confirmou convocação/Origem da resposta/Justificativa). tipo_registro não
// é adivinhado: vem direto da própria coluna "Tipo função eleitoral" (a
// exportação do TRE já grava 'MRV' ou 'AL' ali) — mesmo espírito do parser
// Python equivalente, scripts/parse_mesarios_gsheet_csv.py.
//
// IMPORTANTE — o que este upload NÃO faz: sime_sync_atores_from_raw nunca lê
// confirmou_convocacao/origem_resposta/justificativa pra dentro de
// sime_atores. A confirmação "de verdade" do SIME (sime_atores.confirmacao)
// só muda quando a pessoa responde de fato pelo WhatsApp via Hermes
// (api/hermes-mesarios.js). O "Confirmou convocação" da planilha é um
// controle humano paralelo — sobe pro staging por completude/auditoria, mas
// não sobrescreve o status real de confirmação do SIME.

const MS_HEADER_TO_COLUMN = [
  ["Processo Eleitoral", "processo_eleitoral"],
  ["Pleito", "pleito"],
  ["UF de trabalho", "uf_trabalho"],
  ["Zona eleitoral de trabalho", "zona_eleitoral_trabalho"],
  ["Inscrição", "inscricao"],
  ["CPF (eleitor)", "cpf_eleitor"],
  ["CPF (dados mesário)", "cpf_dados_mesario"],
  ["Nome civil", "nome_civil"],
  ["Nome Social", "nome_social"],
  ["Data de nascimento", "data_nascimento"],
  ["Tipo telefone 1 (eleitor)", "tipo_telefone_1_eleitor"],
  ["Telefone 1 (eleitor)", "telefone_1_eleitor"],
  ["Tipo telefone 2 (eleitor)", "tipo_telefone_2_eleitor"],
  ["Telefone 2 (eleitor)", "telefone_2_eleitor"],
  ["Telefone contato (eleitor)", "telefone_contato_eleitor"],
  ["Tipo telefone pessoal (dados mesário)", "tipo_telefone_pessoal_mesario"],
  ["Telefone pessoal (dados mesário)", "telefone_pessoal_mesario"],
  ["Tipo telefone comercial (dados mesário)", "tipo_telefone_comercial_mesario"],
  ["Telefone comercial (dados mesário)", "telefone_comercial_mesario"],
  ["E-mail (eleitor)", "email_eleitor"],
  ["E-mail (dados mesário)", "email_dados_mesario"],
  ["Tipo correspondência", "tipo_correspondencia"],
  ["Grau de instrução (eleitor)", "grau_instrucao_eleitor"],
  ["Grau de instrução (dados mesário)", "grau_instrucao_mesario"],
  ["Ocupação (eleitor)", "ocupacao_eleitor"],
  ["Ocupação (dados mesário)", "ocupacao_mesario"],
  ["Excluído de eleição futura", "excluido_eleicao_futura"],
  ["Data limite exclusão de eleição futura", "data_limite_exclusao_eleicao_futura"],
  ["Observação (dados mesário)", "observacao_dados_mesario"],
  ["Possui carro", "possui_carro"],
  ["Experiência", "experiencia"],
  ["ASE 205", "ase_205"],
  ["UF do endereço do eleitor", "uf_endereco_eleitor"],
  ["Código município do endereço do eleitor", "codigo_municipio_endereco_eleitor"],
  ["Nome município do endereço do eleitor", "nome_municipio_endereco_eleitor"],
  ["Endereço do eleitor", "endereco_eleitor"],
  ["Bairro do eleitor", "bairro_eleitor"],
  ["CEP do eleitor", "cep_eleitor"],
  ["Zona eleitoral do eleitor", "zona_eleitoral_eleitor"],
  ["UF (dados mesário)", "uf_dados_mesario"],
  ["Código município (dados mesário)", "codigo_municipio_dados_mesario"],
  ["Nome município (dados mesário)", "nome_municipio_dados_mesario"],
  ["Endereço (dados mesário)", "endereco_dados_mesario"],
  ["Bairro (dados mesário)", "bairro_dados_mesario"],
  ["CEP (dados mesário)", "cep_dados_mesario"],
  ["UF comercial (dados mesário)", "uf_comercial_mesario"],
  ["Código município comercial (dados mesário)", "codigo_municipio_comercial_mesario"],
  ["Nome município comercial (dados mesário)", "nome_municipio_comercial_mesario"],
  ["Endereço comercial (dados mesário)", "endereco_comercial_mesario"],
  ["Bairro comercial (dados mesário)", "bairro_comercial_mesario"],
  ["CEP comercial (dados mesário)", "cep_comercial_mesario"],
  ["Nome de empresa", "nome_empresa"],
  ["Função na empresa", "funcao_empresa"],
  ["Código município local de trabalho", "codigo_municipio_local_trabalho"],
  ["Nome município local de trabalho", "nome_municipio_local_trabalho"],
  ["Bairro", "bairro_local_trabalho"],
  ["CEP", "cep_local_trabalho"],
  ["Número do Local de votação local de trabalho", "numero_local_votacao_local_trabalho"],
  ["Nome do local de votação local de trabalho", "nome_local_votacao_local_trabalho"],
  ["Descrição local de trabalho", "descricao_local_trabalho"],
  ["Seção local de trabalho", "secao_local_trabalho"],
  ["MRJ local de trabalho", "mrj_local_trabalho"],
  ["UF de votação do eleitor", "uf_votacao_eleitor"],
  ["Código município de votação do eleitor", "codigo_municipio_votacao_eleitor"],
  ["Nome município de votação do eleitor", "nome_municipio_votacao_eleitor"],
  ["Bairro de votação do eleitor", "bairro_votacao_eleitor"],
  ["CEP de votação do eleitor", "cep_votacao_eleitor"],
  ["Número do local de votação do eleitor", "numero_local_votacao_eleitor"],
  ["Nome do local de votação do eleitor", "nome_local_votacao_eleitor"],
  ["Número da seção de votação do eleitor", "numero_secao_votacao_eleitor"],
  ["Tipo função eleitoral", "tipo_funcao_eleitoral"],
  ["Descrição função eleitoral", "descricao_funcao_eleitoral"],
  ["Data atribuição", "data_atribuicao"],
  ["Data convocação", "data_convocacao"],
  ["Data nomeação", "data_nomeacao"],
  ["Data atualização (dados mesário)", "data_atualizacao_mesario"],
  ["Data último RAE", "data_ultimo_rae"],
  ["Confirmou convocação", "confirmou_convocacao"],
  ["Origem da resposta", "origem_resposta"],
  ["Data de resposta", "data_resposta"],
  ["Justificativa", "justificativa"],
];
const MS_DB_COLUMNS = MS_HEADER_TO_COLUMN.map(([, c]) => c);

// Parser CSV RFC4180 (aspas, vírgula/quebra de linha dentro de campo,
// aspas duplicadas escapando aspas) — split(',') simples quebra em qualquer
// endereço com vírgula, que é boa parte dos campos deste dump.
function msParseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] || '').trim() !== '');
}

let msArquivos = [];   // [{ nome, linhas: [{...por header}] }]
let msResultado = null; // { atualizados, inativados } após rodar

function msLimpar() {
  msArquivos = [];
  msResultado = null;
  render();
}

function msHandleFiles(fileList) {
  const arquivos = Array.from(fileList || []).filter(f => f.name.toLowerCase().endsWith('.csv'));
  if (!arquivos.length) { showToast('⚠ Selecione arquivo(s) .csv'); return; }
  let pendentes = arquivos.length;
  arquivos.forEach(file => {
    const r = new FileReader();
    r.onload = (e) => {
      const linhasRaw = msParseCSV(e.target.result);
      if (!linhasRaw.length) { showToast(`⚠ ${file.name}: arquivo vazio`); pendentes--; return; }
      const header = linhasRaw[0];
      const faltando = MS_HEADER_TO_COLUMN.filter(([h]) => !header.includes(h));
      if (faltando.length) {
        showToast(`⚠ ${file.name}: ${faltando.length} coluna(s) esperada(s) não encontrada(s) — não é o formato da planilha de mesários`);
        pendentes--;
        if (pendentes === 0) render();
        return;
      }
      const idx = {};
      header.forEach((h, i) => { idx[h] = i; });
      const linhas = linhasRaw.slice(1).map(cols => {
        const obj = {};
        for (const [h, col] of MS_HEADER_TO_COLUMN) obj[col] = (cols[idx[h]] || '').trim();
        return obj;
      });
      msArquivos.push({ nome: file.name, linhas });
      pendentes--;
      if (pendentes === 0) render();
    };
    r.readAsText(file, 'UTF-8');
  });
}

function msContagemAgregada() {
  const todas = msArquivos.flatMap(a => a.linhas);
  const porTipo = {}, porFuncao = {}, porZona = {};
  for (const l of todas) {
    porTipo[l.tipo_funcao_eleitoral || '(vazio)'] = (porTipo[l.tipo_funcao_eleitoral || '(vazio)'] || 0) + 1;
    porFuncao[l.descricao_funcao_eleitoral || '(vazio)'] = (porFuncao[l.descricao_funcao_eleitoral || '(vazio)'] || 0) + 1;
    porZona[l.zona_eleitoral_trabalho || '(vazio)'] = (porZona[l.zona_eleitoral_trabalho || '(vazio)'] || 0) + 1;
  }
  return { total: todas.length, porTipo, porFuncao, porZona };
}

async function msSincronizar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { showToast('⚠ Conta sem zona associada'); return; }
  const { data: zona } = await sb.from('sime_zonas').select('numero, estado').eq('id', zonaId).maybeSingle();
  if (!zona) { showToast('⚠ Não foi possível resolver a zona'); return; }
  const zonaNumero = String(zona.numero), uf = zona.estado;

  const todasLinhas = msArquivos.flatMap(a => a.linhas)
    .filter(l => l.zona_eleitoral_trabalho === zonaNumero && l.uf_trabalho === uf);
  if (!todasLinhas.length) {
    showToast(`⚠ Nenhuma linha da zona ${zonaNumero}/${uf} nos arquivos carregados`);
    return;
  }

  showToast('⏳ Sincronizando...');

  // Substitui só o staging desta zona/UF — não truncate (a 94ª pode ter
  // dado próprio em paralelo), e é seguro repetir (idempotente).
  const { error: delErr } = await sb.from('sime_mesarios_raw')
    .delete().eq('zona_eleitoral_trabalho', zonaNumero).eq('uf_trabalho', uf);
  if (delErr) { showToast('⚠ ' + delErr.message); return; }

  const linhasParaInserir = todasLinhas.map(l => {
    const row = {};
    for (const c of MS_DB_COLUMNS) row[c] = l[c] || null;
    row.tipo_registro = l.tipo_funcao_eleitoral || null;
    return row;
  });

  const LOTE = 200;
  for (let i = 0; i < linhasParaInserir.length; i += LOTE) {
    const { error: insErr } = await sb.from('sime_mesarios_raw').insert(linhasParaInserir.slice(i, i + LOTE));
    if (insErr) { showToast('⚠ ' + insErr.message); return; }
  }

  const { data: syncResult, error: syncErr } = await sb.rpc('sime_sync_atores_from_raw', {
    p_zona_numero: zona.numero, p_uf: uf,
  });
  if (syncErr) { showToast('⚠ ' + syncErr.message); return; }

  msResultado = (syncResult && syncResult[0]) || { atualizados: 0, inativados: 0 };
  await log('mesarios_sync_csv', '', {
    registros: linhasParaInserir.length, zona: zonaNumero, uf,
    atualizados: msResultado.atualizados, inativados: msResultado.inativados,
  });
  showToast(`✓ ${msResultado.atualizados} atualizados · ${msResultado.inativados} inativados`);

  // Recarrega a lista de atores (mudou o banco) — mesmo padrão de
  // getAtores() cacheado citado em CLAUDE.md: sem isso a aba Lista continua
  // mostrando os dados antigos até recarregar a página.
  if (window.recarregarAtores) await window.recarregarAtores();
  render();
}

function renderSyncMesarios() {
  const c = document.getElementById('content');
  const semSessao = !window.supabaseAtores;
  const agregada = msContagemAgregada();
  c.innerHTML = `
    <div class="import-card">
      <div class="ic-title">🔄 Sincronizar mesários (planilha do TRE)</div>
      <div class="ic-sub">Exporte as abas <b>base geral MRV</b> e/ou <b>Base Geral Apoio especializado</b> da planilha
        (Arquivo → Fazer download → Valores separados por vírgula) e carregue aqui. Atualiza <code>sime_atores</code>
        via a mesma rotina usada nas recargas manuais — preserva confirmação/telefone já registrados no SIME,
        marca <code>ativo=false</code> quem saiu da nova exportação (nunca apaga).</div>
      ${semSessao ? '<div class="import-result ir-warn">Entre com a conta da equipe para sincronizar.</div>' : ''}
      <div class="drop-zone" id="ms-drop-zone" onclick="document.getElementById('ms-csv-input').click()"
           ondragover="event.preventDefault();this.classList.add('drag')"
           ondragleave="this.classList.remove('drag')"
           ondrop="event.preventDefault();this.classList.remove('drag');msHandleFiles(event.dataTransfer.files)">
        <div class="dz-icon">📄</div>
        <div class="dz-txt">Clique ou arraste o(s) CSV(s) aqui</div>
        <div class="dz-sub">Aceita os dois arquivos de uma vez</div>
      </div>
      <input type="file" id="ms-csv-input" accept=".csv" multiple style="display:none" onchange="msHandleFiles(this.files)">
      ${msArquivos.length ? `
        <div class="import-result ir-ok" style="margin-top:10px">
          ${msArquivos.map(a => `📄 ${a.nome} — ${a.linhas.length} linha(s)`).join('<br>')}<br><br>
          <b>${agregada.total}</b> registro(s) no total · por função: ${Object.entries(agregada.porFuncao).map(([k, v]) => `${k}: ${v}`).join(', ')}<br>
          por zona/UF de trabalho no arquivo: ${Object.entries(agregada.porZona).map(([k, v]) => `${k}: ${v}`).join(', ')}
        </div>` : ''}
      ${msResultado ? `<div class="import-result ir-ok" style="margin-top:10px">✅ Sincronizado — <b>${msResultado.atualizados}</b> atualizados · <b>${msResultado.inativados}</b> inativados (saíram da exportação)</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:10px;">
        ${msArquivos.length && !semSessao ? `<button class="btn btn-dark" onclick="msSincronizar()">✓ Sincronizar com o SIME</button>` : ''}
        ${msArquivos.length ? `<button class="btn btn-out" onclick="msLimpar()">✕ Limpar</button>` : ''}
      </div>
    </div>`;
}
