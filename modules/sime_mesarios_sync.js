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
  //
  // MRV e Apoio especializado são DUAS planilhas/abas separadas do TRE — o
  // cartório pode (e costuma) subir só uma de cada vez, ex.: só a MRV
  // atualizada, sem reanexar a Apoio que não mudou nesta rodada. Apagar o
  // staging INTEIRO da zona/UF aqui apagaria junto os registros do OUTRO
  // tipo que não vieram nesta leva — e sime_sync_atores_from_raw, ao não
  // achar mais ninguém daquele tipo no staging, inativaria por engano quem
  // só não fez parte DESTE upload (achado real em 21/08/2026: "sincronizar
  // não deve resetar quem já estava e permaneceu na planilha"). Por isso o
  // delete é escopado só ao(s) tipo_registro ('MRV'/'AL') que efetivamente
  // vieram nos arquivos carregados agora — o staging do outro tipo, gravado
  // numa sincronização anterior, continua intacto e segue valendo.
  const tiposPresentes = [...new Set(todasLinhas.map(l => l.tipo_funcao_eleitoral).filter(Boolean))];
  const { error: delErr } = await sb.from('sime_mesarios_raw')
    .delete().eq('zona_eleitoral_trabalho', zonaNumero).eq('uf_trabalho', uf).in('tipo_registro', tiposPresentes);
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

// ══════════════════════════════════════
// ATUALIZAR CONTATOS — segundo formato, arquivo separado do roster acima.
// 16 colunas (Zona/Seção/Nome/Inscrição/Situação/Localidade/Nº Local/Nome
// Local/Cód. Objeto Local/Nº Função Eleitoral/Função Eleitoral/Data
// Atualização/Ciente/whatsapp/celular/telefone2) — export mais simples do
// TRE, sem os campos de acompanhamento do dump ELO completo.
//
// Por que é uma tela separada, não outra aba do drop-zone acima: esse
// arquivo normalmente é um RECORTE (ex.: só quem respondeu "não sou essa
// pessoa"), não o roster completo da zona. Passá-lo pelo mesmo pipeline de
// sime_mesarios_raw + sime_sync_atores_from_raw inativaria por engano todo
// mundo que não está nesse recorte — sime_sync_atores_from_raw trata
// "ausente do arquivo" como "saiu". Por isso aqui é UPDATE direto em
// sime_atores, casando por inscricao_eleitoral, só em quem está no arquivo.
//
// Ciente (confirmado empiricamente em 20/08/2026 cruzando 3 arquivos reais
// da zona — 0/1/2 nunca documentado formalmente pelo TRE): 0=sem contato,
// 1=confirmou convocação, 2=informou não ser a pessoa procurada.
//
// Decisão de 20/08/2026: diferente do roster de 81 colunas (que nunca toca
// confirmacao — só WhatsApp/Hermes muda isso), este arquivo é
// explicitamente sobre status de contato, então ESCREVE em
// sime_atores.confirmacao (Ciente=1→confirmado, Ciente=2→contato_incorreto)
// e em telefone_whatsapp — exceção deliberada à regra geral, não descuido.
const MC_HEADERS = [
  'Zona', 'Seção', 'Nome', 'Inscrição', 'Situação', 'Localidade', 'Nº Local',
  'Nome Local', 'Cód. Objeto Local', 'Nº Função Eleitoral', 'Função Eleitoral',
  'Data Atualização', 'Ciente', 'whatsapp', 'celular', 'telefone2',
];

let mcArquivo = null;   // { nome, linhas:[{...}] }
let mcResultado = null; // { atualizados, semMatch, total, porCiente }

function mcSoDigitos(s) { return String(s || '').replace(/\D/g, ''); }

function mcLimpar() { mcArquivo = null; mcResultado = null; render(); }

function mcHandleFile(fileList) {
  const file = (fileList || [])[0];
  if (!file || !file.name.toLowerCase().endsWith('.csv')) { showToast('⚠ Selecione um arquivo .csv'); return; }
  const r = new FileReader();
  r.onload = (e) => {
    const linhasRaw = msParseCSV(e.target.result);
    if (!linhasRaw.length) { showToast(`⚠ ${file.name}: arquivo vazio`); return; }
    const header = linhasRaw[0];
    const faltando = MC_HEADERS.filter((h) => !header.includes(h));
    if (faltando.length) {
      showToast(`⚠ ${file.name}: ${faltando.length} coluna(s) esperada(s) não encontrada(s) — não é o formato de atualização de contatos`);
      return;
    }
    const idx = {};
    header.forEach((h, i) => { idx[h] = i; });
    const linhas = linhasRaw.slice(1).map((cols) => ({
      inscricao: (cols[idx['Inscrição']] || '').trim(),
      ciente: (cols[idx['Ciente']] || '').trim(),
      whatsapp: (cols[idx['whatsapp']] || '').trim(),
      celular: (cols[idx['celular']] || '').trim(),
      telefone2: (cols[idx['telefone2']] || '').trim(),
    }));
    mcArquivo = { nome: file.name, linhas };
    mcResultado = null;
    render();
  };
  r.readAsText(file, 'UTF-8');
}

async function mcAtualizar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { showToast('⚠ Conta sem zona associada'); return; }
  if (!mcArquivo || !mcArquivo.linhas.length) { showToast('⚠ Nenhum registro carregado'); return; }

  showToast('⏳ Atualizando contatos...');
  let atualizados = 0, semMatch = 0;
  const porCiente = {};
  for (const l of mcArquivo.linhas) {
    if (l.ciente) porCiente[l.ciente] = (porCiente[l.ciente] || 0) + 1;
    if (!l.inscricao) continue;
    const patch = {};
    // Normaliza pro padrão "55"+DDD+8/9 (21/08/2026) — antes gravava os
    // dígitos crus do arquivo, sem "55" e sem o dígito 9 de celular antigo,
    // fora do padrão que o resto do sistema assume em telefone_whatsapp.
    const telBruto = [l.whatsapp, l.celular, l.telefone2].find(v => mcSoDigitos(v));
    if (telBruto) patch.telefone_whatsapp = normalizarTelefoneWhatsapp(telBruto);
    if (l.ciente === '1') patch.confirmacao = 'confirmado';
    else if (l.ciente === '2') patch.confirmacao = 'contato_incorreto';
    if (!Object.keys(patch).length) continue;

    const { data, error } = await sb.from('sime_atores').update(patch)
      .eq('zona_id', zonaId).eq('inscricao_eleitoral', l.inscricao).select('id');
    if (error) { showToast('⚠ ' + error.message); return; }
    if (data && data.length) atualizados += data.length; else semMatch++;
  }

  mcResultado = { atualizados, semMatch, total: mcArquivo.linhas.length, porCiente };
  await log('mesarios_atualizar_contatos', '', mcResultado);
  showToast(`✓ ${atualizados} contato(s) atualizado(s)${semMatch ? ` · ${semMatch} sem cadastro correspondente` : ''}`);
  if (window.recarregarAtores) await window.recarregarAtores();
  render();
}

// ══════════════════════════════════════
// COLAR LISTA — terceiro caminho, pro caso mais comum na prática: o cartório
// tem uma lista solta (WhatsApp, anotação, planilha copiada) com nome/título/
// telefone, sem ser nenhum dos dois formatos oficiais do TRE acima. Em vez de
// forçar reformatar num CSV de 16 colunas só pra atualizar telefone de um
// punhado de gente, cola o texto direto aqui — qualquer coisa, uma linha por
// pessoa.
//
// Só aceita o que dá pra reconhecer com confiança: título de eleitor (12
// dígitos, tolera espaço entre blocos — "0351 4315 1503") e telefone que já
// bate limpo num formato válido. NÃO tenta consertar contagem de dígito
// errada — achado real numa lista real: alguns telefones vinham com um
// dígito a mais depois do 55 (provável artefato de cópia/formatação de
// planilha), outros sem DDD nenhum. Adivinhar aqui é pior que não gravar:
// linha que não bate em nada fica de fora do resultado, listada pra
// conferência manual, nunca vira um telefone errado no cadastro de alguém.
function cpSoDigitos(s) { return String(s || '').replace(/\D/g, ''); }
function cpEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 10-11 dígitos (DDD+8/9) é reconhecido direto; com "55" na frente (12-13)
// também; sem DDD (8-9 dígitos soltos) assume 86 — as duas zonas do SIME
// são no Piauí, que tem DDD único pro estado inteiro; não serviria um
// sistema genérico multi-estado, mas é seguro pro escopo deste app.
// Fora desses tamanhos (ex.: 14 dígitos, artefato de cópia de planilha) fica
// de fora — aqui o risco de aceitar errado é maior que o de descartar
// (candidato vem de texto livre, pode ser confundido com outro número da
// linha), diferente de mcAtualizar()/msSincronizar(), que sempre têm campo
// dedicado pro telefone.
//
// Mesmo gate de tamanho de sempre, só que agora delega o formato final pra
// normalizarTelefoneWhatsapp() (21/08/2026) — antes devolvia os dígitos sem
// o "55" e sem o dígito 9 de celular antigo, fora do padrão que o resto do
// sistema assume em telefone_whatsapp.
function cpNormalizarTelefone(digitos) {
  const len = digitos.length;
  const aceito = len === 8 || len === 9 || len === 10 || len === 11
    || ((len === 12 || len === 13) && digitos.startsWith('55'));
  return aceito ? normalizarTelefoneWhatsapp(digitos) : null;
}

let cpTexto = '';
let cpResultado = null; // { linhas:[{linha,titulo,telefone,motivo}], atualizados, semMatch }

function cpLimpar() { cpTexto = ''; cpResultado = null; render(); }

function cpProcessarLinhas(texto) {
  return texto.split('\n').map(l => l.trim()).filter(Boolean).map(linha => {
    const mTitulo = linha.match(/\b(\d{4}\s?\d{4}\s?\d{4})\b/);
    if (!mTitulo) return { linha, titulo: null, telefone: null, motivo: 'sem_titulo' };
    const titulo = cpSoDigitos(mTitulo[1]);
    const semTitulo = linha.replace(mTitulo[1], ' ');
    const candidatos = semTitulo.split(/[\t,;]+/).map(s => s.trim()).filter(Boolean);
    let telefone = null;
    for (const c of candidatos) {
      const d = cpSoDigitos(c);
      if (d.length < 8) continue;
      const norm = cpNormalizarTelefone(d);
      if (norm) { telefone = norm; break; }
    }
    return telefone
      ? { linha, titulo, telefone, motivo: null }
      : { linha, titulo, telefone: null, motivo: 'telefone_nao_reconhecido' };
  });
}

async function cpAtualizar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { showToast('⚠ Conta sem zona associada'); return; }
  const linhas = cpProcessarLinhas(cpTexto);
  const validas = linhas.filter(l => l.telefone);
  if (!validas.length) {
    showToast('⚠ Nenhuma linha com título + telefone reconhecidos');
    cpResultado = { linhas, atualizados: 0, semMatch: 0 };
    render();
    return;
  }

  showToast('⏳ Atualizando telefones...');
  let atualizados = 0, semMatch = 0;
  for (const l of validas) {
    const { data, error } = await sb.from('sime_atores').update({ telefone_whatsapp: l.telefone })
      .eq('zona_id', zonaId).eq('inscricao_eleitoral', l.titulo).select('id');
    if (error) { showToast('⚠ ' + error.message); return; }
    if (data && data.length) atualizados++; else semMatch++;
  }
  cpResultado = { linhas, atualizados, semMatch };
  await log('mesarios_colar_telefones', '', { total: linhas.length, reconhecidas: validas.length, atualizados, semMatch });
  showToast(`✓ ${atualizados} telefone(s) atualizado(s)${semMatch ? ` · ${semMatch} sem cadastro correspondente` : ''}`);
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
    </div>

    <div class="import-card">
      <div class="ic-title">📞 Atualizar contatos (Ciente)</div>
      <div class="ic-sub">Arquivo separado, formato mais simples (16 colunas, com a coluna <code>Ciente</code>) — geralmente um
        recorte (ex.: só quem respondeu "não sou essa pessoa"), não o roster inteiro. Atualiza telefone e status de
        <b>quem está no arquivo</b>, casando por Inscrição — nunca inativa ninguém, mesmo quem não aparece aqui.
        <code>Ciente=1</code> vira confirmado, <code>Ciente=2</code> vira contato incorreto.</div>
      ${semSessao ? '<div class="import-result ir-warn">Entre com a conta da equipe para atualizar.</div>' : ''}
      <div class="drop-zone" id="mc-drop-zone" onclick="document.getElementById('mc-csv-input').click()"
           ondragover="event.preventDefault();this.classList.add('drag')"
           ondragleave="this.classList.remove('drag')"
           ondrop="event.preventDefault();this.classList.remove('drag');mcHandleFile(event.dataTransfer.files)">
        <div class="dz-icon">📞</div>
        <div class="dz-txt">Clique ou arraste o CSV de contatos aqui</div>
        <div class="dz-sub">Um arquivo por vez</div>
      </div>
      <input type="file" id="mc-csv-input" accept=".csv" style="display:none" onchange="mcHandleFile(this.files)">
      ${mcArquivo ? `
        <div class="import-result ir-ok" style="margin-top:10px">
          📄 ${mcArquivo.nome} — ${mcArquivo.linhas.length} linha(s)
        </div>` : ''}
      ${mcResultado ? `<div class="import-result ir-ok" style="margin-top:10px">✅ ${mcResultado.atualizados} atualizado(s)${mcResultado.semMatch ? ` · ${mcResultado.semMatch} sem cadastro correspondente` : ''} de ${mcResultado.total} no arquivo</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:10px;">
        ${mcArquivo && !semSessao ? `<button class="btn btn-dark" onclick="mcAtualizar()">✓ Atualizar contatos</button>` : ''}
        ${mcArquivo ? `<button class="btn btn-out" onclick="mcLimpar()">✕ Limpar</button>` : ''}
      </div>
    </div>

    <div class="import-card">
      <div class="ic-title">📋 Colar lista de telefones</div>
      <div class="ic-sub">Cole um texto qualquer com <b>título de eleitor</b> e <b>telefone</b> por linha — não
        precisa ser CSV nem seguir formato fixo (nome e outras colunas, se tiver, são ignorados). Só atualiza
        <code>telefone_whatsapp</code>, casando por título de eleitor; nunca mexe em confirmação nem inativa
        ninguém. Linha sem título reconhecível (12 dígitos) ou sem telefone num formato válido fica de fora —
        listada abaixo pra conferir à mão, em vez de arriscar gravar número errado.</div>
      ${semSessao ? '<div class="import-result ir-warn">Entre com a conta da equipe para atualizar.</div>' : ''}
      <textarea id="cp-textarea" rows="8" placeholder="Cole aqui, uma pessoa por linha..." oninput="cpTexto=this.value"
        style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);font-size:.8rem;color:var(--text);font-family:inherit;resize:vertical">${cpEsc(cpTexto)}</textarea>
      <div style="display:flex;gap:8px;margin-top:10px;">
        ${!semSessao ? `<button class="btn btn-dark" onclick="cpTexto=document.getElementById('cp-textarea').value;cpAtualizar()">✓ Processar e atualizar</button>` : ''}
        ${cpTexto || cpResultado ? `<button class="btn btn-out" onclick="cpLimpar()">✕ Limpar</button>` : ''}
      </div>
      ${cpResultado ? `
        <div class="import-result ir-ok" style="margin-top:10px">✅ ${cpResultado.atualizados} telefone(s) atualizado(s)${cpResultado.semMatch ? ` · ${cpResultado.semMatch} sem cadastro correspondente` : ''} de ${cpResultado.linhas.length} linha(s) coladas</div>
        ${cpResultado.linhas.some(l => l.motivo) ? `
        <div class="import-result ir-warn" style="margin-top:8px">
          ${cpResultado.linhas.filter(l => l.motivo).length} linha(s) ignorada(s) — confira à mão:<br>
          ${cpResultado.linhas.filter(l => l.motivo).map(l => `• ${cpEsc(l.linha.slice(0, 70))} — ${l.motivo === 'sem_titulo' ? 'título de eleitor não reconhecido' : 'telefone não reconhecido'}`).join('<br>')}
        </div>` : ''}` : ''}
    </div>`;
}
