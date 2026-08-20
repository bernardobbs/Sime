// ══════════════════════════════════════
// HISTÓRICO DE SINCRONIZAÇÕES — últimas vezes que alguém rodou "Sincronizar
// mesários" (sime_mesarios_sync.js), lendo sime_logs. Antes disso só existia
// dentro de sime_logs sem tela nenhuma pra ver.
// ══════════════════════════════════════

let hsDados = null; // [{ ts, payload }]

async function hsCarregar() {
  const sb = window.supabaseAtores;
  const { data, error } = await sb.from('sime_logs')
    .select('ts, payload')
    .eq('acao', 'mesarios_sync_csv')
    .order('ts', { ascending: false })
    .limit(50);
  if (error) { hsDados = { erro: error.message }; render(); return; }
  hsDados = data || [];
  render();
}

function hsFmtData(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('pt-BR');
}

function renderHistoricoSync() {
  const c = document.getElementById('content');
  if (!window.supabaseAtores) {
    c.innerHTML = '<div class="import-card"><div class="import-result ir-warn">Entre com a conta da equipe.</div></div>';
    return;
  }
  if (!hsDados) {
    c.innerHTML = '<div class="import-card"><div class="ic-title">📜 Histórico de sincronizações</div><div class="ic-sub">Carregando…</div></div>';
    hsCarregar();
    return;
  }
  if (hsDados.erro) {
    c.innerHTML = `<div class="import-card"><div class="import-result ir-warn">⚠ ${hsDados.erro}</div></div>`;
    return;
  }

  c.innerHTML = `
    <div class="import-card">
      <div class="ic-title">📜 Histórico de sincronizações</div>
      <div class="ic-sub">Últimas vezes que a base de mesários foi atualizada a partir de um CSV — quantos registros
        entraram, quantos atores foram atualizados e quantos saíram da exportação (inativados).</div>
      ${hsDados.length ? `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.82rem">
          <thead>
            <tr style="text-align:left;border-bottom:1px solid var(--border2)">
              <th style="padding:6px 8px">Quando</th>
              <th style="padding:6px 8px">Zona/UF</th>
              <th style="padding:6px 8px">Registros no arquivo</th>
              <th style="padding:6px 8px">Atualizados</th>
              <th style="padding:6px 8px">Inativados</th>
            </tr>
          </thead>
          <tbody>
            ${hsDados.map(h => `
              <tr style="border-bottom:1px solid var(--border2)">
                <td style="padding:6px 8px">${hsFmtData(h.ts)}</td>
                <td style="padding:6px 8px">${h.payload?.zona ?? '—'}/${h.payload?.uf ?? '—'}</td>
                <td style="padding:6px 8px">${h.payload?.registros ?? '—'}</td>
                <td style="padding:6px 8px">${h.payload?.atualizados ?? '—'}</td>
                <td style="padding:6px 8px">${h.payload?.inativados ?? '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<div class="ic-sub" style="margin-bottom:0">Nenhuma sincronização registrada ainda.</div>'}
    </div>`;
}
