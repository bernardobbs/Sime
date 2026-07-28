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
