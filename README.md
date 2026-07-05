# SIME — Sistema de Monitoramento Eleitoral

Sistema auxiliar de observabilidade para a **7ª Zona Eleitoral do Piauí**.
Eleição de outubro de 2026. Custo de infraestrutura: **R$ 0,00/mês**.

## Início rápido (homologação local)

```bash
# Servir localmente
python3 -m http.server 8080
# Acessar: http://localhost:8080/modules/SIME_principal.html
```

## Deploy (produção)

```bash
# 1. Instalar Vercel CLI
npm install -g vercel

# 2. Configurar variáveis de ambiente
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add HERMES_WEBHOOK_SECRET

# 3. Deploy
vercel --prod
```

## Documentação completa
Ver `CLAUDE.md` na raiz do projeto.
