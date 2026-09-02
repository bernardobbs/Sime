# App Android para TV Box — projeto

Aplicativo único que exibe os quatro painéis do SIME num telão, instalado por
APK num TV Box Android.

> **Definido com o cartório em 28/07/2026:**
> - **Expedição = Distribuição** (`SIME_tv_distribuicao.html`, embarque de urnas).
>   No app o painel se chama "Expedição", que é o nome usado na operação; o
>   arquivo no servidor continua `SIME_tv_distribuicao.html`.
> - **Aparelho:** MXQ Pro 4K.
> - **Escala:** 2 telões, ambos na 7ª Zona.
> - **Decisão:** partir direto para o app, sem a etapa do Fully Kiosk.
>
> O código está em [`android-tv/`](../android-tv/).

---

## 1. Premissas

**Hardware real.** MXQ Pro 4K ou similar: Amlogic S905, Android 7.1, 1–2 GB de
RAM, sem Play Store na maioria das unidades. É barato e é o que existe.

**Sem interação.** O painel fica num telão do cartório. Ninguém digita. O único
periférico é o controle remoto, e mesmo ele só será usado uma vez, na
configuração.

**As quatro telas já existem e funcionam.** São páginas web com Realtime,
autenticação por `tv_token` e fallback offline. Não há motivo para reescrevê-las
em Kotlin — seria refazer do zero algo testado, e passaríamos a manter duas
versões de cada painel.

---

## 2. Decisão central

**Um wrapper WebView com motor de renderização embarcado.**

O app não reimplementa os painéis: ele os carrega. O que ele acrescenta é
justamente o que falta hoje — e que nenhum navegador de quiosque resolve bem
neste hardware.

### Por que embarcar o motor

Este é o ponto que define o projeto. O `System WebView` de fábrica desses boxes
é antigo demais para o que os painéis usam: **ES modules, `import()` dinâmico,
optional chaining e WebSocket**. Sem Play Store, ele não atualiza.

Usar o WebView do sistema significaria que **cada box é uma incógnita** — e a
descoberta viria no dia 4 de outubro. Embarcando o motor (GeckoView ou um
Chromium via bundle), o comportamento passa a ser o mesmo em qualquer box.

Custo: o APK sai de ~2 MB para ~60–80 MB. Irrelevante para instalação por
pendrive, e é o preço de previsibilidade.

---

## 3. Arquitetura

```
┌─────────────────────────────────────────────┐
│ SimeTvApp (APK)                             │
│                                             │
│  ConfiguracaoActivity   ← 1ª execução       │
│    • escolher painel (D-pad)                │
│    • token de TV (QR ou teclado na tela)    │
│    • grava em EncryptedSharedPreferences    │
│                                             │
│  PainelActivity         ← execução normal   │
│    • GeckoView em tela cheia                │
│    • keepScreenOn, imersivo, sem barras     │
│    • carrega <SIME_URL>/z/<zona>/<painel>   │
│                       ?tv_token=<token>     │
│                                             │
│  BootReceiver           ← BOOT_COMPLETED    │
│  RedeWatchdog           ← reconexão         │
│  VigiaDeTela            ← recarrega se travar│
└─────────────────────────────────────────────┘
              │ HTTPS + WebSocket
              ▼
      Vercel (painéis) + Supabase (dados/Realtime)
```

Nada de novo no backend. O app consome exatamente o que já está no ar.

---

## 4. Telas

### 4.1 Configuração (só na primeira execução)

Quatro cartões grandes, navegáveis pelo D-pad do controle:

```
┌──────────────┐ ┌──────────────┐
│  🏭          │ │  🚚          │
│  PREPARAÇÃO  │ │  EXPEDIÇÃO   │
│  Carga e     │ │  Embarque    │
│  lacre (D-X) │ │  de urnas    │
└──────────────┘ └──────────────┘
┌──────────────┐ ┌──────────────┐
│  🌙          │ │  🗳️          │
│  VÉSPERA     │ │  DIA D       │
│  Instalação  │ │  Seções ao   │
│  (D-1)       │ │  vivo        │
└──────────────┘ └──────────────┘
```

Depois do painel, o token. Duas formas, porque teclado de controle remoto é
sofrimento:

1. **Ler o QR** com a câmera — se o box tiver uma (a maioria não tem).
2. **Digitar os 8 caracteres** num teclado grande na tela. O alfabeto dos
   tokens já exclui `0/O/1/I`, então não há ambiguidade ao ler o cartão.

Uma terceira via, mais prática, é passar tudo por `adb` na hora de instalar —
ver §8.

### 4.2 Painel (todo o resto do tempo)

Tela cheia, sem nenhum elemento do app por cima do conteúdo. O painel web já
traz relógio, status e os dados.

**Escape hatch:** segurar OK por 5 segundos volta à configuração. Sem isso, um
box mal configurado precisaria de reinstalação.

---

## 5. Autenticação

Sem novidade: reusa o `tv_token` que o `SIME_tokens.html` já gera.

| | |
|---|---|
| Tipo do token | `tv` — sem PIN, por design (a TV não tem quem digite) |
| Validade | ~90 dias |
| Onde vive | `EncryptedSharedPreferences` |
| Renovação | O `sime_tv_auth.js` já cuida, dentro da página |

O token de TV concede **leitura da zona**, nunca escrita. Um box levado embora
não permite alterar nada — e o token pode ser revogado no Admin.

**A zona vem embutida na URL** (`/z/7/...`), então o box da 7ª nunca exibe a 94ª
por engano de configuração.

---

## 6. O que o app acrescenta (e o motivo de existir)

Um telão que fica 12 horas ligado no dia da eleição falha de maneiras que um
navegador comum não trata:

| Comportamento | Por quê |
|---|---|
| **Auto-início no boot** | Queda de energia no cartório não pode exigir alguém com controle remoto |
| **`keepScreenOn`** | Sem isso o box dorme no meio da apuração |
| **Reconexão de rede** | Wi-Fi do cartório oscila; recarrega ao voltar, em vez de ficar numa tela morta |
| **Vigia de tela** | Se a página travar (sem heartbeat por N minutos), recarrega sozinha |
| **Anti-burn-in** | Deslocamento de 1–2 px a cada poucos minutos, para telas OLED |
| **Watchdog do app** | `START_STICKY` — se o Android matar o processo por memória, ele volta |

Esse conjunto é o produto. O WebView é só o meio.

---

## 7. Riscos

| Risco | Gravidade | Mitigação |
|---|---|---|
| **WebView antigo do box** | Alta | Motor embarcado — é a razão da decisão em §2 |
| **1 GB de RAM com 4K** | Média | Forçar 1080p; a TV Dia é a mais pesada e precisa ser medida |
| **Box sem câmera** | Baixa | Teclado na tela + `adb` como caminho principal |
| **Wi-Fi instável** | Média | Watchdog + fallback offline que os painéis já têm |
| **APK não assinado / "fontes desconhecidas"** | Baixa | Assinar com chave própria e documentar o passo |

**O maior risco não é técnico:** é descobrir qualquer um desses no dia 4.
Por isso o item mais importante do plano é **testar num box real, cedo** — de
preferência no mesmo modelo que será usado, com a mesma rede do cartório.

---

## 8. Instalação em campo

O caminho realista, para não depender de digitar token no controle:

```bash
adb install sime-tv.apk
adb shell am start -n br.jus.sime.tv/.PainelActivity \
  --es painel "dia" --es token "BX86FPJ7" --es zona "7"
```

Dois comandos por box, com um notebook e um cabo USB. O app grava a
configuração e daí em diante sobe sozinho no boot.

---

## 9. Alternativa considerada

**Fully Kiosk Browser** (a Opção A já registrada em `CONFIGURACAO_GO_LIVE.md`)
entrega boa parte do §6 sem escrever uma linha de código, e **é o caminho certo
se a data apertar**.

Foi descartado como solução definitiva por dois motivos: continua usando o
WebView do sistema — o risco principal permanece — e cobra licença por
dispositivo.

**Recomendação honesta:** instale o Fully num box **esta semana** para validar
que os painéis rodam nesse hardware. Se rodarem, você tem uma contingência
pronta e o app vira melhoria, não dependência. Se não rodarem, você descobriu
em julho que precisa do motor embarcado — que é exatamente o que este projeto
resolve.

---

## 10. Esforço

| Etapa | Estimativa |
|---|---|
| Esqueleto + GeckoView em tela cheia | 0,5 dia |
| Configuração navegável por D-pad | 1 dia |
| Boot, watchdog, reconexão, anti-burn-in | 1 dia |
| Extras por `adb` + assinatura do APK | 0,5 dia |
| Teste num box real | 1 dia |
| **Total** | **~4 dias** |

O teste no box real é o único item que não dá para comprimir, e é o que decide
se o resto valeu.

---

## 11. Estado

Código-fonte completo em [`android-tv/`](../android-tv/): quatro painéis,
GeckoView, auto-início, vigia de tela, reconexão e anti burn-in.

**Não foi compilado nem testado em aparelho** — o ambiente onde foi escrito
(sandbox do Claude Code) tem um proxy de saída que bloqueia `dl.google.com`/
`maven.google.com` e `maven.mozilla.org`, os repositórios de que o Android
Gradle Plugin e o GeckoView dependem. O wrapper do Gradle (`android-tv/gradlew`)
já está commitado, então falta:

1. Compilar numa máquina com internet normal — ver "Compilar" em
   `android-tv/README.md` (Android Studio ou SDK por linha de comando).
2. Instalar num MXQ Pro 4K real e rodar o roteiro de `android-tv/README.md`.

O primeiro item do roteiro — *o painel carrega e sai do fallback* — é o que
valida a decisão do §2. Se o GeckoView der conta onde o WebView de fábrica não
daria, o resto do projeto se sustenta. Se falhar, é ali que se descobre, e
ainda em julho.

### Sobre os dois telões

Com dois aparelhos e quatro modos, a configuração muda conforme a fase:

| Fase | Telão 1 | Telão 2 |
|---|---|---|
| D-X (carga e lacre) | Preparação | Preparação |
| D-1 (véspera) | Expedição | Véspera |
| Dia D | Dia D | Dia D |

São dois comandos `adb` por troca de fase, ou a tela de configuração pelo
controle. Se isso incomodar na prática, cabe um **modo automático** que siga as
datas de `sime_eleicoes` — que agora estão no banco. Não foi implementado por
não ser necessário para dois aparelhos.
