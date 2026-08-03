# SKILL: sime_mesarios
description: Consulta a lista de mesários/apoio logístico no SIME, responde o autoatendimento quando alguém manda "oi", e registra confirmação (ou recusa) da convocação.
triggers:
  - pergunta sobre quem é mesário de uma seção ("quem é o presidente da 63?")
  - campanha de verificação pré-eleição ("confirme os mesários da seção X")
  - resposta de um mesário no WhatsApp a um pedido de confirmação (SIM/NÃO/substituto)
  - **primeiro contato espontâneo de alguém da base** — "oi", "bom dia", "quem
    fala", ou qualquer mensagem que não seja claramente um evento de seção
    (`sime_updater`) nem resposta a uma campanha em andamento

---

## Objetivo

Dar ao Hermes um caminho de **leitura + autoatendimento + confirmação** de
mesários e apoio logístico — complementar ao `sime_updater`, que só escreve
eventos de seção. Espelha a mesma autenticação por zona (Bearer) e grava em
`sime_atores`. O cartório vê o resultado na hora no painel "Confirmação de
mesários" do `SIME_admin.html` e nos relatórios.

## Endpoint alvo

```
POST https://sime-cyan.vercel.app/api/hermes-mesarios
Authorization: Bearer <HERMES_SECRET_ZONA_x>
Content-Type: application/json
```

O Bearer identifica a zona (cada instância Hermes tem o seu). Toda operação é
restrita à zona autenticada — o Hermes de uma zona nunca lê nem altera mesário de
outra.

## Ações

### 1. `listar` — consultar mesários
```json
{ "acao": "listar", "secao": "0063", "status": "pendente" }
```
`secao` e `status` são opcionais. `status` ∈ `pendente|confirmado|recusou|substituido`.

Resposta:
```json
{
  "ok": true,
  "total": 2,
  "mesarios": [
    { "nome": "ANA SOUSA", "telefone": "558611110001", "secao": "0063",
      "confirmacao": "pendente", "ativo": true }
  ]
}
```

### 2. `consultar` — autoatendimento (alguém manda "oi")
```json
{ "acao": "consultar", "telefone": "5586999990001" }
```
Identifica a pessoa pelo telefone (mesma regra de casamento do `confirmar`) e
devolve, pronta em `mensagem_wa`, a convocação: função e — sendo mesário (MRV)
— a seção (número, local e município, já resolvidos via `secao_id`). Quem é
mesário **e também** apoio logístico (existe gente nas duas listas) recebe as
duas convocações na mesma mensagem. Termina sempre convidando a pessoa a mandar
uma atualização, se algo estiver errado ou ela não puder mais atuar.

Resposta:
```json
{
  "ok": true,
  "encontrado": 1,
  "pessoas": [{ "nome": "ANA SOUSA", "funcao": "mesario", "funcao_mesa": "Presidente",
    "secao": { "numero": "0063", "local_nome": "Escola Municipal X", "municipio": "Campo Maior" },
    "confirmacao": "pendente" }],
  "mensagem_wa": "Olá, ANA SOUSA! Você está convocado(a) como Presidente na Seção 0063 — Escola Municipal X, Campo Maior para a eleição de 04/10. Se algum dado estiver errado, ou você não puder mais atuar, me manda a informação que eu repasso pro cartório."
}
```
Telefone não encontrado → HTTP 404 com `mensagem_wa` orientando falar com o
cartório (mesmo padrão do `confirmar`).

### 3. `atualizar` — a pessoa manda uma correção/observação
```json
{ "acao": "atualizar", "telefone": "5586999990001", "mensagem": "meu telefone mudou, esse aqui que uso agora" }
```
Usado quando, depois do autoatendimento, a pessoa responde com algo que precisa
de atenção humana (telefone errado, endereço, "não vou poder ir", etc.).
**Nunca sobrescreve** nome/telefone/seção — esses são dado oficial do TRE,
recarregado por `sime_sync_atores_from_raw()`. O recado só é **anexado** em
`sime_atores.observacao` (com carimbo de data/hora do servidor) para o cartório
revisar manualmente — mesmo espírito do log append-only.

Resposta: `{ "ok": true, "encontrado": 1, "mensagem_wa": "Anotado! Vou repassar pro cartório. Obrigado por avisar." }`

### 4. `confirmar` / `recusar` / `substituir` — registrar a resposta
Identifica a pessoa pelo **telefone** (o número que respondeu no WhatsApp). Casa
por dígitos exatos ou pelos últimos 8 dígitos (tolera variação de DDI/DDD).
```json
{ "acao": "confirmar", "telefone": "5586999990001" }
```
| ação | grava confirmacao | ativo |
|---|---|---|
| `confirmar`  | `confirmado`  | `true`  |
| `recusar`    | `recusou`     | `false` |
| `substituir` | `substituido` | `false` |

Resposta traz `mensagem_wa` pronta para devolver ao mesário, `encontrado` (quantos
casaram) e `nomes`. Se ninguém casar → HTTP 404 com `mensagem_wa` orientando falar
com o cartório.

## Fluxo de autoatendimento (mesário/apoio logístico manda "oi")

Este é o fluxo **espontâneo** — a pessoa que inicia o contato, não uma campanha
do cartório. Cobre qualquer primeira mensagem que não seja claramente um evento
de seção nem resposta a uma campanha em andamento.

```
1. Mesário manda "oi" / "bom dia" / "quem é?"
2. sime_mesarios {acao:'consultar', telefone:<remetente>}
3a. Encontrado  → Hermes devolve a mensagem_wa (função + seção, se MRV)
3b. Não encontrado → Hermes devolve a mensagem_wa de 404 ("fale com o cartório")
4. Se a pessoa responder com uma correção/observação (telefone errado,
   "não vou poder ir", etc.):
     sime_mesarios {acao:'atualizar', telefone:<remetente>, mensagem:<texto da pessoa>}
5. Se em vez disso a pessoa responder confirmando/recusando a convocação,
   segue o fluxo de confirmação abaixo normalmente (SIM/NÃO/substituto) —
   os dois fluxos convergem no mesmo `confirmar`/`recusar`/`substituir`.
```

## Fluxo de verificação pelo WhatsApp (campanha do cartório)

```
1. sime_mesarios {acao:'listar', status:'pendente'}  → pega telefones pendentes
2. Para cada um, Hermes envia:
     "Olá {nome}! Você confirma que vai atuar como mesário na seção {secao}
      no dia 04/10? Responda SIM ou NÃO."
3. Mesário responde "sim" / "não" / "vou mandar substituto"
4. sime_mesarios {acao:'confirmar'|'recusar'|'substituir', telefone:<remetente>}
5. Hermes devolve a mensagem_wa de agradecimento.
```

## CRÍTICO

- Timestamp sempre do servidor (o endpoint chama `sime_now()`); nunca `Date.now()`.
- Toda escrita registra log append-only (`modulo='hermes_mesarios'` ou, pra
  `atualizar`, `hermes_atualizou_info`).
- Nunca escalar para o juiz eleitoral; dúvidas → cartório.
- `consultar`/`listar` resolvem a seção via `secao_id` (join com `sime_secoes`,
  populado por `sime_sync_atores_from_raw()`) quando disponível; caem pro texto
  de `observacao` ("Seção votação: NNN") só em registros antigos sem esse backfill.
- `atualizar` **nunca** sobrescreve nome/telefone/seção — isso é dado oficial do
  TRE. O recado vira anotação em `observacao` pro cartório decidir o que fazer.
