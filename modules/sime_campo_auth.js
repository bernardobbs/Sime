// modules/sime_campo_auth.js
// Bootstrap de sessão para os módulos de campo (mesário, conferente,
// motorista, instalador, mídias, acessibilidade). Diferente das TVs
// (sime_tv_auth.js): sessão de campo é de UM TURNO só (sessionStorage, não
// localStorage) e sempre exige {token, pin} — nunca pula a checagem de PIN.
//
// Cada módulo já tem sua própria UI/validação de token+PIN local (via
// sime_tokens_v1 em localStorage) para dar feedback instantâneo mesmo
// offline. Esta função roda DEPOIS dessa validação local, só para tentar
// obter uma sessão real do Supabase — se falhar (rede indisponível), o
// módulo continua funcionando 100% local/offline, sem travar.

const SESSION_KEY = 'sime_campo_session_v1';
const MARGEM_EXPIRACAO_MS = 60_000;

function sessaoValida(s, token) {
  return !!s && !!s.jwt && !!s.exp && s.token === token && s.exp * 1000 > Date.now() + MARGEM_EXPIRACAO_MS;
}

function lerSessao() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
}

async function trocarToken(supabaseUrl, token, pin) {
  const resp = await fetch(`${supabaseUrl}/functions/v1/sime-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, pin }),
  });
  if (!resp.ok) throw new Error(`sime-login retornou ${resp.status}`);
  return resp.json(); // { jwt, exp, zona_id, tipo, rotas, local_id, local_nome, secoes }
}

// Retorna { client, zonaId, rotas, localId, localNome, secoes, erro }. `client` vem null
// se a sessão não puder ser obtida (rede indisponível, token/pin inválidos no
// servidor, etc.) — o módulo chamador deve seguir no modo local/offline nesse
// caso. `rotas`/`localId`/`secoes` são o escopo do token (conferente/motorista
// usam rotas; acessibilidade usa localId; mesário/instalador/mídias usam
// secoes) — vêm sempre da sessão, nunca de um valor hardcoded no client.
export async function bootstrapCampoSession({ supabaseUrl, supabaseAnonKey, token, pin }) {
  let sessao = lerSessao();

  if (!sessaoValida(sessao, token)) {
    try {
      const dados = await trocarToken(supabaseUrl, token, pin);
      sessao = {
        token, jwt: dados.jwt, exp: dados.exp, zona_id: dados.zona_id, tipo: dados.tipo,
        rotas: dados.rotas ?? null, local_id: dados.local_id ?? null,
        local_nome: dados.local_nome ?? null, secoes: dados.secoes ?? null,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessao));
    } catch (erro) {
      return { client: null, zonaId: null, rotas: null, localId: null, localNome: null, secoes: null, erro: String(erro) };
    }
  }

  const { createClient } = await import('./vendor/supabase-js.esm.js');
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${sessao.jwt}` } },
  });
  return {
    client, zonaId: sessao.zona_id,
    rotas: sessao.rotas ?? null, localId: sessao.local_id ?? null,
    localNome: sessao.local_nome ?? null, secoes: sessao.secoes ?? null,
    erro: null,
  };
}

export function limparSessaoCampo() {
  sessionStorage.removeItem(SESSION_KEY);
}

// Preenche o campo de token do formulário de login a partir do ?token= da URL —
// que é exatamente o que o QR Code do cartão codifica (ver buildUrl() em
// SIME_tokens.html). Sem isso o operador escaneia o QR e ainda tem que digitar
// os 8 caracteres à mão, o que anula o motivo do QR existir.
//
// O PIN continua sendo digitado de propósito: ele é o segundo fator, e por isso
// não vai no QR. Como o cartão pode ser fotografado ou ficar exposto na mesa, o
// token sozinho não pode dar acesso.
//
// Não valida o token aqui: quem valida é a Edge Function sime-login, no
// servidor. Validar contra o localStorage seria pior que inútil — o celular do
// mesário nunca viu sime_tokens_v1, que só existe no computador do cartório
// onde os cartões foram gerados.
export function preencherTokenDaUrl({ campoToken = 'login-token', campoPin = 'login-pin' } = {}) {
  const tokenUrl = new URLSearchParams(window.location.search).get('token');
  if (!tokenUrl) return null;

  const elToken = document.getElementById(campoToken);
  if (elToken) elToken.value = tokenUrl.trim().toUpperCase();

  // Cursor direto no PIN: o operador chega no teclado numérico sem um toque a
  // mais (uso às 5h30, em campo — ver CLAUDE.md).
  const elPin = document.getElementById(campoPin);
  if (elPin) elPin.focus();

  return tokenUrl;
}
