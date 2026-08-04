# HERMES_CLAUDE.md

> Arquitetura e Especificação de Refatoração do Hermes Agent

## Objetivo

Refatorar o Hermes Agent para uma arquitetura modular, preservando 100%
da funcionalidade existente.

### Regras obrigatórias

-   Não alterar o comportamento atual.
-   Não perder a sessão do WhatsApp (`auth_info`).
-   Não sobrescrever `.env`.
-   Manter compatibilidade com PM2.
-   Não interromper o serviço durante migrações.
-   Refatorar incrementalmente.

## Estrutura alvo

``` text
hermes-agent/
├── index.js
├── package.json
├── .env
├── auth_info/
├── core/
│   ├── app.js
│   ├── startup.js
│   ├── router.js
│   ├── config.js
│   └── logger.js
├── modules/
│   ├── whatsapp/
│   ├── telegram/
│   ├── ai/
│   ├── keywords/
│   ├── supabase/
│   ├── mesarios/
│   ├── monitor/
│   ├── admin/
│   ├── updater/
│   └── status/
├── services/
├── data/
├── logs/
└── backups/
```

## Bootstrap

`index.js` deve conter apenas:

``` js
require("dotenv").config();

const app = require("./core/app");

app.start();
```

## Plano de migração

### Fase 1

-   Criar `core`.
-   Mover inicialização.
-   Garantir funcionamento idêntico.

### Fase 2

-   Extrair módulo WhatsApp.
-   Preservar Baileys.
-   Preservar `auth_info`.

### Fase 3

-   Extrair Telegram.

### Fase 4

-   Extrair Supabase.

### Fase 5

-   Extrair IA (Gemini).

### Fase 6

-   Extrair Keywords.

### Fase 7

-   Extrair Monitoramento.

### Fase 8

-   Extrair Administração.

### Fase 9

-   Implementar módulo Updater.

## Sistema de atualização automática

Criar `modules/updater`.

Fluxo:

1.  Verificar versão no GitHub.
2.  Baixar atualização.
3.  Criar backup.
4.  Atualizar apenas arquivos alterados.
5.  Nunca alterar:
    -   `.env`
    -   `auth_info`
    -   `logs`
6.  Executar `npm install` se necessário.
7.  Reiniciar PM2.
8.  Executar healthcheck.
9.  Em caso de falha, restaurar backup automaticamente.

## Logs

Padronizar logs por módulo:

-   INFO
-   WARN
-   ERROR
-   DEBUG

Salvar em `logs/`.

## Contrato dos módulos

Cada módulo deve exportar:

``` js
init(app)
shutdown()
health()
```

Sem dependências circulares.

## Critérios de aceite

-   WhatsApp conecta normalmente.
-   Telegram envia mensagens.
-   Gemini responde.
-   Supabase grava dados.
-   PM2 reinicia sem erro.
-   Healthcheck aprovado.
-   Nenhuma regressão funcional.

## Testes obrigatórios

-   Mensagem privada.
-   Grupo monitorado.
-   Confirmação de mesário.
-   Recusa de mesário.
-   Reinício do PM2.
-   Reconexão do WhatsApp.
-   Atualização automática.
-   Rollback.

## Roadmap

-   Dashboard Web.
-   Integração SIME.
-   Integração PJe/DataJud.
-   Agentes especializados.
-   API REST.
-   Painel administrativo.
-   Plugins.

## Instrução ao Claude Code

Execute a refatoração em pequenas etapas.

Nunca reescreva o projeto inteiro de uma vez.

Após cada etapa:

1.  Executar testes.
2.  Corrigir regressões.
3.  Fazer commit.
4.  Prosseguir somente se todos os testes passarem.

A prioridade absoluta é preservar o funcionamento do Hermes durante toda
a migração.

---

## Nota de status (04/08/2026, sessão que recebeu este documento)

Este documento chegou **depois** de outra reestruturação do Hermes já ter
sido feita na mesma sessão, seguindo a "Estrutura Recomendada do Hermes" do
`docs/UPDATE_SIME.md` (`core/bootstrap.js` + `services/*` + `modules/whatsapp/`
+ `modules/campanhas/`) — não a estrutura `core/app.js` + `modules/{whatsapp,
telegram, ai, keywords, supabase, mesarios, monitor, admin, updater, status}`
que este documento propõe. As duas nomeiam e dividem as coisas de forma
diferente; não são a mesma estrutura com nomes trocados.

**Decisão tomada**: manter a estrutura já entregue (não renomear pastas/
arquivos), e incorporar só a ideia do **contrato `health()`** — cada módulo
que já existia (`monitor.js`, `dispatch.js`, `notificacoes.js`) passou a
exportar `health()`, e `heartbeat.js` agrega isso em vez de duplicar a
lógica de saúde. `init(app)`/`shutdown()` **não foram implementados**: nada
hoje precisa de desligamento gracioso (o PM2 reinicia o processo inteiro),
então seriam métodos vazios sem uso real.

**Itens deste documento que não foram adotados, e por quê**:

- **`modules/supabase` gravando dados direto** — reintroduziria o bug que foi
  corrigido nesta mesma sessão: a escrita direta no Supabase usava colunas
  que não existem (`status_convocacao`, `mensagem_resposta`...) e ignorava
  `/api/hermes-mesarios` (que resolve zona, grava a coluna certa —
  `confirmacao` — e loga). O caminho correto é sempre via API do SIME, não
  Supabase direto do Hermes.
- **`modules/telegram`** — o bot do Telegram já roda num processo PM2
  separado (`hermes-telegram` / `telegram.js`, ver `hermes/HERMES_RUNTIME.md`),
  fora do `index.js`. Ninguém nesta sessão teve acesso ao conteúdo de
  `telegram.js` pra incorporá-lo com segurança.
- **`modules/updater` com verificação de versão no GitHub, backup e
  rollback automático** — funcionalidade nova de verdade, não reorganização.
  O Hermes não está versionado em nenhum repositório GitHub hoje (é só
  arquivo local no Pi) — pré-requisito que precisa existir antes de um
  updater automático fazer sentido.
- **Migração em 9 fases com teste + commit a cada etapa** — vale como
  prática para o que ainda falta fazer no Hermes daqui pra frente (a
  reestruturação já entregue foi feita de uma vez só, o que este documento
  explicitamente desaconselha). Registrado aqui para próximas sessões
  seguirem esse ritmo.
- **Roadmap** (Dashboard Web, PJe/DataJud, agentes especializados, API REST,
  plugins) — aspiracional, mesmo status do roadmap do `docs/UPDATE_SIME.md`:
  não implementado, não é prioridade imediata.
