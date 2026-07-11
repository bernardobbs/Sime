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
