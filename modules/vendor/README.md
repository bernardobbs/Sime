# modules/vendor/

Dependências de terceiros **vendorizadas** (servidas localmente em vez de CDN),
para que os painéis subam mesmo com rede instável / CDN bloqueada — importante nos
TV Box antigos (WebView antigo) e na rede do cartório.

## supabase-js.esm.js

Bundle ESM autocontido do `@supabase/supabase-js` (createClient + auth + realtime).
Substitui o antigo `import ... from 'https://esm.sh/@supabase/supabase-js@2'` em
runtime. Todos os módulos importam `./vendor/supabase-js.esm.js`.

**Como foi gerado** (reproduzir ao atualizar a versão):
```bash
mkdir build && cd build && npm init -y
npm i @supabase/supabase-js@2 esbuild
echo "export { createClient } from '@supabase/supabase-js';" > entry.js
npx esbuild entry.js --bundle --format=esm --platform=browser \
  --target=es2015 --legal-comments=none \
  --outfile=../modules/vendor/supabase-js.esm.js
```

- Versão empacotada: **@supabase/supabase-js 2.110.2**
- Alvo `es2015`: compatível com WebView antigo (Android 7 dos TV Box).
- Sem imports externos — arquivo único, autossuficiente.

## qrcode.min.js

`davidshimjs/qrcodejs` — desenha os QR Codes dos cartões de acesso em
`SIME_tokens.html`. Substitui o antigo `<script src="https://cdnjs...">`: a
impressão dos 174+ cartões acontece no cartório, onde a rede é instável, e um
CDN fora do ar deixaria todo cartão com "QR indisponível" — justamente o dado
que o operador precisa para entrar no sistema.

**Como foi obtido** (reproduzir ao atualizar a versão):
```bash
npm pack qrcodejs@1.0.0
tar xzf qrcodejs-1.0.0.tgz
cp package/qrcode.min.js  modules/vendor/qrcode.min.js
cp package/LICENSE        modules/vendor/qrcode.LICENSE
```

- Versão empacotada: **qrcodejs 1.0.0** (mesmo build que o cdnjs servia)
- Expõe o global `QRCode` + `QRCode.CorrectLevel` — API usada pelo módulo.
- Sem dependências (o `jquery.min.js` do pacote **não** é usado).
- Licença MIT — ver `qrcode.LICENSE`.

## leaflet.js / leaflet.css

Biblioteca de mapa `leafletjs/leaflet` — desenha o mapa de posição estimada
dos veículos na TV Dia (`SIME_tv_dia.html`, aba 🗺️ Rotas, 08/09/2026). Os
marcadores usam `L.divIcon` (CSS puro, cor/emoji por rota) em vez do ícone
padrão do Leaflet — por isso a pasta `images/` do pacote (marker-icon.png
etc.) **não foi copiada**: nada no SIME usa o marcador default.

**Como foi obtido** (reproduzir ao atualizar a versão):
```bash
npm pack leaflet@1.9.4
tar xzf leaflet-1.9.4.tgz
cp package/dist/leaflet.js  modules/vendor/leaflet.js
cp package/dist/leaflet.css modules/vendor/leaflet.css
cp package/LICENSE          modules/vendor/leaflet.LICENSE
```

- Versão empacotada: **leaflet 1.9.4**
- Expõe o global `L` — API usada pelo módulo.
- As TELHAS do mapa (imagens de satélite/ruas) continuam vindo por rede, do
  OpenStreetMap (`tile.openstreetmap.org`, gratuito, sem chave) — isso não dá
  pra vendorizar (seria a Terra inteira). A TV já depende de rede pro
  Realtime do Supabase, então essa dependência não é nova, só mais uma.
- Licença BSD-2-Clause — ver `leaflet.LICENSE`.
