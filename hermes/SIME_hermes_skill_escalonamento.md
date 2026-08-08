# SKILL: sime_escalonamento (proposta — ainda não ligada no Pi)

description: Resolve o telefone de Gestor de Problemas e Chefe de Cartório
da zona, pra `sime_notificar` escalar pra quem de fato deve ser avisado em
vez de mandar pra todo `ADMIN_NUMBERS` igual.

triggers:
  - dentro do loop de `sime_notificar`, no momento de decidir o destinatário
    de uma notificação com `idade_s` >= 600 (ver tabela de escalonamento)

status: **endpoint pronto em produção, mas nada no `index.js` do Pi o chama
ainda** — este documento é o contrato pra quando isso for ligado (ver
CLAUDE.md → PENDÊNCIAS → "Escalonamento por papel ainda não diferencia
destinatário").

---

## Objetivo

Hoje `sime_notificar` manda toda notificação escalada pra `ADMIN_NUMBERS`
(lista estática no `.env` do Pi), sem diferenciar nível — o mesmo número
recebe o aviso de 10 minutos e o de 30 minutos. Faltava uma forma do SIME
dizer **quem** é o Gestor de Problemas e **quem** é o Chefe de Cartório desta
zona. `hermes-contatos.js` resolve isso: lê `sime_usuarios.telefone_whatsapp`
filtrado por `perfil` (o admin cadastra o próprio WhatsApp na aba Equipe do
`SIME_admin.html`, campo só visível pros dois perfis certos).

## Endpoint

```
POST https://sime-cyan.vercel.app/api/hermes-contatos
Authorization: Bearer <HERMES_SECRET_ZONA_x>
Content-Type: application/json

{ "acao": "listar" }
```

Mesma auth por zona dos demais endpoints `hermes-*` — o Bearer já resolve a
zona, não precisa (nem pode) mandar `zona` no corpo.

Resposta:
```json
{
  "ok": true,
  "zona": "7",
  "contatos": {
    "gestor_prob": ["558611110001"],
    "coordenador": ["558611110002"]
  }
}
```

Listas podem vir vazias (ninguém daquele perfil cadastrou telefone ainda) —
não é erro, é `200` com array vazio. **Sempre trate lista vazia como "sem
destinatário pra este nível"**, nunca como falha — não existe fallback
automático pro `ADMIN_NUMBERS` aqui: se a lista vier vazia é porque o cartório
ainda não cadastrou o WhatsApp de ninguém naquele papel, e mandar pra um
número errado é pior que não mandar.

## Como pluga em `sime_notificar`

A tabela de escalonamento por `idade_s` já existe em
`SIME_hermes_skill_notificar.md`:

| `idade_s` | Destinatário |
|---|---|
| < 600 (10 min) | Monitor de Campo |
| 600–1799 | + Gestor de Problemas |
| ≥ 1800 (30 min) | + Chefe de Cartório |

Hoje "Monitor de Campo" e os demais níveis caem todos no mesmo
`ADMIN_NUMBERS`. Com este endpoint, o corte de 600s/1800s passa a escolher
telefone real:

```js
// dentro do loop que já chama /api/hermes-notificacoes { acao: 'pendentes' }
const contatos = await buscarContatosEscalonamento(); // GET/cache com TTL curto (ex.: 5 min) — não precisa chamar a cada notificação
for (const n of notificacoes) {
  const destinatarios = new Set(ADMIN_NUMBERS); // nível base continua igual
  if (n.idade_s >= 600)  contatos.gestor_prob.forEach(t => destinatarios.add(t));
  if (n.idade_s >= 1800) contatos.coordenador.forEach(t => destinatarios.add(t));
  // ... enviar pra cada um em destinatarios, respeitando o intervalo de 3s entre mensagens
}
```

`Set` em vez de array simples pra não duplicar envio quando o mesmo número
está em `ADMIN_NUMBERS` **e** cadastrado como `telefone_whatsapp` de um dos
dois perfis.

Cache com TTL curto (sugestão: 5 min, igual ao que já baliza "online" do
heartbeat) evita bater no endpoint a cada notificação da fila — os contatos
não mudam no meio da operação, exceto se o cartório editar a equipe ao vivo,
o que é raro e tolera alguns minutos de atraso.

## Erros esperados

| status | motivo |
|---|---|
| 401 | Bearer errado — mesmo tratamento dos demais endpoints `hermes-*` |
| 400 | `Zona não encontrada` (não deveria acontecer com um Bearer válido em produção) |
| 500 | Falha do Supabase — trate como "sem contatos desta vez", tenta de novo no próximo ciclo |

## CRÍTICO

- Isto **não substitui** `ADMIN_NUMBERS` — soma. Continue mandando pro nível
  base sempre; o Gestor de Problemas e o Chefe de Cartório entram **além**
  dele, conforme `idade_s`.
- Nunca escalar para o juiz eleitoral (regra de sempre do SIME).
- Não existe ação de escrita aqui — é só leitura. Quem edita o telefone é o
  admin, pela aba Equipe do `SIME_admin.html` (não pelo Hermes).
