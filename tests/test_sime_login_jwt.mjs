// Testa a lógica REAL de assinatura de JWT usada por supabase/functions/sime-login
// (copiada como .ts e importada com strip de tipos — mesmo arquivo de produção).
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const _JWT = join(tmpdir(), '_sime_login_jwt.ts');
execSync(`cp ${ROOT}/supabase/functions/sime-login/jwt.ts ${_JWT}`);
const { signSimeJwt, expiracaoParaTipo } = await import(pathToFileURL(_JWT).href);

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

function b64urlDecode(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

async function hmac(secret, data) {
  const { createHmac } = await import('node:crypto');
  return createHmac('sha256', secret).update(data).digest();
}
function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── expiracaoParaTipo ──
const agora = 1_700_000_000;
check('tv → ~90 dias de expiração', expiracaoParaTipo('tv', agora) === agora + 90 * 24 * 3600);
check('conferente (campo) → ~12h de expiração', expiracaoParaTipo('conferente', agora) === agora + 12 * 3600);
check('motorista (campo) → mesma regra de 12h (qualquer tipo != tv)', expiracaoParaTipo('motorista', agora) === agora + 12 * 3600);

// ── signSimeJwt: shape e claims ──
const jwt = await signSimeJwt(
  { sub: 'user-abc', zona_id: 'zona-7', tipo: 'tv', rotas: null, local_id: null, exp: agora + 1000, iat: agora },
  'segredo-de-teste',
);
const partes = jwt.split('.');
check('JWT tem 3 partes (header.payload.sig)', partes.length === 3);

const header = b64urlDecode(partes[0]);
check('header alg=HS256', header.alg === 'HS256');
check('header typ=JWT', header.typ === 'JWT');

const payload = b64urlDecode(partes[1]);
check('payload.sub correto', payload.sub === 'user-abc');
check('payload.role = authenticated (exigido pelo PostgREST)', payload.role === 'authenticated');
check('payload.aud = authenticated', payload.aud === 'authenticated');
check('payload.zona_id correto', payload.zona_id === 'zona-7');
check('payload.tipo correto', payload.tipo === 'tv');
check('payload.exp correto', payload.exp === agora + 1000);
check('payload.iat correto', payload.iat === agora);
check('payload.rotas null quando não informado', payload.rotas === null);
check('payload.local_id null quando não informado', payload.local_id === null);

// ── assinatura HMAC-SHA256 verificável de forma independente ──
const assinaturaEsperada = b64url(await hmac('segredo-de-teste', `${partes[0]}.${partes[1]}`));
check('assinatura bate com HMAC-SHA256 calculado independentemente', partes[2] === assinaturaEsperada);

// ── segredo errado gera assinatura diferente (garantia de que o secret importa) ──
const jwtOutroSecret = await signSimeJwt(
  { sub: 'user-abc', zona_id: 'zona-7', tipo: 'tv', rotas: null, local_id: null, exp: agora + 1000, iat: agora },
  'segredo-ERRADO',
);
check('segredo diferente produz assinatura diferente', jwtOutroSecret.split('.')[2] !== partes[2]);

// ── claims custom com valores presentes (rotas/local_id) ──
const jwtCampo = await signSimeJwt(
  { sub: 'user-campo', zona_id: 'zona-9', tipo: 'conferente', rotas: ['001', '002'], local_id: 'local-x', exp: agora + 500, iat: agora },
  'segredo-de-teste',
);
const payloadCampo = b64urlDecode(jwtCampo.split('.')[1]);
check('rotas preservadas no payload', JSON.stringify(payloadCampo.rotas) === JSON.stringify(['001', '002']));
check('local_id preservado no payload', payloadCampo.local_id === 'local-x');

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
