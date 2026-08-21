// ══════════════════════════════════════
// RELATÓRIO ELO — quem o SIME já sabe que confirmou (por WhatsApp ou
// manualmente, ver cmConfirmarEEnviar em sime_contatar_mesarios.js) mas cujo
// registro no ELO (sime_mesarios_raw, staging da planilha do TRE) ainda não
// reflete isso. Pedido do cartório em 21/08/2026, depois de uma consulta
// pontual no banco mostrar 14 pessoas nessa situação — virou tela própria
// pra não precisar pedir de novo toda vez.
//
// Junta por TÍTULO DE ELEITOR (sime_atores.inscricao_eleitoral =
// sime_mesarios_raw.inscricao), não por id — sime_mesarios_raw.ator_id nunca
// foi preenchido em produção (a sincronização casa por inscrição, não grava
// o id de volta no staging), então juntar por id sempre dá vazio.
// ══════════════════════════════════════

let reDados = null; // [{ id, nome_completo, inscricao_eleitoral, funcao, funcao_mesa, secao, situacaoElo }]

async function reCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { reDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: atoresBrutos, error: e1 }, { data: secoes, error: e2 }] = await Promise.all([
    sb.from('sime_atores')
      .select('id, nome_completo, inscricao_eleitoral, funcao, funcao_mesa, secao_id')
      .eq('zona_id', zonaId).eq('ativo', true).eq('confirmacao', 'confirmado')
      .in('funcao', ['mesario', 'coord_acessibilidade', 'auxiliar_eleicao']),
    sb.from('sime_secoes').select('id, numero, local_nome, municipio').eq('zona_id', zonaId),
  ]);
  if (e1 || e2) { reDados = { erro: (e1 || e2).message }; render(); return; }
  // Sem título de eleitor não dá pra cruzar com o ELO — fica de fora.
  const atores = (atoresBrutos || []).filter(a => a.inscricao_eleitoral);

  const inscricoes = [...new Set((atores || []).map(a => a.inscricao_eleitoral).filter(Boolean))];
  // sime_mesarios_raw não tem zona_id (só zona_eleitoral_trabalho em texto) —
  // filtra pela lista de títulos já restrita à zona do usuário, não precisa
  // repetir o filtro de zona aqui.
  const { data: raw, error: e3 } = inscricoes.length
    ? await sb.from('sime_mesarios_raw').select('inscricao, confirmou_convocacao, origem_resposta, data_resposta').in('inscricao', inscricoes)
    : { data: [], error: null };
  if (e3) { reDados = { erro: e3.message }; render(); return; }

  const rawPorInscricao = {};
  for (const r of raw || []) {
    // Pode haver mais de uma linha por título (ex.: MRV e AL na mesma
    // exportação) — fica com a que já diz "Sim" se existir alguma, senão a
    // primeira (não faz diferença pro relatório: o que importa é se ALGUMA
    // resposta do ELO pra essa pessoa já é "Sim").
    const atual = rawPorInscricao[r.inscricao];
    if (!atual || r.confirmou_convocacao === 'Sim') rawPorInscricao[r.inscricao] = r;
  }

  const secoesPorId = Object.fromEntries((secoes || []).map(s => [s.id, s]));
  const pendentes = (atores || [])
    .map(a => ({ ...a, sec: a.secao_id ? secoesPorId[a.secao_id] : null, raw: rawPorInscricao[a.inscricao_eleitoral] || null }))
    .filter(a => (a.raw?.confirmou_convocacao || null) !== 'Sim')
    .sort((a, b) => (a.nome_completo || '').localeCompare(b.nome_completo || ''));

  reDados = pendentes;
  render();
}

function reRotuloFuncao(a) {
  if (a.funcao === 'mesario') return a.funcao_mesa || 'Mesário(a)';
  return CM_FUNCAO_LABEL[a.funcao] || a.funcao || '—';
}

function reSituacaoElo(a) {
  if (!a.raw) return { texto: 'Sem registro no ELO', alerta: false };
  if (a.raw.confirmou_convocacao === 'Não') {
    return { texto: `ELO diz "Não"${a.raw.data_resposta ? ` (${reEsc(a.raw.data_resposta)})` : ''}`, alerta: true };
  }
  return { texto: 'Sem resposta registrada no ELO', alerta: false };
}

function reEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderRelatorioElo() {
  const c = document.getElementById('content');
  if (!window.supabaseAtores) {
    c.innerHTML = '<div class="import-card"><div class="import-result ir-warn">Entre com a conta da equipe.</div></div>';
    return;
  }
  if (!reDados) {
    c.innerHTML = '<div class="import-card"><div class="ic-title">📄 Relatório ELO</div><div class="ic-sub">Carregando…</div></div>';
    reCarregar();
    return;
  }
  if (reDados.erro) {
    c.innerHTML = `<div class="import-card"><div class="import-result ir-warn">⚠ ${reEsc(reDados.erro)}</div></div>`;
    return;
  }

  const emConflito = reDados.filter(a => a.raw?.confirmou_convocacao === 'Não').length;

  c.innerHTML = `
    <div class="import-card">
      <div class="ic-title">📄 Relatório ELO — atualizações pendentes na planilha do TRE</div>
      <div class="ic-sub">Gente que o SIME já sabe que confirmou (por WhatsApp ou manualmente) mas cujo registro no
        ELO ainda não mostra isso. Sem resposta registrada = o ELO nunca recebeu retorno dessa pessoa; ⚠️ ELO diz "Não"
        = o ELO tem uma resposta explícita diferente da do SIME — vale conferir com a pessoa antes de atualizar, pode
        ter mudado de ideia depois ou ser um erro de registro num dos dois sistemas.</div>
      ${emConflito ? `<div class="import-result ir-warn">⚠️ ${emConflito} caso(s) com resposta "Não" no ELO — revisar antes de marcar como atualizado.</div>` : ''}
      ${reDados.length ? `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.82rem">
          <thead>
            <tr style="text-align:left;border-bottom:1px solid var(--border2)">
              <th style="padding:6px 8px">Nome</th>
              <th style="padding:6px 8px">Título</th>
              <th style="padding:6px 8px">Função</th>
              <th style="padding:6px 8px">Seção / Local</th>
              <th style="padding:6px 8px">Situação no ELO</th>
            </tr>
          </thead>
          <tbody>
            ${reDados.map(a => {
              const sit = reSituacaoElo(a);
              return `
              <tr style="border-bottom:1px solid var(--border2)${sit.alerta ? ';background:var(--yellow-bg)' : ''}">
                <td style="padding:6px 8px">${reEsc(a.nome_completo)}</td>
                <td style="padding:6px 8px">${reEsc(a.inscricao_eleitoral)}</td>
                <td style="padding:6px 8px">${reEsc(reRotuloFuncao(a))}</td>
                <td style="padding:6px 8px">${a.sec ? `${a.sec.numero} — ${reEsc(a.sec.local_nome || '')}, ${reEsc(a.sec.municipio || '')}` : '—'}</td>
                <td style="padding:6px 8px${sit.alerta ? ';font-weight:700;color:var(--yellow)' : ''}">${sit.alerta ? '⚠️ ' : ''}${sit.texto}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : '<div class="ic-sub" style="margin-bottom:0">Nenhuma pendência — todo mundo confirmado no SIME já está refletido no ELO. 🎉</div>'}
    </div>`;
}
