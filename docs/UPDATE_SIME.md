# SIME – Evolução da Arquitetura

**Data:** 04/08/2026

---

# Objetivo

Este documento define a próxima evolução arquitetural do SIME.

O objetivo não é adicionar novas telas, mas consolidar o SIME como um **Centro de Comando Operacional da Eleição**, onde todos os eventos do dia da eleição sejam monitorados, registrados e apresentados em tempo real.

O sistema deverá evoluir de um conjunto de módulos independentes para uma plataforma orientada a eventos.

---

# Visão do Projeto

O SIME não é um sistema de cadastro de mesários.

O SIME também não é apenas um painel administrativo.

Sua finalidade é responder continuamente à seguinte pergunta:

> **"O que está acontecendo neste momento em cada seção eleitoral?"**

Todas as funcionalidades deverão contribuir para responder essa pergunta.

---

# Conceito Central

Todo acontecimento da eleição deverá ser tratado como um **Evento Operacional**.

Exemplos:

- Seção instalada
- Urna entregue
- Urna substituída
- Energia interrompida
- Energia restabelecida
- Fila grande
- Fila normal
- Presidente ausente
- Mídia recolhida
- Urna recolhida
- Problema aberto
- Problema resolvido
- Encerramento da votação

Esses eventos passam a ser a principal fonte de informação do sistema.

---

# Nova Arquitetura

```
                 WhatsApp
                      │
                      │
             Controle Remoto
                      │
                      ▼
                 Hermes Agent
                      │
             Normalização
                      │
                      ▼
        Motor de Eventos Operacionais
                      │
      ┌───────────────┼────────────────┐
      │               │                │
      ▼               ▼                ▼
 Dashboard      Timeline         Alertas
      │               │                │
      └───────────────┼────────────────┘
                      ▼
                 Supabase
```

O Motor de Eventos torna-se o núcleo do sistema.

Nenhum módulo deverá atualizar diretamente telas específicas.

Todos deverão publicar eventos.

---

# Nova Entidade Principal

## Seção Operacional

Cada seção eleitoral deixa de ser apenas um cadastro.

Passa a representar um objeto operacional vivo.

Cada seção deverá possuir estado em tempo real.

Exemplo:

```
Seção 42

Estado
🟢 Operando

Urna
Funcionando

Energia
OK

Internet
OK

Mesários
4/4

Presidente
Presente

Fila
Normal

Problemas
Nenhum

Mídia
Não recolhida

Linha do Tempo
...
```

Todos os módulos consultarão esse estado.

---

# Timeline

Criar uma timeline operacional para cada seção.

Exemplo:

06:02 Urna entregue

06:15 Presidente chegou

06:20 Mesários completos

06:42 Instalação concluída

07:00 Início da votação

09:15 Fila acima de 30 pessoas

09:41 Fila normalizada

11:18 Urna substituída

17:00 Encerramento

17:42 Mídia recolhida

Essa timeline deverá ser construída automaticamente pelos eventos.

---

# Motor de Eventos

Criar um módulo central responsável pelo processamento dos eventos.

Estrutura sugerida:

```
modules/

event_engine/

index.js

publish.js

subscribe.js

event_types.js

processors/
```

Nenhum módulo deverá conhecer diretamente outro módulo.

Comunicação sempre por eventos.

---

# Event Bus

Adicionar um barramento interno de eventos.

Exemplo:

```
publish("SECAO_INSTALADA")

↓

Dashboard

↓

Timeline

↓

Logs

↓

Alertas

↓

TV

↓

Relatórios
```

Cada módulo poderá registrar listeners.

---

# Padronização dos Eventos

Criar um catálogo oficial.

Exemplo:

```
SECAO_INSTALADA

SECAO_ABERTA

SECAO_ENCERRADA

URNA_ENTREGUE

URNA_SUBSTITUIDA

MIDIA_RECOLHIDA

PROBLEMA_ABERTO

PROBLEMA_RESOLVIDO

FILA_GRANDE

FILA_NORMAL

ENERGIA_OFF

ENERGIA_ON

INTERNET_OFF

INTERNET_ON
```

Todos os módulos utilizarão apenas esse catálogo.

---

# Hermes Agent

O Hermes deixa de ser apenas um bot.

Passa a ser o principal coletor de eventos da eleição.

Fluxo:

```
Mensagem

↓

Interpretação

↓

Evento

↓

Motor de Eventos

↓

Supabase
```

O Hermes nunca deverá atualizar diretamente tabelas de negócio.

Sempre publicará eventos.

---

# Painel Operacional

Criar um painel principal.

Exemplo:

```
Campo Maior

118 seções

112 🟢

4 🟡

2 🔴
```

Ao abrir um local de votação:

```
Escola X

12 seções

11 funcionando

1 problema
```

Ao abrir uma seção:

Timeline

Problemas

Mensagens

Responsáveis

Histórico

---

# Mapa Operacional

Criar painel mostrando:

- situação de cada local;
- situação de cada seção;
- equipes em deslocamento;
- urnas em trânsito;
- mídias pendentes;
- problemas ativos.

---

# Logística

Criar acompanhamento em tempo real de:

Urnas

```
Depósito

↓

Transporte

↓

Local

↓

Instalada

↓

Encerrada

↓

Retorno
```

Mídias

```
Local

↓

Coordenador

↓

Cartório
```

---

# Equipes

Controlar:

- deslocamento;
- atendimento;
- retorno;
- tempo médio;
- problemas atendidos.

---

# Dashboard TV

Criar painel simplificado para exibição contínua.

Mostrar apenas:

- quantidade de seções abertas;
- problemas ativos;
- urnas substituídas;
- mídias pendentes;
- equipes em atendimento.

Atualização em tempo real.

---

# Estado Operacional

Cada seção deverá possuir um estado derivado dos eventos.

Exemplo:

```
OPERANDO

ATENÇÃO

PROBLEMA

ENCERRADA
```

O estado nunca será informado manualmente.

Será calculado automaticamente.

---

# Observabilidade

Toda alteração deverá gerar evento.

Todo evento deverá gerar log.

Todo log deverá possuir timestamp do servidor.

Nunca utilizar Date.now().

Sempre utilizar:

```
sime_now()
```

---

# Integração com Heartbeat

O Hermes enviará heartbeat periódico.

Além das informações de infraestrutura, deverá informar:

- última mensagem recebida;
- último evento enviado;
- fila pendente;
- versão instalada;
- commit atual.

---

# Atualização Automática do Hermes

Criar serviço independente.

```
services/

updater.js
```

Responsabilidades:

- verificar novas versões;
- baixar atualização;
- instalar dependências;
- validar;
- reiniciar;
- registrar evento.

Nunca incorporar essa lógica diretamente ao index.js.

---

# Estrutura Recomendada do Hermes

```
hermes/

core/

bootstrap.js

scheduler.js

eventBus.js

services/

heartbeat.js

logger.js

updater.js

storage.js

monitor.js

modules/

whatsapp/

telegram/

campanhas/

eventos/

diagnostico/

backup/

plugins/
```

O index.js deverá apenas inicializar os serviços.

---

# Storage

Criar camada única.

```
storage.upload()

storage.download()

storage.delete()

storage.list()
```

Implementações:

- Google Drive
- Supabase Storage
- Local

Os demais módulos nunca deverão conhecer o destino do arquivo.

---

# Objetivo Final

Ao final desta evolução o SIME deverá representar o estado completo da eleição em tempo real.

Qualquer evento ocorrido em qualquer seção deverá refletir automaticamente em:

- Dashboard
- Timeline
- Estado da Seção
- Estado do Local
- Alertas
- Relatórios
- Painéis
- Histórico
- Logs

Todo o sistema deverá ser orientado por eventos, reduzindo o acoplamento entre módulos e facilitando futuras expansões.

---

# Prioridade de Implementação

## Fase 1

- Motor de Eventos
- Event Bus
- Timeline
- Estado da Seção

## Fase 2

- Painel Operacional
- Dashboard TV
- Logística
- Equipes

## Fase 3

- Atualização Automática do Hermes
- Heartbeat completo
- Storage
- Diagnóstico
- Backup

---

**Observação Importante**

Durante toda a implementação preservar a arquitetura existente, evitando regressões.

As novas funcionalidades deverão ser adicionadas como módulos desacoplados, mantendo compatibilidade com o modelo atual e reutilizando os componentes já implementados sempre que possível.

---

## Nota de status (04/08/2026, sessão que recebeu este documento)

Ainda **não implementado** — este documento define a direção, não o estado
atual. Nada do Motor de Eventos, Event Bus, Timeline por seção, Painel
Operacional, Dashboard TV ou reestruturação do Hermes em `core/services/
modules` existe no código hoje.

O único item concreto já resolvido a partir deste pedido: o comando `status`
do Hermes (WhatsApp) agora responde também com um bloco "🧩 Módulos do
Hermes" — WhatsApp, Telegram, fallback IA, integração com o SIME, fila de
pânico, disparo em massa, detecção de eventos de dia D e monitor de
temperatura, cada um com seu estado. Ver `HERMES_RUNTIME.md` no repositório
`bernardobbs/hermes` pro runtime real e `CLAUDE.md` pro estado de cada skill.

Antes de começar a Fase 1 (Motor de Eventos / Event Bus), vale revisar com
calma: schema novo no Supabase pra eventos/timeline, quais dos 16 módulos
HTML de frontend passam a consumir o estado calculado em vez do estado bruto
das tabelas, e se o Realtime atual das TVs muda de fonte (hoje lê
`sime_mesa_estado` direto) ou passa a ler o estado derivado do Motor de
Eventos.
