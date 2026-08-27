// ══════════════════════════════════════
// CORRESPONDÊNCIA — etiqueta de envelope + modelo de AR (Aviso de
// Recebimento) pra mesários com meio_contato='carta_registrada'. Pedido
// direto (27/08/2026): "marcou para receber por carta, imprime uma etiqueta
// com os dados do destinatario e do remetente e imprime o ar".
//
// Layout alinhado ao "Enderecador de Encomendas" público dos Correios
// (www2.correios.com.br/enderecador/encomendas — ferramenta gratuita, sem
// contrato SIGEP), a partir de dois modelos reais que o dono do projeto
// enviou (27/08/2026) gerados por lá com um destinatário real da 7ª Zona.
// Reproduz a ESTRUTURA e os campos desses modelos (texto puro, sem a marca/
// logo dos Correios) — não é uma integração com a ferramenta deles, é um
// layout compatível gerado pelo próprio SIME, pra ser reconhecido por
// qualquer agência/carteiro.
//
// Duas limitações de arquitetura, já documentadas alhures e confirmadas com
// o dono do projeto antes de construir isto:
// - Não existe integração com a API paga dos Correios (SIGEP, rastreamento
//   automático) — incompatível com o custo R$ 0,00/mês do projeto. Isso é
//   diferente do Enderecador (gratuito, só gera o formulário) — o campo do
//   código de barras/nº de registro do objeto fica sempre em branco pra
//   colar a etiqueta física que a AGÊNCIA gera na hora da postagem, tanto na
//   etiqueta quanto no AR (decisão deliberada, 27/08/2026 — nunca inventar
//   um código que o SIME não tem como saber).
// - sime_atores não guarda endereço (decisão antiga, documentada no
//   CLAUDE.md: "Carta/Oficial de Justiça usam o endereço já no processo do
//   TRE"). O endereço do destinatário vem de sime_mesarios_raw (staging da
//   planilha do TRE), casando por título de eleitor — mesma junção que
//   SIME_relatorio_elo.js já faz.
// ══════════════════════════════════════

let coDados = null; // { pessoas:[...], zona:{...} }
let coSelecionados = new Set();

// sime_mesarios_raw traz endereço em TRÊS blocos possíveis por pessoa:
// "dados do mesário" (endereco_dados_mesario/...), do cadastro de eleitor
// (endereco_eleitor/...) e comercial (endereco_comercial_mesario/...).
// Checado direto na produção da 7ª Zona em 27/08/2026 antes de decidir a
// prioridade: dados_mesario só vem preenchido em 25 de 735 registros (3%),
// comercial em 1; endereco_eleitor vem preenchido em TODOS os 735 (100%).
// Por isso o endereço do ELEITOR é o fallback confiável, não o padrão —
// COALESCE prioriza "dados do mesário" quando existe (mais provável de
// estar atualizado, é o que a própria pessoa informou ao ser convocada),
// caindo pro cadastro de eleitor (sempre presente) e só por último o
// comercial. Nunca inventa endereço: pessoa sem nenhum dos três fica de
// fora da impressão em massa, listada à parte pra conferência manual —
// mesmo critério "não adivinha" usado em todo o resto do sistema.
function coEnderecoDestinatario(raw) {
  if (!raw) return null;
  const blocos = [
    { fonte: 'Dados do mesário (TRE)', endereco: raw.endereco_dados_mesario, bairro: raw.bairro_dados_mesario, cep: raw.cep_dados_mesario, municipio: raw.nome_municipio_dados_mesario, uf: raw.uf_dados_mesario },
    { fonte: 'Cadastro de eleitor (TRE)', endereco: raw.endereco_eleitor, bairro: raw.bairro_eleitor, cep: raw.cep_eleitor, municipio: raw.nome_municipio_endereco_eleitor, uf: raw.uf_endereco_eleitor },
    { fonte: 'Endereço comercial (TRE)', endereco: raw.endereco_comercial_mesario, bairro: raw.bairro_comercial_mesario, cep: raw.cep_comercial_mesario, municipio: raw.nome_municipio_comercial_mesario, uf: raw.uf_comercial_mesario },
  ];
  return blocos.find(b => (b.endereco || '').trim()) || null;
}

function coFmtCep(cep) {
  const d = String(cep || '').replace(/\D/g, '');
  return d.length === 8 ? d.replace(/(\d{5})(\d{3})/, '$1-$2') : (cep || '—');
}

async function coCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { coDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: pessoas, error: e1 }, { data: zona, error: e2 }, { data: secoes }] = await Promise.all([
    sb.from('sime_atores')
      .select('id, nome_completo, funcao, funcao_mesa, secao_id, inscricao_eleitoral, codigo_rastreio, status_contato_alternativo')
      .eq('zona_id', zonaId).eq('ativo', true).eq('meio_contato', 'carta_registrada')
      .in('funcao', ['mesario', 'coord_acessibilidade', 'auxiliar_eleicao']).order('nome_completo'),
    sb.from('sime_zonas').select('id, numero, municipio, remetente_nome, remetente_endereco, remetente_bairro, remetente_cep, remetente_municipio, remetente_uf').eq('id', zonaId).maybeSingle(),
    sb.from('sime_secoes').select('id, numero, local_nome, municipio').eq('zona_id', zonaId),
  ]);
  if (e1 || e2) { coDados = { erro: (e1 || e2).message }; render(); return; }

  const titulos = [...new Set((pessoas || []).map(p => p.inscricao_eleitoral).filter(Boolean))];
  // Mesmo cuidado de sime_relatorio_elo.js: sime_atores.inscricao_eleitoral
  // vem normalizado (12 dígitos), sime_mesarios_raw.inscricao pode ou não
  // ter o zero à esquerda — busca pelas duas formas.
  const titulosBusca = [...new Set(titulos.flatMap(t => [t, t.replace(/^0+/, '') || t]))];
  const { data: raw } = titulosBusca.length
    ? await sb.from('sime_mesarios_raw').select('inscricao, endereco_dados_mesario, bairro_dados_mesario, cep_dados_mesario, nome_municipio_dados_mesario, uf_dados_mesario, endereco_eleitor, bairro_eleitor, cep_eleitor, nome_municipio_endereco_eleitor, uf_endereco_eleitor, endereco_comercial_mesario, bairro_comercial_mesario, cep_comercial_mesario, nome_municipio_comercial_mesario, uf_comercial_mesario').in('inscricao', titulosBusca)
    : { data: [] };

  const rawPorTitulo = {};
  for (const r of raw || []) {
    const chave = normalizarTituloEleitor(r.inscricao);
    if (!rawPorTitulo[chave]) rawPorTitulo[chave] = r;
  }
  const secoesPorId = Object.fromEntries((secoes || []).map(s => [s.id, s]));

  for (const p of pessoas || []) {
    const r = p.inscricao_eleitoral ? rawPorTitulo[p.inscricao_eleitoral] : null;
    p.endereco = coEnderecoDestinatario(r);
    p.sec = p.secao_id ? secoesPorId[p.secao_id] : null;
  }

  coDados = { pessoas: pessoas || [], zona: zona || {} };
  render();
}

function coRotuloFuncao(p) {
  if (p.funcao === 'mesario') return p.funcao_mesa || 'Mesário(a)';
  return CM_FUNCAO_LABEL[p.funcao] || p.funcao || '—';
}

function coEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function coToggleSelecionado(id) {
  if (coSelecionados.has(id)) coSelecionados.delete(id); else coSelecionados.add(id);
  render();
}

async function coSalvarRemetente() {
  const sb = window.supabaseAtores;
  const patch = {
    remetente_nome: document.getElementById('co-rem-nome').value.trim() || null,
    remetente_endereco: document.getElementById('co-rem-endereco').value.trim() || null,
    remetente_bairro: document.getElementById('co-rem-bairro').value.trim() || null,
    remetente_cep: document.getElementById('co-rem-cep').value.trim() || null,
    remetente_municipio: document.getElementById('co-rem-municipio').value.trim() || null,
    remetente_uf: document.getElementById('co-rem-uf').value.trim() || null,
  };
  try {
    const { error } = await sb.from('sime_zonas').update(patch).eq('id', coDados.zona.id);
    if (error) throw error;
    coDados.zona = { ...coDados.zona, ...patch };
    showToast('✓ Remetente salvo');
    const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
    await log('correspondencia_remetente_salvo', '', { autor, ...patch });
    render();
  } catch (e) {
    showToast('⚠ Falha ao salvar — verifique a conexão e tente de novo');
  }
}

function coRemetenteCompleto(zona) {
  return !!(zona?.remetente_nome && zona?.remetente_endereco && zona?.remetente_cep && zona?.remetente_municipio && zona?.remetente_uf);
}

// ── IMPRESSÃO — etiqueta e AR são escritos em #print-area (fora do fluxo
// normal da SPA, ver SIME_convocacao.html) e só ficam visíveis via CSS de
// @media print — assim não depende de popup (bloqueado por padrão em muitos
// navegadores) nem de gerar um arquivo à parte.
//
// co-linha-remetente/co-linha-destinatario: mesmo formato de 3 linhas nos
// dois modelos oficiais (nome/endereço — bairro — CEP+município/UF), então
// as duas peças (etiqueta e AR) reaproveitam o mesmo par de funções.
function coLinhasRemetente(zona) {
  return `${coEsc(zona.remetente_nome || '—')}<br>
    ${coEsc(zona.remetente_endereco || '—')}<br>
    ${zona.remetente_bairro ? coEsc(zona.remetente_bairro) + '<br>' : ''}
    ${coFmtCep(zona.remetente_cep)} - ${coEsc((zona.remetente_municipio || '—').toUpperCase())} - ${coEsc(zona.remetente_uf || '—')}`;
}

function coLinhasDestinatario(p) {
  const e = p.endereco;
  if (!e) return `${coEsc(p.nome_completo)}<br>⚠ Sem endereço disponível no ELO`;
  return `${coEsc(p.nome_completo)}<br>
    ${coEsc(e.endereco)}<br>
    ${e.bairro ? coEsc(e.bairro) + '<br>' : ''}
    ${coFmtCep(e.cep)} - ${coEsc((e.municipio || '—').toUpperCase())} - ${coEsc(e.uf || '—')}`;
}

// Etiqueta — mesma estrutura do modelo público dos Correios (Enderecador de
// Encomendas): área reservada da agência no topo, recebedor/assinatura
// embutidos na própria etiqueta (backup pra quando não se gera um AR à
// parte), toggle de entrega no vizinho (sempre "não autorizada" — o SIME não
// oferece opção de autorizar, convocação é documento pra a própria pessoa),
// bloco DESTINATÁRIO com espaço reservado pra colar a etiqueta de rastreio
// da agência (nunca um código inventado) e observação fixa "Carta de
// convocação", remetente por fora do quadro, igual ao modelo.
function coHtmlEtiqueta(p, zona) {
  return `
    <div class="co-pagina-etiqueta">
      <div class="co-et-topo">
        <div class="co-et-topo-tit">USO EXCLUSIVO DOS CORREIOS</div>
        <div>Cole aqui a etiqueta com o código identificador da encomenda</div>
      </div>
      <div class="co-etiqueta">
        <div class="co-et-recebedor">
          Recebedor: <span class="co-linha co-linha-lg"></span><br>
          Assinatura: <span class="co-linha"></span> Documento: <span class="co-linha"></span>
        </div>
        <div class="co-et-barra">ENTREGA NO VIZINHO AUTORIZADA?</div>
        <div class="co-et-vizinho">Entrega no vizinho não autorizada</div>
        <div class="co-et-barra">DESTINATÁRIO</div>
        <div class="co-et-corpo">
          <div class="co-et-dest">${coLinhasDestinatario(p)}</div>
          <div class="co-et-lateral">
            <div class="co-et-codigo">Cole aqui a etiqueta de rastreio gerada pela agência no ato da postagem</div>
            <div class="co-et-obs"><b>Observação:</b><br>Carta de convocação</div>
          </div>
        </div>
      </div>
      <div class="co-et-remetente"><b>Remetente:</b> ${coLinhasRemetente(zona)}</div>
    </div>`;
}

// AR — mesma estrutura do modelo público (Aviso de Recebimento), como
// tabela porque é literalmente um formulário de grade: cabeçalho com "AR" +
// data de postagem, destinatário + unidade de postagem, espaço reservado do
// código do objeto (mesmo critério "nunca inventa" da etiqueta) + carimbo da
// unidade de entrega, endereço de devolução (o remetente), tentativas de
// entrega + observação + motivo de devolução (9 códigos oficiais) + rubrica
// do carteiro, e por fim assinatura/nome/documento de quem recebeu. Sem a
// marca dos Correios (só a estrutura de campos é reproduzida, não o logo) —
// ver nota de rodapé.
function coHtmlAr(p, zona) {
  const funcaoSecao = coEsc(coRotuloFuncao(p)) + (p.sec ? ` — Seção ${coEsc(p.sec.numero)}, ${coEsc(p.sec.local_nome || '')}` : '');
  return `
    <div class="co-pagina-ar">
      <table class="co-ar-tabela">
        <tr>
          <td class="co-ar-titulo">AVISO DE RECEBIMENTO <span class="co-ar-sigla">AR</span></td>
          <td class="co-ar-campo">DATA DE POSTAGEM</td>
        </tr>
        <tr>
          <td>
            <div class="co-ar-rotulo">DESTINATÁRIO</div>
            ${coLinhasDestinatario(p)}
            <div class="co-ar-nota">${funcaoSecao}</div>
          </td>
          <td class="co-ar-campo">UNIDADE DE POSTAGEM</td>
        </tr>
        <tr>
          <td class="co-ar-codigo">(cole aqui a etiqueta de rastreio ou anote o nº de registro do objeto)</td>
          <td class="co-ar-campo">CARIMBO<br>UNIDADE DE ENTREGA</td>
        </tr>
        <tr>
          <td colspan="2">
            <div class="co-ar-rotulo">ENDEREÇO PARA DEVOLUÇÃO DO AR</div>
            ${coLinhasRemetente(zona)}
          </td>
        </tr>
        <tr>
          <td class="co-ar-tentativas">
            <b>TENTATIVAS DE ENTREGA</b><br><br>
            1ª ___ / ___ / ______&nbsp;&nbsp;___:___h<br><br>
            2ª ___ / ___ / ______&nbsp;&nbsp;___:___h<br><br>
            3ª ___ / ___ / ______&nbsp;&nbsp;___:___h
          </td>
          <td>
            <b>OBSERVAÇÃO</b><br>Carta de convocação<br><br>
            <b>MOTIVO DE DEVOLUÇÃO</b>
            <div class="co-ar-motivos">
              <div>1&nbsp;Mudou-se</div><div>5&nbsp;Recusado</div>
              <div>2&nbsp;Endereço insuficiente</div><div>6&nbsp;Não procurado</div>
              <div>3&nbsp;Não existe o número</div><div>7&nbsp;Ausente</div>
              <div>4&nbsp;Desconhecido</div><div>8&nbsp;Falecido</div>
              <div>9&nbsp;Outros</div><div></div>
            </div>
            <div class="co-ar-nota">RUBRICA E MATRÍCULA DO CARTEIRO: ___________________________</div>
          </td>
        </tr>
        <tr>
          <td class="co-ar-campo">ASSINATURA DO RECEBEDOR</td>
          <td class="co-ar-campo">DATA DE ENTREGA</td>
        </tr>
        <tr>
          <td class="co-ar-campo">NOME LEGÍVEL DO RECEBEDOR</td>
          <td class="co-ar-campo">Nº DOC. DE IDENTIDADE</td>
        </tr>
      </table>
      <div class="co-ar-rodape">Modelo gerado pelo SIME, sem integração com rastreamento dos Correios (sem contrato SIGEP) — o código do objeto é o que a agência emite na postagem.</div>
    </div>`;
}

async function coImprimir(ids, tipo) {
  // 27/08/2026: botão ficava com `disabled` quando faltava campo do
  // remetente — clique num botão disabled não faz NADA, sem toast nem
  // aviso, e é fácil achar que preencheu tudo (o placeholder do nome do
  // cartório e da UF mostra um valor plausível igual ao real, dá pra
  // confundir com valor já salvo). Motivo real reportado: "clicar em
  // etiqueta ou ar não fez nada". Agora o botão nunca fica disabled — ele
  // sempre roda esta função, que avisa explicitamente o que falta.
  if (!coRemetenteCompleto(coDados.zona)) {
    showToast('⚠ Preencha nome do cartório, endereço, CEP, município e UF do remetente antes de imprimir');
    return;
  }
  const pessoas = coDados.pessoas.filter(p => ids.includes(p.id));
  const zona = coDados.zona;
  const area = document.getElementById('print-area');
  area.innerHTML = pessoas.map(p => tipo === 'etiqueta' ? coHtmlEtiqueta(p, zona) : coHtmlAr(p, zona)).join('');
  const autor = window.nomeDoUsuario ? await window.nomeDoUsuario() : 'Cartório';
  await log(tipo === 'etiqueta' ? 'correspondencia_etiqueta_impressa' : 'correspondencia_ar_impresso', '', { autor, quantidade: pessoas.length, atores: pessoas.map(p => p.id) });
  window.print();
}

function renderCorrespondencia() {
  const c = document.getElementById('content');
  if (!window.supabaseAtores) {
    c.innerHTML = '<div class="import-card"><div class="import-result ir-warn">Entre com a conta da equipe.</div></div>';
    return;
  }
  if (!coDados) {
    c.innerHTML = '<div class="import-card"><div class="ic-title">📬 Correspondência</div><div class="ic-sub">Carregando…</div></div>';
    coCarregar();
    return;
  }
  if (coDados.erro) {
    c.innerHTML = `<div class="import-card"><div class="import-result ir-warn">⚠ ${coEsc(coDados.erro)}</div></div>`;
    return;
  }

  const zona = coDados.zona;
  const comEndereco = coDados.pessoas.filter(p => p.endereco);
  const semEndereco = coDados.pessoas.filter(p => !p.endereco);
  const remCompleto = coRemetenteCompleto(zona);
  const selecionaveis = comEndereco.filter(p => coSelecionados.has(p.id));

  c.innerHTML = `
    <div class="import-card">
      <div class="ic-title">📬 Correspondência — etiqueta e AR pra convocação por carta</div>
      <div class="ic-sub">Pra quem está marcado com meio de contato "Carta Registrada" (aba 📞 Contatar mesários). O endereço do
        destinatário vem da planilha do TRE (dados do mesário → cadastro de eleitor → comercial, o que existir primeiro nessa
        ordem); a carta de convocação em si continua sendo impressa pelo ELO — aqui é só etiqueta de envio e o modelo de AR.</div>
      ${!remCompleto ? '<div class="import-result ir-warn">⚠️ Preencha o remetente abaixo antes de imprimir — ele entra em toda etiqueta e AR.</div>' : ''}
    </div>

    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">🏢 Remetente (cartório desta zona)</div>
      <div class="ic-sub">Usado em toda etiqueta e AR gerados. Editável por qualquer um da equipe — mesmo padrão do resto desta tela.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group" style="grid-column:1/-1"><label>Nome do cartório</label><input id="co-rem-nome" value="${coEsc(zona.remetente_nome || '')}" placeholder="Cartório da 7ª Zona Eleitoral"></div>
        <div class="form-group" style="grid-column:1/-1"><label>Endereço</label><input id="co-rem-endereco" value="${coEsc(zona.remetente_endereco || '')}" placeholder="Rua, número"></div>
        <div class="form-group"><label>Bairro</label><input id="co-rem-bairro" value="${coEsc(zona.remetente_bairro || '')}"></div>
        <div class="form-group"><label>CEP</label><input id="co-rem-cep" value="${coEsc(zona.remetente_cep || '')}" placeholder="00000-000"></div>
        <div class="form-group"><label>Município</label><input id="co-rem-municipio" value="${coEsc(zona.remetente_municipio || '')}"></div>
        <div class="form-group"><label>UF</label><input id="co-rem-uf" value="${coEsc(zona.remetente_uf || '')}" maxlength="2" placeholder="PI"></div>
      </div>
      <button class="btn btn-dark" style="margin-top:10px" onclick="coSalvarRemetente()">💾 Salvar remetente</button>
    </div>

    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">✉️ Destinatários (${coDados.pessoas.length})</div>
      ${semEndereco.length ? `<div class="import-result ir-warn">⚠️ ${semEndereco.length} sem endereço disponível no ELO — listados à parte abaixo, fora da seleção.</div>` : ''}
      ${comEndereco.length ? `
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <button class="btn btn-out" onclick="coSelecionados=new Set(coDados.pessoas.filter(p=>p.endereco).map(p=>p.id));render()">Selecionar todos</button>
        <button class="btn btn-out" onclick="coSelecionados=new Set();render()">Limpar seleção</button>
        <button class="btn btn-dark" ${!selecionaveis.length ? 'disabled' : ''} onclick="coImprimir([...coSelecionados],'etiqueta')">🏷️ Imprimir etiquetas selecionadas (${selecionaveis.length})</button>
      </div>
      <div class="cm-lista-pessoas" style="display:flex;flex-direction:column;gap:8px">
        ${comEndereco.map(p => `
          <div data-ator-id="${p.id}" style="display:flex;align-items:flex-start;gap:10px;padding:10px;border:1px solid var(--border2);border-radius:8px">
            <input type="checkbox" style="width:20px;height:20px;margin-top:2px" ${coSelecionados.has(p.id) ? 'checked' : ''} onchange="coToggleSelecionado('${p.id}')">
            <div style="flex:1">
              <div style="font-weight:700">${coEsc(p.nome_completo)}</div>
              <div style="font-size:.72rem;color:var(--text2)">${coEsc(coRotuloFuncao(p))}${p.sec ? ` — Seção ${coEsc(p.sec.numero)}, ${coEsc(p.sec.local_nome || '')}` : ''}</div>
              <div style="font-size:.72rem;color:var(--text2);margin-top:2px">📍 ${coEsc(p.endereco.endereco)}${p.endereco.bairro ? ', ' + coEsc(p.endereco.bairro) : ''} — ${coFmtCep(p.endereco.cep)} <span style="opacity:.7">(${coEsc(p.endereco.fonte)})</span></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <button class="btn btn-out btn-xs" onclick="coImprimir(['${p.id}'],'etiqueta')">🏷️ Etiqueta</button>
              <button class="btn btn-out btn-xs" onclick="coImprimir(['${p.id}'],'ar')">📄 AR</button>
            </div>
          </div>`).join('')}
      </div>` : '<div class="ic-sub" style="margin-bottom:0">Ninguém marcado com "Carta Registrada" e com endereço disponível.</div>'}
    </div>

    ${semEndereco.length ? `
    <div class="import-card">
      <div class="ic-title" style="font-size:.85rem">⚠️ Sem endereço no ELO (${semEndereco.length})</div>
      <div class="ic-sub">Nenhum dos três blocos de endereço da planilha do TRE (dados do mesário, cadastro de eleitor, comercial) veio
        preenchido pra estas pessoas — não dá pra montar etiqueta sem adivinhar o endereço.</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${semEndereco.map(p => `<div style="font-size:.8rem">${coEsc(p.nome_completo)} — ${coEsc(coRotuloFuncao(p))}</div>`).join('')}
      </div>
    </div>` : ''}
  `;
}
