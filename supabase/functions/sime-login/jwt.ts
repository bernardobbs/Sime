// Assinatura manual de JWT HS256 para sessões emitidas por sime-login (TV e,
// na Fase 4, campo). Sem dependências externas — só Web Crypto (crypto.subtle)
// e TextEncoder/btoa, disponíveis tanto no runtime Deno (Edge Functions) quanto
// no Node (usado pelo harness de teste em scratchpad) — o mesmo arquivo roda
// nos dois ambientes sem adaptação.

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jsonToBase64Url(obj: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

export interface SimeJwtClaims {
  sub: string;
  zona_id: string;
  tipo: string;
  rotas?: string[] | null;
  local_id?: string | null;
  exp: number; // unix seconds
  iat: number; // unix seconds
}

// Assina um JWT HS256 com os claims exigidos pelo PostgREST/Supabase
// (sub/role/aud/exp) mais os claims customizados do SIME.
export async function signSimeJwt(claims: SimeJwtClaims, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: claims.sub,
    role: 'authenticated',
    aud: 'authenticated',
    iat: claims.iat,
    exp: claims.exp,
    zona_id: claims.zona_id,
    tipo: claims.tipo,
    rotas: claims.rotas ?? null,
    local_id: claims.local_id ?? null,
  };
  const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;
  const sig = await hmacSha256(secret, signingInput);
  return `${signingInput}.${bytesToBase64Url(sig)}`;
}

// Duração padrão da sessão por tipo de token — TV fica ligada num telão sem
// ninguém pra refazer login; campo é reemitido a cada abertura do módulo.
export function expiracaoParaTipo(tipo: string, agoraSegundos: number): number {
  const DIAS_TV = 90;
  const HORAS_CAMPO = 12;
  const segundos = tipo === 'tv' ? DIAS_TV * 24 * 3600 : HORAS_CAMPO * 3600;
  return agoraSegundos + segundos;
}
