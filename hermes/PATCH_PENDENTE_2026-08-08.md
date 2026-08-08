# Patches pendentes pro Hermes (Raspberry Pi) — preparado em 08/08/2026

> **Superado por `hermes/PATCH_CONSOLIDADO_2026-08-08.md`.** Depois de
> decidir cobrir as duas zonas no mesmo Pi, o patch multi-zona mudou a
> assinatura de `services/simeApi.js` (toda chamada passa a exigir `zona`),
> o que o código deste documento não previa. **Aplicar o consolidado, não
> este** — o texto abaixo continua válido só como contrato/rationale de cada
> ação (`consultar`, `hermes-contatos`), não como código pronto pra colar.

Este documento existe porque **o `index.js` real do Hermes nunca foi
versionado em repositório nenhum** — ele só existe no Raspberry Pi
(`/home/admin/hermes-agent`, ver `hermes/HERMES_RUNTIME.md`). Tudo que seguir
foi escrito sem acesso ao arquivo real: é a especificação + código pronto pra
colar, não um diff aplicado. Adaptar aos nomes exatos de função/import que
estiverem no Pi na hora de aplicar — a estrutura de arquivos abaixo é a
documentada em `HERMES_RUNTIME.md` (reconciliada em 03/08/2026), mas pode ter
mudado desde então.

Duas coisas pendentes, ambas com o lado SIME (Vercel + Supabase) **já pronto
em produção**; só falta o lado Hermes chamar:

| # | Feature | Endpoint (já em produção) | Onde plugar no Pi |
|---|---|---|---|
| A | Autoatendimento por telefone | `POST /api/hermes-mesarios {acao:'consultar'}` | `modules/whatsapp/router.js` (conversa individual) |
| B | Escalonamento por papel | `POST /api/hermes-contatos {acao:'listar'}` | `modules/whatsapp/notificacoes.js` (drena da fila de pânico) |

Aplicar os dois é independente — dá pra fazer só um e deixar o outro pra
depois.

---

## A. Autoatendimento por telefone ("oi" → função + seção)

### Objetivo

Hoje, quando um mesário manda "oi" (ou qualquer primeira mensagem) no privado
do Hermes, **nada responde** — desde 06/08/2026 o canal de DM inteiro ficou
restrito a `ADMIN_NUMBERS` (ver `HERMES_RUNTIME.md` seção 4, nota "DM
restrita"), porque o gatilho antigo de busca por **nome** (`buscar_nome`,
qualquer DM de 2+ palavras) disparava em cima de conversa comum ("Bom dia",
"É Bernardo do cartório") e respondia "não encontrei ninguém chamado
<frase>" — confuso e ruim, flagrado em campo.

`acao:'consultar'` é diferente e mais seguro: casa por **telefone exato** (o
número que mandou a mensagem), não por texto solto — não tem como confundir
"bom dia" com um nome. Por isso dá pra reabrir a porta só pra esta ação, sem
reviver o bug de 06/08.

### Regra de disparo

Só chamar `consultar` quando:
1. É conversa **individual** (não grupo).
2. O remetente **não está em `ADMIN_NUMBERS`** (admin já tem seu próprio menu
   — `status`/`fila`/etc.; não precisa do autoatendimento).
3. A mensagem **não é** uma resposta de confirmação em andamento (SIM/NÃO/
   substituto — isso já cai no fluxo de `keywords.js`/`confirmacao.js`, que
   continua funcionando igual).

Se as três baterem, chama `consultar` pelo telefone do remetente. Isso
substitui o silêncio total de hoje por uma resposta útil, sem reabrir o
gatilho por nome que causou o incidente.

### Código — nova função em `services/simeApi.js` (ou onde ficar o cliente dos endpoints)

```js
// consultarAutoatendimento(telefone) → { ok, encontrado, mensagem_wa } | null em erro de rede
async function consultarAutoatendimento(telefone) {
  const resp = await fetch(`${process.env.SIME_API_URL}/api/hermes-mesarios`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.HERMES_SECRET}`,
    },
    body: JSON.stringify({ acao: 'consultar', telefone }),
  });
  if (resp.status === 404) {
    const out = await resp.json().catch(() => ({}));
    return { ok: false, mensagem_wa: out.mensagem_wa || 'Não encontrei seu cadastro. Fale com o cartório.' };
  }
  if (!resp.ok) return null; // erro de rede/servidor — não responder nada é melhor que responder errado
  return resp.json();
}

module.exports = { /* ...exports já existentes..., */ consultarAutoatendimento };
```

Ajustar o `require`/`import` conforme o padrão real do arquivo (`HERMES_RUNTIME.md`
diz que `services/simeApi.js` já é "o cliente único dos endpoints
`/api/hermes-*`" — se ele já expõe algo como `postJSON(endpoint, body)`,
reusar isso em vez de duplicar o `fetch` acima).

### Código — no handler de DM (`modules/whatsapp/router.js` ou onde a cadeia de
`index.js`/seção 4 do `HERMES_RUNTIME.md` decide "conversa individual → comandos")

```js
// Depois de tentar os comandos administrativos e ANTES de desistir em
// silêncio — troca o "nenhuma resposta" atual por autoatendimento pra quem
// não é admin.
if (!isAdmin) {
  // não interceptar se for claramente uma resposta de confirmação em
  // andamento (SIM/NÃO/substituto) — deixa cair no fluxo de keywords.js normal
  const pareceConfirmacao = /^(sim|s|não|nao|n|substitu[ií]r?)\b/i.test(texto.trim());
  if (!pareceConfirmacao) {
    const resultado = await consultarAutoatendimento(telefoneRemetente);
    if (resultado) {
      await sock.sendMessage(remetente, { text: resultado.mensagem_wa });
    }
    // resultado === null (erro de rede) → não responde nada, silêncio como hoje
    return;
  }
}
```

`telefoneRemetente` precisa estar no mesmo formato que `sime_atores.telefone_whatsapp`
(dígitos, com DDI) — `consultar` já tolera variação de DDI/DDD internamente
(mesma regra de `confirmar`/`recusar`), então não precisa normalizar tudo à
mão, só extrair os dígitos do JID.

### Log

Cada chamada de `consultar` já é logada no lado SIME
(`hermes_mesarios`/`sime_logs`, ver `hermes/SIME_hermes_skill_mesarios.md`).
No Hermes, manter o padrão de log já usado pras outras ações — uma linha em
`pm2 logs` com telefone (mascarado se o padrão já mascarar) e se encontrou ou
não, útil pra medir quantos "oi" viram atendimento de verdade.

### Teste antes de aplicar em produção

1. Mandar "oi" de um número **cadastrado** em `sime_atores` (mesário real de
   teste) → deve responder com função + seção.
2. Mandar "oi" de um número **não cadastrado** → deve responder com a
   `mensagem_wa` de 404 ("fale com o cartório"), não silêncio nem erro.
3. Mandar "bom dia" **de um número admin** (`ADMIN_NUMBERS`) → não deve
   disparar `consultar` (admin usa o menu normal).
4. Responder "sim" a uma confirmação em andamento → confirma normalmente,
   **não** deve cair no autoatendimento (checar que o fluxo de
   `keywords.js` continua intacto).

---

## B. Escalonamento por papel (Gestor de Problemas / Chefe de Cartório)

Contrato completo, exemplos de resposta e tabela de `idade_s` →
destinatário: `hermes/SIME_hermes_skill_escalonamento.md`. Resumo do que
muda no Pi:

### Código — nova função em `services/simeApi.js`

```js
let _contatosCache = null;
let _contatosCacheEm = 0;
const CONTATOS_TTL_MS = 5 * 60 * 1000; // 5 min — não precisa ser em tempo real

async function buscarContatosEscalonamento() {
  const agora = Date.now();
  if (_contatosCache && (agora - _contatosCacheEm) < CONTATOS_TTL_MS) return _contatosCache;
  const resp = await fetch(`${process.env.SIME_API_URL}/api/hermes-contatos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.HERMES_SECRET}`,
    },
    body: JSON.stringify({ acao: 'listar' }),
  });
  if (!resp.ok) return _contatosCache || { gestor_prob: [], coordenador: [] }; // cache velho > nada
  const out = await resp.json();
  _contatosCache = out.contatos;
  _contatosCacheEm = agora;
  return _contatosCache;
}

module.exports = { /* ...exports já existentes..., */ buscarContatosEscalonamento };
```

### Código — em `modules/whatsapp/notificacoes.js`, no loop que drena `/api/hermes-notificacoes` e envia pra `ADMIN_NUMBERS`

```js
const contatos = await buscarContatosEscalonamento();
for (const n of notificacoesPendentes) {
  const destinatarios = new Set(ADMIN_NUMBERS); // nível base — continua igual
  if (n.idade_s >= 600)  contatos.gestor_prob.forEach((t) => destinatarios.add(t));
  if (n.idade_s >= 1800) contatos.coordenador.forEach((t) => destinatarios.add(t));

  for (const telefone of destinatarios) {
    await sock.sendMessage(`${telefone}@s.whatsapp.net`, { text: montarMensagem(n) });
    await new Promise((r) => setTimeout(r, 3000)); // mesmo intervalo anti-flood já usado
  }
  await confirmarNotificacao(n.id); // função que já existe — chama {acao:'confirmar', ids:[n.id]}
}
```

`Set` evita mandar duas vezes pro mesmo número quando ele está em
`ADMIN_NUMBERS` **e** cadastrado como `telefone_whatsapp` de um dos dois
perfis.

### Teste antes de aplicar em produção

1. Zerar (ou usar zona de teste) e confirmar que `contatos.gestor_prob`/
   `coordenador` vêm vazios quando ninguém cadastrou telefone — o loop deve
   continuar mandando só pra `ADMIN_NUMBERS`, sem quebrar.
2. Cadastrar um telefone de teste como Gestor de Problemas na aba Equipe do
   Admin (`SIME_admin.html`) e forçar (manualmente, no banco de teste) uma
   notificação com `idade_s >= 600` → esse número deve receber, além dos
   `ADMIN_NUMBERS`.
3. Repetir com `idade_s >= 1800` pro Chefe de Cartório.
4. Conferir que o mesmo número não recebe a mensagem duplicada se estiver
   nas duas listas.

---

## Rollback

Nenhum dos dois patches tem migração de schema no Pi (as tabelas/colunas já
existem e já estão em produção do lado SIME desde 08/08/2026) — reverter é só
remover/comentar as chamadas novas em `router.js`/`notificacoes.js` e dar
`pm2 restart hermes --update-env`. Os endpoints (`hermes-contatos`,
`hermes-mesarios acao=consultar`) continuam disponíveis e não têm efeito
colateral se ninguém os chamar.
