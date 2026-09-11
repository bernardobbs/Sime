// api/rotas-directions.js — Vercel Serverless Function
// Proxy pra Google Directions API (09/09/2026, pedido direto: linha seguindo
// rua de verdade na ficha impressa + previsão de chegada mais precisa no
// módulo 🗺️ Rotas). A chave (GOOGLE_MAPS_API_KEY) NUNCA pode ir pro
// navegador — é por isso que este endpoint existe: o cliente manda as
// paradas, o servidor chama o Google com a chave guardada só aqui (variável
// de ambiente da Vercel) e devolve só o resultado já processado.
//
// Chamado só sob clique explícito do cartório (nunca em loop/realtime) —
// a API do Google é PAGA acima do crédito grátis mensal, e a "previsão de
// chegada"/mapa da ficha recalculam sozinhos com muita frequência (a cada
// evento Realtime, a cada 10s na TV Dia); se isso chamasse o Google a cada
// recálculo, o crédito grátis evaporaria num único dia de operação. O
// resultado é sempre CACHEADO em sime_rotas (rota_real_*) pelo próprio
// cliente — este endpoint só calcula, nunca grava no banco.
//
// Exige sessão Supabase válida (Bearer do access_token da equipe logada) —
// diferente dos outros arquivos deste diretório (hermes-*.js, que
// autenticam por HERMES_SECRET_ZONA_<n> vindo do Hermes), este é chamado
// direto pelo NAVEGADOR do cartório, então sem essa checagem qualquer
// estranho na internet que descobrisse a URL poderia gastar a cota/gerar
// custo só bombardeando o endpoint.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Decodifica o "encoded polyline" que o Google devolve (algoritmo padrão
// deles) pra uma lista de [lat, lon] — decodificado no servidor pra não
// precisar de mais uma lib/função duplicada no cliente.
function decodificarPolyline(encoded) {
  let index = 0, lat = 0, lon = 0;
  const pontos = [];
  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += (result & 1) ? ~(result >> 1) : (result >> 1);

    pontos.push([lat / 1e5, lon / 1e5]);
  }
  return pontos;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Sem sessão — faça login no SIME primeiro' });
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Sessão inválida ou expirada' });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'GOOGLE_MAPS_API_KEY não configurada na Vercel' });

  const paradas = Array.isArray(req.body?.paradas) ? req.body.paradas : null;
  if (!paradas || paradas.length < 2) {
    return res.status(400).json({ error: 'Precisa de pelo menos 2 paradas com latitude/longitude' });
  }
  for (const p of paradas) {
    if (typeof p?.lat !== 'number' || typeof p?.lon !== 'number') {
      return res.status(400).json({ error: 'Cada parada precisa de lat/lon numéricos' });
    }
  }

  const origem = paradas[0];
  const destino = paradas[paradas.length - 1];
  const meio = paradas.slice(1, -1);
  const params = new URLSearchParams({
    origin: `${origem.lat},${origem.lon}`,
    destination: `${destino.lat},${destino.lon}`,
    mode: 'driving',
    key: apiKey,
  });
  // Sem optimize:true de propósito — a ordem das paradas já foi decidida
  // pelo cartório no módulo (▲/▼), o Google não deve reordenar por conta própria.
  if (meio.length) params.set('waypoints', meio.map(p => `${p.lat},${p.lon}`).join('|'));

  let googleResp;
  try {
    googleResp = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`);
  } catch (e) {
    return res.status(502).json({ error: 'Falha de rede ao consultar o Google Maps: ' + e.message });
  }
  const dados = await googleResp.json().catch(() => null);
  if (!dados || dados.status !== 'OK' || !dados.routes?.[0]) {
    return res.status(502).json({ error: 'Google Maps não retornou rota', detalhe: dados?.status || 'resposta inválida' });
  }

  const rota = dados.routes[0];
  const distanciaM = rota.legs.reduce((s, l) => s + (l.distance?.value || 0), 0);
  const duracaoS = rota.legs.reduce((s, l) => s + (l.duration?.value || 0), 0);
  const polyline = decodificarPolyline(rota.overview_polyline?.points || '');

  return res.status(200).json({
    ok: true,
    distanciaM,
    duracaoS,
    polyline, // [[lat,lon], ...]
  });
}
