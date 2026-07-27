# SKILL: sime_mesarios
description: Consulta a lista de mesários no SIME e registra se cada um confirma (ou não) que vai permanecer na função.
triggers:
  - pergunta sobre quem é mesário de uma seção ("quem é o presidente da 63?")
  - campanha de verificação pré-eleição ("confirme os mesários da seção X")
  - resposta de um mesário no WhatsApp a um pedido de confirmação (SIM/NÃO/substituto)

---

## Objetivo

Dar ao Hermes um caminho de **leitura + confirmação** de mesários — complementar
ao `sime_updater`, que só escreve eventos de seção. Espelha a mesma autenticação
por zona (Bearer) e grava em `sime_atores.confirmacao`. O cartório vê o resultado
na hora no painel "Confirmação de mesários" do `SIME_admin.html` e nos relatórios.

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

### 2. `confirmar` / `recusar` / `substituir` — registrar a resposta
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

## Fluxo de verificação pelo WhatsApp (uso típico)

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
- Toda escrita registra log append-only (`modulo='hermes_mesarios'`).
- Nunca escalar para o juiz eleitoral; dúvidas → cartório.
- O filtro por seção usa hoje o texto de `observacao` ("Seção votação: NNN")
  enquanto o backfill de `secao_id` não roda; a confirmação por telefone não
  depende disso.
