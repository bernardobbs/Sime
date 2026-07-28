# SIME — Roteiro de Teste do sistema

Validação ponta a ponta. Cada passo tem **ação**, **resultado esperado** e caixa
de marcação. Marque `[x]` quando passar, ou anote a falha na coluna de observação.

| | |
|---|---|
| **Repositório** | https://github.com/bernardobbs/Sime |
| **App em produção** | https://sime-cyan.vercel.app |
| **Projeto Vercel** | `sime` |
| **Projeto Supabase** | `sime-eleicao` (`unjhnlcmxbrlonppchux`) |
| **Zonas** | 7ª (Campo Maior · 175 seções) e 94ª (Oeiras · 98 seções) |
| **Dia D** | 04/10/2026 |

> **Sobre as URLs de pré-visualização.** O Vercel gera endereços com o nome da
> **conta**, não do projeto — por exemplo
> `sime-git-...-bernardo-borges-silvas-projects.vercel.app`. Esse trecho é o
> nome do titular da conta e aparece igual em todos os projetos dela; **não
> indica ligação com outro sistema**. O SIME é um projeto Vercel separado, com
> repositório, banco e domínio próprios. Para testar, use sempre
> `sime-cyan.vercel.app`.

> Legenda de sync: 🟢 sincronizado · 🟡 salvo offline (fila) — nunca deve travar a ação.

---

## ⚠️ O defeito do pânico — corrigido no mesário, ainda aberto nos outros

O defeito relatado em campo era: a equipe resolve o pânico pelo Admin e **o
controle do mesário continua vermelho**. Por trás dele havia um segundo,
pior: o mesário gravava o **snapshot inteiro** da seção a cada toque, então o
toque seguinte em qualquer botão reenviava `panico_resolvido: false` e
**desfazia a resolução no banco**. Não era só tela desatualizada — era perda
de dado.

**Os dois estão corrigidos no `SIME_mesario.html`**, por dois caminhos
independentes:

1. O mesário passou a assinar o Realtime da própria seção (e a reler o estado
   ao abrir e sempre que a tela volta), então a resolução feita pelo Admin
   chega ao aparelho.
2. Os campos de pânico **só entram no payload quando o toque foi de pânico**.
   Como o RPC trata `NULL` como "mantém o que está lá", nenhuma outra ação
   pode pisar neles — mesmo offline, mesmo com o Realtime fora do ar.

**Continua aberto nos outros cinco módulos de campo** (motorista, conferente,
instalador, mídias, acessibilidade): eles ainda só escrevem. O caso que
importa na prática é o **pânico da acessibilidade** (passo 8.5) — se a equipe
resolver pelo Admin, aquele aparelho não fica sabendo.

Os passos **7.6 a 7.9** medem a correção; **8.7** mede o que sobrou.

---

## ⚡ Smoke de 5 minutos

Confirma que o sistema está no ar e o caminho crítico funciona. Se algum falhar,
não adianta seguir para o roteiro completo.

| # | Ação | Esperado | OK |
|---|---|---|---|
| S1 | Abrir a raiz do app | Tela de login do Admin | [ ] |
| S2 | Logar como admin | Entra; topo mostra seu nome | [ ] |
| S3 | Abrir um QR de mesário no celular | Campo **Token já preenchido**; falta só o PIN | [ ] |
| S4 | Digitar o PIN | Entra na seção do cartão | [ ] |
| S5 | Tocar em Zerésima | Badge 🟢 | [ ] |
| S6 | Abrir a TV Dia | A seção aparece com a zerésima em segundos | [ ] |

Se **S3** falhar, o token não está sendo lido da URL. Se **S4** falhar com
"sem conexão", quase sempre é CORS ou segredo — veja §1.

---

## 0. Pré-requisitos

| # | Item | OK |
|---|---|---|
| 0.1 | `SIME_JWT_SECRET` configurado na Edge Function | [ ] |
| 0.2 | `HERMES_SECRET_ZONA_7` e `_94` na Vercel **e** no Hermes, com o mesmo valor | [ ] |
| 0.3 | Conta de admin da 7ª e conta da 94ª (Maria Gomes) | [ ] |
| 0.4 | Cartões impressos: 1 mesário, 1 motorista, 1 conferente, 1 acessibilidade | [ ] |
| 0.5 | 1 token de TV | [ ] |
| 0.6 | Aparelhos: 2 celulares, 1 TV Box, 1 PC | [ ] |

---

## 1. Login e conectividade

Esta seção existe porque um **preflight CORS** bloqueado já impediu **todos** os
logins de campo, e o sintoma na tela era enganoso: "Token ou PIN inválido, ou
sem conexão".

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 1.1 | Login de admin com senha certa | Entra | [ ] | |
| 1.2 | Login de admin com senha errada | "E-mail ou senha inválidos" — e **não** "sem conexão" | [ ] | |
| 1.3 | Login de campo com PIN errado | Erro de PIN, não de rede | [ ] | |
| 1.4 | Login de campo com PIN certo | Entra | [ ] | |
| 1.5 | Se 1.4 disser "sem conexão" com PIN certo | Suspeite de CORS/segredo, não do cartão | [ ] | |

---

## 2. Acesso indevido — não pode entrar sem credencial

Conferente e acessibilidade já entraram com **acesso total sem PIN** em qualquer
navegador limpo. Estes passos garantem que a porta continua fechada.

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 2.1 | Abrir `SIME_conferente.html` numa **janela anônima** | Para na tela de PIN; **não entra** | [ ] | |
| 2.2 | Abrir `SIME_acessibilidade.html` anônima | Para na tela de PIN | [ ] | |
| 2.3 | Abrir `SIME_acessibilidade.html?local=Qualquer+Coisa` | **Não** entra pelo parâmetro | [ ] | |
| 2.4 | Chutar um PIN qualquer sem ter QR | Recusa | [ ] | |
| 2.5 | Abrir `SIME_principal.html` anônima | Pede login; **nenhuma zona listada** | [ ] | |

---

## 3. Escopo por zona

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 3.1 | Logar como admin da 7ª | Vê só seções/rotas/atores da 7ª | [ ] | |
| 3.2 | Logar como Maria Gomes (94ª) | Vê só a 94ª; **zero** dado da 7ª | [ ] | |
| 3.3 | Admin de zona: aba **Zonas** no portal | **Não aparece** | [ ] | |
| 3.4 | Super admin: aba **Zonas** | Aparece, com as duas zonas e números reais | [ ] | |
| 3.5 | Em Tokens, admin de zona | Seletor de zona **travado** na dele | [ ] | |
| 3.6 | Em Tokens, super admin | Seletor habilitado; trocar recarrega seções/rotas | [ ] | |
| 3.7 | Abrir `/z/7/SIME_tv_dia.html?tv_token=…` | Carrega o painel da 7ª | [ ] | |
| 3.8 | Abrir `/z/94/…` com token da **7ª** | Mostra dados da **7ª** (o token manda, não a URL) | [ ] | |

> 3.8 não é defeito: a zona na URL é organização, quem autoriza é o token.

---

## 4. Tokens e QR Codes

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 4.1 | Admin → aba **Config** | Card **Tokens & QR Codes** com botão | [ ] | |
| 4.2 | Entrar como **Observador** | O card **não aparece** | [ ] | |
| 4.3 | Gerar 1 token de mesário | QR desenha na tela (não "QR indisponível") | [ ] | |
| 4.4 | **Desligar a internet** e recarregar a página de tokens | O QR **continua** desenhando | [ ] | |
| 4.5 | Botão **Gerar em massa** | Cria 1 por seção/rota/local, sem duplicar | [ ] | |
| 4.6 | Clicar em massa **de novo** | "Todos os tokens já existem" | [ ] | |
| 4.7 | **Imprimir 3 cartões** e ler o QR a 30 cm | Câmera reconhece; PIN legível | [ ] | |
| 4.8 | Conferir a URL impressa | Contém `/z/<zona>/` | [ ] | |

> 4.7 é o único teste que não dá para simular. Faça **antes** de imprimir os 175.

---

## 5. Preparação (D-X)

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 5.1 | `SIME_coordenador_preparacao.html`, logar | Lista de seções | [ ] | |
| 5.2 | Registrar lacre de algumas seções | Toque único; 🟢 | [ ] | |
| 5.3 | Abrir TV Preparação | Mostra o avanço | [ ] | |

---

## 6. Distribuição e Véspera (D-1)

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 6.1 | `SIME_conferente.html` com cartão de conferente | Mostra as rotas atribuídas | [ ] | |
| 6.2 | Marcar urnas embarcadas | Progresso sobe; 🟢 | [ ] | |
| 6.3 | Fechar a rota como **Saiu** | Status muda | [ ] | |
| 6.4 | TV Distribuição (Expedição) aberta | Rota atualiza **em segundos** | [ ] | |
| 6.5 | `SIME_instalador.html`, registrar instalação | Aparece na TV Véspera | [ ] | |
| 6.6 | TV Véspera aberta durante 6.5 | Atualiza em segundos | [ ] | |

---

## 7. Dia D — Mesário (o fluxo mais crítico)

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 7.1 | Escanear o QR do cartão | Token preenchido; cursor no PIN | [ ] | |
| 7.2 | Digitar o PIN | Entra na seção do cartão | [ ] | |
| 7.3 | Marcar chegada da mesa (4 membros) | LEDs acendem; "Mesa completa" | [ ] | |
| 7.4 | Zerésima → Votação | Status muda a cada uma; 🟢 | [ ] | |
| 7.5 | Ajustar a **fila** (+5, −1, zerar) | Contador responde | [ ] | |

### 7.6–7.9 — o defeito relatado (agora corrigido)

Estes quatro passos são a verificação da correção. **Se algum falhar, o
defeito voltou** — anote exatamente o que aconteceu.

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 7.6 | Acionar **pânico de energia** no mesário | Botão fica vermelho pulsando | [ ] | |
| 7.7 | Ver no Admin e na TV Dia | Alerta aparece em segundos | [ ] | |
| 7.8 | **Resolver o pânico pelo Admin** | O mesário vira **verde sozinho**, com aviso "Problema resolvido pela equipe" | [ ] | |
| 7.9 | No mesário, tocar em **qualquer** outro botão | O pânico **continua resolvido** no Admin | [ ] | |
| 7.9b | Fechar o app do mesário, resolver pelo Admin, **reabrir** | Abre já verde — não volta com o vermelho antigo | [ ] | |
| 7.9c | Modo avião no mesário, resolver pelo Admin, tocar outro botão, voltar a rede | A resolução **sobrevive** — o toque offline não a desfaz | [ ] | |

> **7.9c é o mais importante dos três.** É o único que testa a correção que não
> depende de rede: os campos de pânico não são reenviados por toques que não
> são de pânico.

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 7.10 | Resolver o pânico **no próprio mesário** | Fica verde nos três lugares | [ ] | |
| 7.11 | **Encerrar** a seção | Modal de confirmação (irreversível) | [ ] | |
| 7.12 | Marcar **mídia pronta** | Só libera após o encerramento | [ ] | |

---

## 8. Dia D — Motorista, Acessibilidade, Mídias

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 8.1 | `SIME_motorista.html` com cartão da rota | Rota, nº de urnas e itinerário | [ ] | |
| 8.2 | Confirmar entregas | Progresso sobe | [ ] | |
| 8.3 | Recolhimento + chegada ao cartório | Botão do cartório libera no fim | [ ] | |
| 8.4 | `SIME_acessibilidade.html` com cartão | Só as seções **daquele local** | [ ] | |
| 8.5 | Pânico pela acessibilidade | Chega ao Admin e à TV Dia | [ ] | |
| 8.6 | `SIME_midias.html`, registrar coleta | Mídia avança (pronta → coletada) | [ ] | |
| 8.7 | Resolver o pânico de 8.5 **pelo Admin** | Hoje o aparelho da acessibilidade **continua vermelho** — defeito conhecido, ainda não corrigido | [ ] | |

> **8.7 é o que sobrou do defeito do pânico.** Enquanto não for corrigido, o
> pânico levantado pela acessibilidade deve ser resolvido **naquele aparelho**.

---

## 9. Offline — a fila não perde ação

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 9.1 | Modo avião no celular do mesário | App continua utilizável | [ ] | |
| 9.2 | Confirmar 3 ações diferentes | Badge 🟡 em todas | [ ] | |
| 9.3 | Desligar o modo avião | Em ~30s sincroniza; volta a 🟢 | [ ] | |
| 9.4 | Conferir na TV Dia | **As 3** ações apareceram | [ ] | |
| 9.5 | Fechar o app com fila pendente e reabrir | A fila sobrevive ao fechamento | [ ] | |

---

## 10. Hermes — WhatsApp

Testar **sem** esperar um pânico real:

```bash
curl -sS -X POST https://sime-cyan.vercel.app/api/hermes-notificacoes \
  -H "Authorization: Bearer <SEGREDO_DA_ZONA>" \
  -H 'Content-Type: application/json' -d '{"acao":"pendentes"}'
```

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 10.1 | O `curl` acima | `{"ok":true,"notificacoes":[]}` | [ ] | |
| 10.2 | O mesmo com segredo errado | `401` | [ ] | |
| 10.3 | Acionar um pânico e repetir o `curl` | A notificação aparece na fila | [ ] | |
| 10.4 | Conferir o campo `idade_s` | Cresce a cada consulta | [ ] | |
| 10.5 | Com o Hermes ligado, acionar pânico | WhatsApp chega em até ~30s | [ ] | |
| 10.6 | Repetir o `curl` depois do envio | A notificação **saiu** da fila | [ ] | |
| 10.7 | Segredo da 7ª pedindo a fila | **Nenhuma** notificação da 94ª | [ ] | |
| 10.8 | Mandar "seção 63 encerrada" no grupo | Hermes pede confirmação; ao confirmar, grava | [ ] | |
| 10.9 | **Desligar o Hermes**, acionar pânico, religar | A notificação sai quando ele volta | [ ] | |

---

## 11. Atores e mesários

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 11.1 | Admin → aba **Atores** | Lista os atores do banco (7ª: 548) | [ ] | |
| 11.2 | Filtrar por **Mesário** | ~450 ativos | [ ] | |
| 11.3 | Filtrar por **Junta Eleitoral** | Os 5 aparecem | [ ] | |
| 11.4 | Buscar telefone **sem** o 55 | Encontra | [ ] | |
| 11.5 | Clicar no botão de WhatsApp | Abre sem o 55 duplicado | [ ] | |
| 11.6 | Painel de confirmação de mesários | Lista com pendente/confirmado/recusou | [ ] | |
| 11.7 | Como Maria Gomes (94ª) | Vê os atores da 94ª — hoje, nenhum | [ ] | |

---

## 12. Configuração da eleição

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 12.1 | Portal → aba **Eleição**, navegador limpo | Dia D do 1º turno = **04/10/2026** | [ ] | |
| 12.2 | Conferir o 2º turno | **25/10/2026** (último domingo) | [ ] | |
| 12.3 | Conferir a véspera | 03/10 — derivada do Dia D | [ ] | |
| 12.4 | Mudar o Dia D para 01/11 | Véspera vira **31/10** (vira o mês) | [ ] | |
| 12.5 | Preencher **carga e lacre** e salvar | "Salva no cartório" | [ ] | |
| 12.6 | Abrir em **outro navegador/PC** | As datas estão lá (vieram do banco) | [ ] | |

> 12.6 é o que prova que a configuração deixou de viver só no navegador.

---

## 13. TV Box (app Android)

> Só depois de compilar o APK — ver `android-tv/README.md`.

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 13.1 | Instalar e abrir no MXQ Pro 4K | Painel carrega e **sai do fallback** | [ ] | |
| 13.2 | Mudar algo pelo Admin | O telão reage em segundos | [ ] | |
| 13.3 | **Tirar da tomada** e religar | Painel volta sozinho, sem controle remoto | [ ] | |
| 13.4 | Tirar o Wi-Fi por 2 min e devolver | Reconecta sozinho | [ ] | |
| 13.5 | Deixar ligado **algumas horas** | Sem travar nem consumir memória sem parar | [ ] | |
| 13.6 | Segurar **OK** por 5s | Volta à configuração | [ ] | |
| 13.7 | Trocar o painel pela configuração | Carrega o painel novo | [ ] | |

> **13.1 é o teste que decide o projeto do app.** Se falhar, o GeckoView não
> resolveu o WebView antigo e é melhor saber agora. **13.5** é o que mais se
> aproxima do dia 4.

---

## 14. Relatórios

| # | Ação | Esperado | OK | Obs |
|---|---|---|---|---|
| 14.1 | `SIME_relatorios.html`, logar | Cabeçalho com a zona certa | [ ] | |
| 14.2 | **Situação das seções** | Reflete os lançamentos deste roteiro | [ ] | |
| 14.3 | **Distribuição de urnas** | Rotas com itinerário e status | [ ] | |
| 14.4 | **Pânicos e ocorrências** | Lista os pânicos de §7 (abertura e resolução) | [ ] | |
| 14.5 | Exportar **CSV** | Baixa | [ ] | |
| 14.6 | **Imprimir** | Layout limpo, sem menus | [ ] | |

---

## Critérios de aceite

Sem estes, o sistema não está pronto para 4 de outubro:

- [ ] Login de admin **e** de campo funcionam (§1) — sem cair em "sem conexão"
- [ ] Nenhum módulo entra **sem credencial** (§2)
- [ ] Admin de uma zona **não** enxerga a outra (§3)
- [ ] O QR **preenche o token** e o cartão impresso é **legível** (§4)
- [ ] Ação do mesário chega à TV Dia e ao Admin em segundos (§7)
- [ ] Resolver o pânico pelo Admin atualiza o mesário e **não é desfeito** (7.8–7.9c)
- [ ] A fila offline recupera **todas** as ações (§9)
- [ ] O Hermes drena a fila e o WhatsApp chega (§10)
- [ ] A configuração da eleição sobrevive à troca de navegador (§12)
- [ ] O telão volta sozinho depois de queda de energia (§13)

### Fora dos critérios, por decisão consciente

- **8.7** — os outros cinco módulos de campo continuam só escrevendo. O caso
  que aparece na operação é o pânico da acessibilidade: enquanto não for
  corrigido, **resolva-o naquele aparelho**, não pelo Admin. Estender o
  Realtime aos cinco ficou para depois de outubro — mexer nos seis módulos a
  esta altura é superfície de regressão demais para o ganho.

---

## Registro

- Data/hora: __________  Responsável: __________
- Aparelhos: ______________________________________
- Falhas encontradas (nº do passo + o que aconteceu):
  1. ______________________________________________
  2. ______________________________________________
  3. ______________________________________________
