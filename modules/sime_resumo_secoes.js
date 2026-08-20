// ══════════════════════════════════════
// RESUMO POR SEÇÃO — status dos 4 cargos de mesa (Presidente, 1º Mesário,
// 2º Mesário, 1º Secretário) por seção, pra achar rápido quais seções
// precisam de atenção. Mesma ideia da aba "Resumo por Seção" da planilha do
// TRE, mas usando o status de confirmação REAL do SIME (sime_atores.confirmacao,
// gravado por api/hermes-mesarios.js quando a pessoa responde pelo
// WhatsApp) — não o "Confirmou convocação" da planilha, que é um controle
// humano paralelo e não chega a sime_atores (ver sime_mesarios_sync.js).
// ══════════════════════════════════════

const RS_CARGOS = ['Presidente', '1º Mesário', '2º Mesário', '1º Secretário'];

let rsDados = null; // { secoes:[...], porSecao:{ [secao_id]: { [cargo]: confirmacao } } }

async function rsCarregar() {
  const sb = window.supabaseAtores;
  const zonaId = await zonaDoUsuario();
  if (!zonaId) { rsDados = { erro: 'Conta sem zona associada' }; render(); return; }

  const [{ data: secoes, error: e1 }, { data: atores, error: e2 }] = await Promise.all([
    sb.from('sime_secoes').select('id, numero, municipio, local_nome').eq('zona_id', zonaId).eq('ativo', true).order('numero'),
    sb.from('sime_atores').select('secao_id, funcao_mesa, confirmacao').eq('zona_id', zonaId).eq('funcao', 'mesario').eq('ativo', true),
  ]);
  if (e1 || e2) { rsDados = { erro: (e1 || e2).message }; render(); return; }

  const porSecao = {};
  for (const a of atores || []) {
    if (!a.secao_id || !a.funcao_mesa) continue;
    if (!porSecao[a.secao_id]) porSecao[a.secao_id] = {};
    // Se por algum motivo houver mais de um ativo no mesmo cargo, fica o
    // "melhor" status (confirmado > pendente > recusou) — melhor mostrar
    // otimista do que esconder que alguém já confirmou.
    const atual = porSecao[a.secao_id][a.funcao_mesa];
    const prioridade = { confirmado: 3, pendente: 2, substituido: 1, recusou: 1 };
    if (!atual || (prioridade[a.confirmacao] || 0) >= (prioridade[atual] || 0)) {
      porSecao[a.secao_id][a.funcao_mesa] = a.confirmacao;
    }
  }
  rsDados = { secoes: secoes || [], porSecao };
  render();
}

function rsStatusCargo(confirmacao) {
  if (!confirmacao) return { icone: '❌', label: 'Sem designação', cls: 'rs-sem' };
  if (confirmacao === 'confirmado') return { icone: '✅', label: 'Confirmado', cls: 'rs-ok' };
  if (confirmacao === 'recusou') return { icone: '⚠️', label: 'Recusou — precisa substituto', cls: 'rs-alerta' };
  return { icone: '🔶', label: 'Aguardando confirmação', cls: 'rs-aguardando' }; // pendente/substituido/outros
}

function renderResumoSecoes() {
  const c = document.getElementById('content');
  if (!window.supabaseAtores) {
    c.innerHTML = '<div class="import-card"><div class="import-result ir-warn">Entre com a conta da equipe pra ver o resumo.</div></div>';
    return;
  }
  if (!rsDados) {
    c.innerHTML = '<div class="import-card"><div class="ic-title">📊 Resumo por Seção</div><div class="ic-sub">Carregando…</div></div>';
    rsCarregar();
    return;
  }
  if (rsDados.erro) {
    c.innerHTML = `<div class="import-card"><div class="import-result ir-warn">⚠ ${rsDados.erro}</div></div>`;
    return;
  }

  const linhas = rsDados.secoes.map(s => {
    const cargos = RS_CARGOS.map(cargo => rsStatusCargo(rsDados.porSecao[s.id]?.[cargo]));
    const designados = cargos.filter(x => x.cls !== 'rs-sem').length;
    const confirmados = cargos.filter(x => x.cls === 'rs-ok').length;
    return { secao: s, cargos, designados, confirmados };
  });

  const semNenhum = linhas.filter(l => l.designados === 0).length;
  const completas = linhas.filter(l => l.confirmados === 4).length;

  c.innerHTML = `
    <div class="import-card">
      <div class="ic-title">📊 Resumo por Seção</div>
      <div class="ic-sub">Status dos 4 cargos de mesa por seção — ❌ sem ninguém designado, 🔶 designado mas aguardando
        confirmação por WhatsApp, ⚠️ recusou (precisa substituto), ✅ confirmado.</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin:10px 0;font-size:.85rem">
        <div><b>${linhas.length}</b> seções mapeadas</div>
        <div style="${semNenhum > 0 ? 'color:var(--red);font-weight:700' : ''}"><b>${semNenhum}</b> sem nenhum cargo designado</div>
        <div><b>${completas}</b> com mesa completa confirmada (4/4)</div>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.82rem">
          <thead>
            <tr style="text-align:left;border-bottom:1px solid var(--border2)">
              <th style="padding:6px 8px">Seção</th>
              <th style="padding:6px 8px">Local / Município</th>
              ${RS_CARGOS.map(c => `<th style="padding:6px 8px">${c}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${linhas.map(l => `
              <tr style="border-bottom:1px solid var(--border2);${l.designados === 0 ? 'background:var(--red-bg)' : l.confirmados === 4 ? 'background:var(--green-bg)' : ''}">
                <td style="padding:6px 8px;font-weight:700">${l.secao.numero}</td>
                <td style="padding:6px 8px">${l.secao.local_nome || ''} — ${l.secao.municipio || ''}</td>
                ${l.cargos.map(cg => `<td style="padding:6px 8px" title="${cg.label}">${cg.icone}</td>`).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}
