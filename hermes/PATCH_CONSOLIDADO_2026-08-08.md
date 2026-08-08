# Patch consolidado do Hermes (Raspberry Pi) — preparado em 08/08/2026

**Aplicar este documento inteiro de uma vez, nesta ordem.** Ele substitui
`PATCH_PENDENTE_2026-08-08.md` e `PATCH_MULTI_ZONA_MESMO_PI.md`, que ficam só
como referência de contrato/rationale — o código deles ficou desatualizado
assim que o patch multi-zona mudou a assinatura de `services/simeApi.js`
(toda chamada passa a exigir `zona`), o que os dois patches anteriores não
previam sozinhos.

Junta três features, nesta ordem de dependência:
1. **Multi-zona** — base: os dois números do Pi passam a monitorar grupos e
   filas das duas zonas (7ª e 94ª), não só a 7ª.
2. **Autoatendimento por telefone** — depende de (1) pra saber com qual zona
   falar quando alguém manda "oi" no privado.
3. **Escalonamento por papel** — depende de (1) pro cache de contatos ser
   por zona.

Como sempre: **sem acesso ao `index.js` real** (só existe no Pi, nunca foi
versionado — ver `hermes/HERMES_RUNTIME.md`), isto é especificação + código
pronto pra colar, não um diff aplicado. Ajustar aos nomes reais de
função/import que estiverem no arquivo na hora de aplicar.

---

## Trade-off a aceitar antes de começar

Confirmado: **só existe um Raspberry Pi**. Não há caminho pra redundância de
hardware — a escolha real é "94ª sem Hermes nenhum" vs. "94ª e 7ª no mesmo
Pi, com o mesmo raio de impacto se ele cair". Este patch assume que a decisão
foi pela segunda opção. Se um dia surgir um segundo dispositivo físico, o
`zonaDoGrupo()`/`HERMES_SECRET_ZONA_*` deste patch continuam servindo — só
mudaria onde cada processo roda.

O que continua **sem mitigação**, mesmo com este patch:
- Pi cair (energia/Wi-Fi/SD/processo travado) → as duas zonas perdem
  WhatsApp ao mesmo tempo.
- Fila de pânico e disparo em massa só rodam em quem estiver no papel
  `principal` — se ele cair, as duas filas pausam até o failover local
  completar (instantâneo) ou, numa queda do Pi inteiro, até intervenção
  manual.

---

## Passo 0 — manual, antes de tocar em código

1. **Backup dos arquivos que vão mudar** (rodar no Pi):
   ```bash
   cd /home/admin/hermes-agent
   cp .env .env.bak
   cp config.js config.js.bak
   cp services/simeApi.js services/simeApi.js.bak
   cp modules/whatsapp/router.js modules/whatsapp/router.js.bak
   cp modules/whatsapp/notificacoes.js modules/whatsapp/notificacoes.js.bak
   cp modules/campanhas/dispatch.js modules/campanhas/dispatch.js.bak
   ```
2. **Os dois números de WhatsApp precisam estar, cada um, dentro de todos os
   grupos monitorados das duas zonas.** Hoje muito provavelmente só estão
   nos grupos da 7ª. Adicionar manualmente aos grupos da 94ª (principal e
   backup) antes de testar — sem isso, nenhuma mensagem da 94ª chega, mesmo
   com o código certo.

---

## Passo 1 — `.env`

```diff
-HERMES_SECRET=...
+HERMES_SECRET_ZONA_7=...
+HERMES_SECRET_ZONA_94=...
```

Valores: os mesmos já cadastrados na Vercel (`HERMES_SECRET_ZONA_7`/
`HERMES_SECRET_ZONA_94` — ver `CLAUDE.md`, seção de variáveis de ambiente).
Resto do `.env` (`SIME_API_URL`, `DISPATCH_ATIVO`, `HERMES_BACKUP_ATIVO=true`,
etc.) continua igual.

---

## Passo 2 — `config.js`: grupos e admins por zona

```diff
-const GRUPOS_MONITORADOS = [
-  '1203630XXXXXXXXX@g.us', // grupo X
-  '1203630YYYYYYYYY@g.us', // grupo Y
-];
-const ADMIN_NUMBERS = ['5586999990001', '5586999990002'];
+const GRUPOS_MONITORADOS = {
+  '7':  ['1203630XXXXXXXXX@g.us', /* ...grupos da 7ª... */],
+  '94': ['1203630ZZZZZZZZZ@g.us', /* ...grupos da 94ª... */],
+};
+
+// Nível base de escalonamento (Monitor de Campo) — hoje é uma lista única;
+// como as duas zonas têm cartórios/pessoas diferentes, o mais correto é
+// separar por zona. Ajustar aos números reais de cada cartório.
+const ADMIN_NUMBERS_POR_ZONA = {
+  '7':  ['5586999990001', '5586999990002'], // números que já estavam em ADMIN_NUMBERS
+  '94': [], // preencher com os números do cartório da 94ª
+};
+
+// zonaDoGrupo(grupoId) → '7' | '94' | null (grupo não monitorado)
+function zonaDoGrupo(grupoId) {
+  for (const [zona, grupos] of Object.entries(GRUPOS_MONITORADOS)) {
+    if (grupos.includes(grupoId)) return zona;
+  }
+  return null;
+}
+
+module.exports = { /* ...exports já existentes..., */ GRUPOS_MONITORADOS, ADMIN_NUMBERS_POR_ZONA, zonaDoGrupo };
```

> **Decisão sua, não mecânica**: se `ADMIN_NUMBERS` hoje já mistura gente das
> duas zonas (pouco provável, mas confirmar), ajustar a divisão acima. Se a
> 94ª ainda não tem ninguém em `ADMIN_NUMBERS_POR_ZONA['94']`, a fila de
> pânico dela roda mesmo assim — só o nível base (<10 min) fica sem
> destinatário até alguém ser cadastrado; o escalonamento (Gestor de
> Problemas/Chefe de Cartório, Passo 5) já resolve pelo `hermes-contatos` e
> não depende disso.

Ajustar ao formato real de `config.js` — o ponto essencial é sair de "lista
única" pra "lista por zona".

---

## Passo 3 — `services/simeApi.js`: cliente único, com zona

Substituir o cliente atual (que hoje deve montar o header `Authorization`
com um `HERMES_SECRET` fixo) por este, que cobre as três features:

```js
function secretDaZona(zona) {
  const mapa = { '7': process.env.HERMES_SECRET_ZONA_7, '94': process.env.HERMES_SECRET_ZONA_94 };
  return mapa[zona];
}

async function postHermesApi(endpoint, zona, body) {
  const secret = secretDaZona(zona);
  if (!secret) throw new Error(`Sem HERMES_SECRET pra zona ${zona}`);
  const resp = await fetch(`${process.env.SIME_API_URL}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  return resp;
}

// ── Autoatendimento por telefone ──
// consultarAutoatendimento(zona, telefone) → { ok, encontrado, mensagem_wa } | { ok:false, mensagem_wa } | null (erro de rede)
async function consultarAutoatendimento(zona, telefone) {
  const resp = await postHermesApi('hermes-mesarios', zona, { acao: 'consultar', telefone });
  if (resp.status === 404) {
    const out = await resp.json().catch(() => ({}));
    return { ok: false, mensagem_wa: out.mensagem_wa || 'Não encontrei seu cadastro. Fale com o cartório.' };
  }
  if (!resp.ok) return null; // erro de rede/servidor — melhor não responder que responder errado
  return resp.json();
}

// ── Escalonamento por papel — cache por zona (TTL 5 min) ──
const _contatosCache = {};
const _contatosCacheEm = {};
const CONTATOS_TTL_MS = 5 * 60 * 1000;
async function buscarContatosEscalonamento(zona) {
  const agora = Date.now();
  if (_contatosCache[zona] && (agora - (_contatosCacheEm[zona] || 0)) < CONTATOS_TTL_MS) return _contatosCache[zona];
  const resp = await postHermesApi('hermes-contatos', zona, { acao: 'listar' });
  if (!resp.ok) return _contatosCache[zona] || { gestor_prob: [], coordenador: [] };
  const out = await resp.json();
  _contatosCache[zona] = out.contatos;
  _contatosCacheEm[zona] = agora;
  return _contatosCache[zona];
}

module.exports = {
  /* ...exports já existentes, agora todos aceitando `zona` como parâmetro... */
  postHermesApi,
  consultarAutoatendimento,
  buscarContatosEscalonamento,
};
```

**Todo call site já existente** — confirmação/recusa de mesário
(`hermes-mesarios acao=confirmar|recusar|substituir|atualizar`), eventos de
seção (`hermes-update`), heartbeat (`hermes-heartbeat`) — precisa passar a
receber `zona` de quem chamou e usar `postHermesApi(endpoint, zona, body)`
em vez do fetch fixo de antes. Esse é o ponto de maior mudança mecânica no
arquivo.

---

## Passo 4 — `modules/whatsapp/router.js`: resolver zona por grupo e por DM

```js
// ── Mensagem de GRUPO ──
const zona = zonaDoGrupo(mensagem.key.remoteJid);
if (!zona) return; // grupo não monitorado — mesmo comportamento de hoje

// ...eventos.js (detecção de dia D) e confirmacao.js (keywords sim/não/
// substituto) passam a receber `zona` e usar postHermesApi(_, zona, _) em
// vez do client antigo...

// ── Mensagem INDIVIDUAL (DM) ──
// Continua: comandos administrativos (status/fila/velocidade/reiniciar/
// trocar papel) só respondem a ADMIN_NUMBERS_POR_ZONA — juntar as duas
// listas pra esse teste, já que um admin pode ser de qualquer zona:
const todosAdmins = [...ADMIN_NUMBERS_POR_ZONA['7'], ...ADMIN_NUMBERS_POR_ZONA['94']];
const isAdmin = todosAdmins.includes(telefoneRemetente);

if (isAdmin) {
  // ...fluxo de comandos administrativos, igual hoje...
} else {
  // Autoatendimento por telefone — não intercepta se parecer resposta de
  // confirmação em andamento (SIM/NÃO/substituto), que continua caindo no
  // fluxo normal de keywords.js.
  const pareceConfirmacao = /^(sim|s|não|nao|n|substitu[ií]r?)\b/i.test(texto.trim());
  if (!pareceConfirmacao) {
    // Telefone sozinho não diz a zona da pessoa — tenta a 7ª primeiro
    // (maior volume histórico) e só tenta a 94ª se não achar. Dois
    // roundtrips no pior caso, aceitável pra um "oi" espontâneo.
    let resultado = await consultarAutoatendimento('7', telefoneRemetente);
    if (!resultado || resultado.ok === false) {
      const tentativa94 = await consultarAutoatendimento('94', telefoneRemetente);
      if (tentativa94 && tentativa94.ok !== false) resultado = tentativa94;
    }
    if (resultado) await sock.sendMessage(remetente, { text: resultado.mensagem_wa });
    // resultado null nas duas tentativas (erro de rede) → silêncio, como hoje
    return;
  }
  // ...resposta de confirmação: cai no fluxo de keywords.js, que precisa
  // saber em qual zona gravar. Como a pessoa está respondendo a uma
  // confirmação que o Hermes mesmo mandou antes, a zona já é conhecida do
  // contexto da campanha/verificação que originou aquela mensagem — não
  // precisa do mesmo "tenta 7 depois 94" do autoatendimento.
}
```

---

## Passo 5 — `modules/whatsapp/notificacoes.js`: fila de pânico por zona, com escalonamento

```js
for (const zona of ['7', '94']) {
  const contatos = await buscarContatosEscalonamento(zona);
  const resp = await postHermesApi('hermes-notificacoes', zona, { acao: 'pendentes' });
  if (!resp.ok) continue;
  const { notificacoes } = await resp.json();

  for (const n of notificacoes) {
    const destinatarios = new Set(ADMIN_NUMBERS_POR_ZONA[zona] || []);
    if (n.idade_s >= 600)  contatos.gestor_prob.forEach((t) => destinatarios.add(t));
    if (n.idade_s >= 1800) contatos.coordenador.forEach((t) => destinatarios.add(t));

    for (const telefone of destinatarios) {
      await sock.sendMessage(`${telefone}@s.whatsapp.net`, { text: montarMensagem(n) });
      await new Promise((r) => setTimeout(r, 3000)); // mesmo intervalo anti-flood de sempre
    }
    await postHermesApi('hermes-notificacoes', zona, { acao: 'confirmar', ids: [n.id] });
  }
}
```

`Set` evita mandar duas vezes pro mesmo número quando ele está em
`ADMIN_NUMBERS_POR_ZONA[zona]` **e** cadastrado como `telefone_whatsapp` de
um dos dois perfis de escalonamento.

---

## Passo 6 — `modules/campanhas/dispatch.js`: disparo em massa por zona

```js
for (const zona of ['7', '94']) {
  if (!process.env.DISPATCH_ATIVO || process.env.DISPATCH_ATIVO !== 'true') continue; // flag continua valendo pras duas
  const resp = await postHermesApi('hermes-campanhas', zona, { acao: 'pendentes' });
  if (!resp.ok) continue;
  const { campanhas } = await resp.json();
  for (const c of campanhas) {
    // ...envio, igual hoje, só que via postHermesApi(_, zona, _) pra confirmar/marcar erro...
  }
}
```

---

## Passo 7 — `core/bootstrap.js`: sem mudança na arbitragem

`!papel.souBackup()` continua controlando quem drena as filas (agora as duas
zonas dentro do mesmo loop) — não precisa duplicar a lógica de papel por
zona, é a mesma sessão WhatsApp ativa processando grupos/filas de zonas
diferentes.

---

## Teste antes de aplicar em produção

1. **Grupo da 7ª**: mandar "seção 63 encerrada" → grava como evento da 7ª,
   como sempre.
2. **Grupo de teste da 94ª**: mesma mensagem → grava como evento da 94ª
   (conferir no Admin da 94ª, não da 7ª — erro aqui é o pior caso, dado na
   zona errada).
3. **Autoatendimento**: "oi" de um telefone cadastrado só na 7ª → responde
   certo na primeira tentativa. "oi" de um telefone cadastrado só na 94ª →
   responde certo na segunda tentativa (confirma que o fallback funciona).
   "oi" de número não cadastrado em nenhuma → mensagem de 404, não silêncio.
4. **Escalonamento**: forçar (em ambiente de teste) uma notificação com
   `idade_s >= 600` em cada zona → confirma que o Gestor de Problemas
   certo (por zona) recebe, e não o da outra zona.
5. **Failover**: derrubar o socket principal (`pm2 restart hermes` ou
   forçar logout) e confirmar que o backup assume grupos **das duas
   zonas**, não só da 7ª.
6. **DM de admin**: confirmar que `status`/`fila`/etc. continuam
   funcionando pra admins de qualquer uma das duas zonas
   (`ADMIN_NUMBERS_POR_ZONA` unificado no Passo 4).
7. `pm2 logs --nostream` inteiro, procurando qualquer sinal de mensagem da
   7ª sendo tratada como 94ª ou vice-versa.

---

## Rollback

```bash
cd /home/admin/hermes-agent
cp .env.bak .env
cp config.js.bak config.js
cp services/simeApi.js.bak services/simeApi.js
cp modules/whatsapp/router.js.bak modules/whatsapp/router.js
cp modules/whatsapp/notificacoes.js.bak modules/whatsapp/notificacoes.js
cp modules/campanhas/dispatch.js.bak modules/campanhas/dispatch.js
pm2 restart hermes --update-env
```

Os endpoints do lado SIME (`hermes-mesarios`, `hermes-contatos`, etc.)
continuam disponíveis e sem efeito colateral se ninguém os chamar — reverter
o Pi não exige nenhuma ação do lado Vercel/Supabase.
