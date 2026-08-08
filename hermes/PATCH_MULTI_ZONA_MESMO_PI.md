# Patch: um Pi, dois números, cobrindo as duas zonas — preparado em 08/08/2026

## Contexto e trade-off — ler antes de aplicar

Hoje o Pi roda **um processo** (`hermes`), com `HERMES_BACKUP_ATIVO=true`
ligando um segundo socket Baileys — mas os dois compartilham o mesmo
`.env`, inclusive o mesmo `HERMES_SECRET` (= `HERMES_SECRET_ZONA_7`). Isso
amarra os dois números à 7ª Zona: o segundo número é redundância de
**sessão**, não cobertura de mais uma zona.

Este patch muda isso: os dois números passam a monitorar grupos **das duas
zonas** (7ª e 94ª), com o Hermes decidindo por grupo qual zona chamar no
Vercel. Mas atenção ao que isso **não** resolve — é o mesmo Pi, mesmo
processo, mesmo cartão SD:

| Falha | Antes (só 7ª no Pi) | Depois (7ª + 94ª no mesmo Pi) |
|---|---|---|
| Sessão de UM número cai (banido/deslogado) | o outro número assume, 7ª continua monitorada | o outro número assume, **as duas zonas** continuam monitoradas |
| Pi inteiro cai (energia/Wi-Fi/SD/processo travado) | só a 7ª perde WhatsApp | **as duas zonas** perdem WhatsApp ao mesmo tempo |

Ou seja: juntar as duas zonas no mesmo Pi **aumenta o raio de impacto** de uma
queda do Pi em si, que já era — e continua sendo — um ponto único de falha
sem solução real (só existe um Raspberry Pi disponível). Se isso for uma
preocupação forte, a alternativa é uma segunda instância/dispositivo físico
pra 94ª, não esse patch. Decisão sua.

Outra restrição que se mantém (documentada em `HERMES_RUNTIME.md`, "escopo
deliberadamente restrito à monitoria de grupo"): fila de pânico e disparo em
massa só rodam em quem estiver no papel `principal` no momento — se ele cair,
essas duas filas ficam paradas até o failover completar (local e instantâneo)
ou, numa queda do Pi inteiro, até intervenção manual. Com as duas zonas no
mesmo processo, uma queda do `principal` pausa a fila de pânico **das duas
zonas** ao mesmo tempo (antes pausava só a da 7ª).

Se, mesmo assim, o objetivo for cobertura das duas zonas com o que já está
configurado, segue o patch.

---

## Passo manual no WhatsApp (fazer antes do código)

**Os dois números precisam estar, cada um, dentro de todos os grupos
monitorados das duas zonas** — 7ª e 94ª. Hoje, muito provavelmente, o
principal só está nos grupos da 7ª e o backup também só foi adicionado aos
grupos da 7ª (era esse o escopo original do `HERMES_BACKUP_ATIVO`). Conferir
e adicionar manualmente:
- Principal → grupos da 94ª (além dos da 7ª, que já deve ter).
- Backup → grupos da 94ª (além dos da 7ª).

Sem isso, o código abaixo não recebe mensagem nenhuma da 94ª, mesmo
corrigido — WhatsApp não entrega mensagem de grupo pra número que não é
membro.

## 1. `.env` — dois segredos em vez de um

```diff
-HERMES_SECRET=...
+HERMES_SECRET_ZONA_7=...
+HERMES_SECRET_ZONA_94=...
```

Os valores são os mesmos já cadastrados na Vercel (`HERMES_SECRET_ZONA_7`/
`HERMES_SECRET_ZONA_94`, ver `CLAUDE.md` → variáveis de ambiente). Depois de
editar, `pm2 restart hermes --update-env` (senão o processo continua com o
`.env` antigo em cache).

## 2. `config.js` — grupos monitorados por zona

```diff
-const GRUPOS_MONITORADOS = [
-  '1203630XXXXXXXXX@g.us', // grupo X
-  '1203630YYYYYYYYY@g.us', // grupo Y
-];
+const GRUPOS_MONITORADOS = {
+  '7':  ['1203630XXXXXXXXX@g.us', /* ...grupos da 7ª... */],
+  '94': ['1203630ZZZZZZZZZ@g.us', /* ...grupos da 94ª... */],
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
+module.exports = { /* ...exports já existentes..., */ GRUPOS_MONITORADOS, zonaDoGrupo };
```

Ajustar ao formato real de `config.js` — o ponto essencial é sair de "lista
única" pra "lista por zona + função de lookup".

## 3. `services/simeApi.js` — Bearer por zona em vez de fixo

```js
function secretDaZona(zona) {
  const mapa = { '7': process.env.HERMES_SECRET_ZONA_7, '94': process.env.HERMES_SECRET_ZONA_94 };
  return mapa[zona];
}

// Toda função que hoje monta o header Authorization com HERMES_SECRET
// passa a receber `zona` e resolver o secret certo:
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
```

Todo call site existente (`hermes-update`, `hermes-mesarios`,
`hermes-notificacoes`, `hermes-campanhas`, `hermes-heartbeat`,
`hermes-contatos` se o patch de escalonamento também for aplicado) precisa
passar a receber `zona` de quem chamou — é o ponto de maior mudança, porque
hoje provavelmente é fixo/implícito em todo o arquivo.

## 4. `modules/whatsapp/router.js` — resolver a zona por grupo

```js
// No handler de mensagem de grupo, antes de decidir o que fazer com ela:
const zona = zonaDoGrupo(mensagem.key.remoteJid);
if (!zona) return; // grupo não monitorado — mesmo comportamento de hoje

// ...e passar `zona` adiante pra tudo que hoje chama simeApi:
//   detectarEvento(texto) → se achar, postHermesApi('hermes-update', zona, {...})
//   confirmacao.js (keywords sim/não/substituto) → postHermesApi('hermes-mesarios', zona, {...})
```

## 5. `modules/whatsapp/notificacoes.js` e `modules/campanhas/dispatch.js` — drenar as duas filas

Hoje drenam uma fila (implicitamente zona 7). Precisam virar um loop:

```js
for (const zona of ['7', '94']) {
  const resp = await postHermesApi('hermes-notificacoes', zona, { acao: 'pendentes' });
  if (!resp.ok) continue;
  const { notificacoes } = await resp.json();
  for (const n of notificacoes) {
    // ... enviar via socket ativo (papel.js), mesma lógica de sempre ...
    await postHermesApi('hermes-notificacoes', zona, { acao: 'confirmar', ids: [n.id] });
  }
}
```

Mesmo padrão pro `dispatch.js` (disparo em massa) — iterar as duas zonas,
respeitando `DISPATCH_ATIVO` (continua valendo pras duas, ou criar
`DISPATCH_ATIVO_ZONA_94` separado se quiser controlar independente).

## 6. `core/bootstrap.js` — nada muda na arbitragem principal/backup

O `!papel.souBackup()` continua igual — só quem estiver "principal" no
momento drena as filas, agora de ambas as zonas dentro do mesmo loop. Não
precisa duplicar a lógica de papel por zona; é a mesma sessão WhatsApp ativa
enviando pra números de zonas diferentes.

## 7. Se o patch de escalonamento (`PATCH_PENDENTE_2026-08-08.md`, item B)
também for aplicado, o cache de `buscarContatosEscalonamento()` precisa
virar por zona:

```js
const _contatosCache = {}; // { '7': {...}, '94': {...} }
const _contatosCacheEm = {};
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
```

## Teste antes de aplicar em produção

1. Mandar uma mensagem de teste ("seção 63 encerrada") num grupo da 7ª →
   grava normalmente, como hoje.
2. Mandar a mesma mensagem num grupo de teste da 94ª → precisa gravar como
   evento da 94ª (conferir no Admin da 94ª, não da 7ª).
3. Derrubar o socket principal (ex.: `pm2 restart hermes` no meio de um teste,
   ou forçar logout) e checar que o backup assume **os grupos das duas
   zonas**, não só os da 7ª.
4. Confirmar que a fila de pânico de teste da 94ª é drenada (item 5) — hoje
   ela nunca foi exercida porque não havia instância nenhuma lá.
5. Checar `pm2 logs` pra garantir que nenhuma mensagem de grupo da 7ª está
   sendo tratada como se fosse da 94ª (ou vice-versa) — erro aqui grava dado
   na zona errada, o que é pior que não gravar.

## Rollback

Reverter é mais trabalhoso que os outros dois patches, porque mexe em
`config.js`/`simeApi.js` que outros módulos importam. Mais seguro: manter uma
cópia dos arquivos originais antes de editar (`cp config.js config.js.bak`
etc.) e, se algo quebrar, restaurar os `.bak` + `HERMES_SECRET` único no
`.env` + `pm2 restart hermes --update-env`.
