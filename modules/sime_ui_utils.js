// modules/sime_ui_utils.js
// Utilitários de UI repetidos quase letra-por-letra em 9-12 dos 16 módulos
// (showToast/vib/relógio do header/formatação de hora) — extraídos aqui pra
// eliminar a duplicação. Script CLÁSSICO (sem type="module") de propósito:
// os módulos chamam essas funções direto de onclick="..." no HTML, então
// elas precisam virar globais automaticamente (como qualquer function
// top-level num <script> normal), sem precisar de import.
//
// Inclua com <script src="./sime_ui_utils.js"></script> ANTES do <script>
// próprio de cada módulo.

// ── TOAST ────────────────────────────────────────────────────
// Espera um elemento #toast no HTML. Duração parametrizável porque os
// módulos originais variavam entre 2200-2800ms — 2600 era o valor mais
// comum, mantido como default.
let _simeToastTimer = null;
function showToast(msg, duration = 2600) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_simeToastTimer);
  _simeToastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

// ── VIBRAÇÃO ─────────────────────────────────────────────────
function vib(pattern) {
  try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) {}
}

// ── RELÓGIO DO HEADER ────────────────────────────────────────
// Cobre as 2 variantes que existiam espalhadas: HH:MM a cada 10s (admin/
// conferente/motorista/principal) e HH:MM:SS a cada 1s (telas de TV).
function iniciarRelogio(elementId, { comSegundos = false, intervaloMs } = {}) {
  const atualizar = () => {
    const el = document.getElementById(elementId);
    if (!el) return;
    const n = new Date();
    const hh = String(n.getHours()).padStart(2, '0');
    const mm = String(n.getMinutes()).padStart(2, '0');
    el.textContent = comSegundos ? `${hh}:${mm}:${String(n.getSeconds()).padStart(2, '0')}` : `${hh}:${mm}`;
  };
  atualizar();
  return setInterval(atualizar, intervaloMs ?? (comSegundos ? 1000 : 10000));
}

// ── FORMATAÇÃO DE HORA ───────────────────────────────────────
// fmtNow(): hora atual, HH:MM.
function fmtNow() {
  const n = new Date();
  return String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
}

// fmtTs(ts): hora de um timestamp específico (não "agora"), HH:MM.
// `vazio` é o texto pra quando ts é null/undefined — os módulos originais
// discordavam entre '—' e '--:--'.
function fmtTs(ts, vazio = '—') {
  if (!ts) return vazio;
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// ── TELEFONE / WHATSAPP ──────────────────────────────────────
// Os números vêm de sime_atores.telefone_whatsapp, cadastrados à mão: uns com
// o 55 na frente, outros sem, alguns com máscara. Normalizar aqui evita o
// link com 55 duplicado (wa.me/5555...), que abre uma conversa vazia.
function telSemPais(t) {
  const d = String(t || '').replace(/\D/g, '');
  return d.startsWith('55') ? d.slice(2) : d;
}

function fmtTelefone(t) {
  const d = telSemPais(t);
  return d.length === 11 ? d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
       : d.length === 10 ? d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
       : (t || '—');
}

// Link wa.me com mensagem opcional. Devolve '' quando o número não dá um DDD +
// número plausível — o chamador usa isso pra esconder o botão em vez de
// oferecer um link que abre no vazio.
function linkWhatsApp(telefone, mensagem) {
  const d = telSemPais(telefone);
  if (d.length < 10) return '';
  const txt = mensagem ? '?text=' + encodeURIComponent(mensagem) : '';
  return `https://wa.me/55${d}${txt}`;
}

// Normaliza QUALQUER telefone recebido de importação (Ciente, colar lista,
// planilha do TRE) pro padrão "55"+DDD+8/9 dígitos que o resto do sistema
// assume em sime_atores.telefone_whatsapp — mesma heurística aplicada na
// normalização em massa de produção em 21/08/2026 (ver
// sql/SIME_telefones_normalizacao.sql e a função gêmea
// sime_normalizar_telefone_whatsapp() no banco). Pedido do cartório no
// mesmo dia: "sempre que importar o contato, normalizar pro formato
// WhatsApp" — antes cada caminho de importação gravava um formato
// diferente (uns sem o "55", alguns sem o dígito 9 de celular antigo).
//
// "Celular ganhou o 9º dígito bem antes de 2016 pra linhas que já
// começavam 6-9; fixo começa 2-5 e nunca ganhou o 9" — mesma regra
// verificada nos 723 registros de produção antes da normalização em massa.
// Placeholder "000000000000" nunca vira um número inventado. Formato de 14
// dígitos (um a mais depois do "55", artefato de cópia de planilha) ou
// outro caso fora do previsto: devolve só os dígitos, sem tentar adivinhar
// qual sobra — melhor esforço, não uma rejeição (diferente do parser de
// "colar lista", que prefere descartar a arriscar).
function normalizarTelefoneWhatsapp(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d === '000000000000') return raw;
  const len = d.length;
  if (len === 13 && d.slice(0, 2) === '55') return d;
  if (len === 11) return '55' + d;
  if (len === 10) {
    return /[6-9]/.test(d[2]) ? '55' + d.slice(0, 2) + '9' + d.slice(2) : '55' + d;
  }
  if (len === 9 && d[0] === '9') return '5586' + d;
  if (len === 8) {
    return /[6-9]/.test(d[0]) ? '55869' + d : '5586' + d;
  }
  if (len === 12 && d[0] === '0') return '55' + d.slice(1);
  if (len === 12 && d.slice(0, 2) === '55') {
    return /[6-9]/.test(d[4]) ? d.slice(0, 4) + '9' + d.slice(4) : d;
  }
  return d;
}

// Normaliza título de eleitor pra 12 dígitos com zero à esquerda — mesma
// convenção agora usada em sime_atores.inscricao_eleitoral por TODO caminho
// que grava ou casa por esse campo (27/08/2026, achado real em produção:
// HEMANUELA e outros 708 casos duplicados porque Excel/planilha come o zero
// à esquerda quando trata a coluna do título como número, e diferentes
// exportações do TRE vinham ora com ele, ora sem — sime_atores.inscricao_eleitoral
// gravava a string crua, então "080172290760" e "80172290760" viravam duas
// pessoas diferentes pro UPSERT. sime_sync_atores_from_raw() (a função no
// banco) já normaliza sozinha desde este fix; esta é a versão JS gêmea, pros
// caminhos que casam PELO CLIENTE (mcAtualizar/cpAtualizar em
// sime_mesarios_sync.js) — sem ela, um arquivo com formato diferente do que
// já está salvo simplesmente não encontraria ninguém (RLS não erra, só
// devolve zero linhas). Ver sql/SIME_atores_titulo_duplicados_merge.sql pro
// reparo do que já tinha duplicado antes deste fix.
function normalizarTituloEleitor(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  return d ? d.padStart(12, '0') : '';
}
