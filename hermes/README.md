# Hermes Agent — configuração para o SIME

O Hermes é o agente de IA que lê os grupos e DMs do WhatsApp, atualiza o SIME
com o que detecta e envia as notificações de pânico.

## O ponto que define toda a configuração

**O Hermes nunca precisa ser alcançado de fora.** Ele é sempre quem inicia a
conexão — tanto para escrever no SIME quanto para buscar notificações a enviar:

```
Hermes ──POST──▶ /api/hermes-update        escreve eventos de seção
Hermes ──POST──▶ /api/hermes-mesarios      lê mesários, grava confirmação
Hermes ──POST──▶ /api/hermes-notificacoes  busca a fila de notificações
```

Conexão de saída passa por qualquer internet residencial. Por isso o Hermes
roda bem num **PC do cartório atrás do roteador**, sem túnel, sem abrir porta,
sem IP fixo e sem domínio.

## As duas coisas que precisam bater

Um segredo por zona, com o **mesmo valor** em dois lugares:

| Onde | Nome |
|---|---|
| Vercel (variáveis de ambiente) | `HERMES_SECRET_ZONA_7`, `HERMES_SECRET_ZONA_94` |
| Hermes (`~/.hermes/config.env`) | idem, um por instância |

Cada instância do Hermes atende **uma zona** e só enxerga a fila dela.

Para gerar um segredo forte:

```bash
openssl rand -base64 32
```

> **Não defina `HERMES_URL` na Vercel.** Ela só serve para o SIME empurrar a
> notificação direto, o que exige um Hermes alcançável. Sem ela, o SIME apenas
> enfileira — que é o modo correto para o Hermes atrás de NAT.

## Instalação

### Linux / WSL

```bash
cd hermes
ZONA=7 SIME_SECRET='<o segredo da zona 7>' bash setup.sh
```

Depois: `hermes gateway qr` para parear o WhatsApp.

### Windows, sem WSL

Os passos são os mesmos do script; muda só como o serviço fica de pé.

1. Instalar o Hermes conforme a documentação dele para Windows.
2. Criar `%USERPROFILE%\.hermes\config.env`:
   ```
   SIME_VERCEL_URL=https://sime-cyan.vercel.app
   SIME_ZONA=7
   HERMES_SECRET_ZONA_7=<o segredo da zona 7>
   SIME_POLL_INTERVALO=30
   ```
3. Copiar as quatro skills (`SIME_hermes_skill_*.md`) para
   `%USERPROFILE%\.hermes\skills\sime\`.
4. Apontar os endpoints:
   ```
   hermes config set sime.endpoint_update       https://sime-cyan.vercel.app/api/hermes-update
   hermes config set sime.endpoint_mesarios     https://sime-cyan.vercel.app/api/hermes-mesarios
   hermes config set sime.endpoint_notificacoes https://sime-cyan.vercel.app/api/hermes-notificacoes
   hermes config set sime.secret                <o segredo da zona>
   hermes config set sime.poll_intervalo        30
   ```
5. Parear o WhatsApp: `hermes gateway qr`
6. Deixar rodando 24/7 — Agendador de Tarefas com "ao iniciar o sistema" e
   "reiniciar em caso de falha", ou uma ferramenta como o NSSM para registrar
   como serviço do Windows.

## Testar sem esperar um pânico real

```bash
curl -sS -X POST https://sime-cyan.vercel.app/api/hermes-notificacoes \
  -H "Authorization: Bearer <SEU_SEGREDO>" \
  -H 'Content-Type: application/json' \
  -d '{"acao":"pendentes"}'
```

- `{"ok":true,"notificacoes":[]}` → autenticou; a fila está vazia
- `401` → o segredo não bate com o da Vercel
- Erro de rede → confira o `SIME_VERCEL_URL`

## O que esperar no dia da eleição

- **O PC precisa ficar ligado**, com internet e o WhatsApp pareado. Se cair,
  as notificações **não se perdem**: ficam em `sime_notificacoes` e saem quando
  o Hermes voltar.
- **Atraso de até um ciclo** (30s) entre o pânico e o WhatsApp. Para um
  escalonamento que começa em 10 minutos, é irrelevante.
- **Considere um número dedicado** para o Hermes, em vez do WhatsApp pessoal de
  alguém do cartório.

## Skills

| Arquivo | O que faz |
|---|---|
| `SIME_hermes_skill_monitor.md` | Detecta 12 tipos de evento em linguagem natural |
| `SIME_hermes_skill_updater.md` | Persiste os eventos via `/api/hermes-update` |
| `SIME_hermes_skill_mesarios.md` | Consulta mesários e grava a confirmação |
| `SIME_hermes_skill_notificar.md` | Drena a fila e envia os WhatsApps |
