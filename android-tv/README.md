# SIME TV — app Android para TV Box

Exibe os quatro painéis do SIME num telão. Projeto e justificativas em
[`docs/APP_TV_BOX.md`](../docs/APP_TV_BOX.md).

> **Estado: código-fonte completo, ainda não compilado nem testado em aparelho.**
> O ambiente onde foi escrito não tem Android SDK e não pode baixá-lo. O passo
> seguinte é abrir no Android Studio, gerar o APK e rodar num MXQ Pro 4K real —
> é lá que se descobre se as premissas de hardware se confirmam.

## O que ele faz

| | |
|---|---|
| Quatro painéis | Preparação · Expedição · Véspera · Dia D |
| Motor próprio | GeckoView — não depende do WebView velho do box |
| Auto-início | Sobe sozinho depois de queda de energia |
| Tela sempre ligada | `keepScreenOn` |
| Reconexão | Espera crescente, com teto de 60s |
| Vigia | Recarrega se a página parar de dar sinal por 10 min |
| Anti burn-in | Desloca 1 px a cada 5 min |

## Compilar

Precisa de Android Studio (ou o SDK por linha de comando) e JDK 17+.

```bash
cd android-tv
./gradlew assembleRelease
```

O APK sai em `app/build/outputs/apk/release/`. Para instalar num box, ele
precisa ser assinado:

```bash
keytool -genkey -v -keystore sime-tv.keystore -alias sime \
  -keyalg RSA -keysize 2048 -validity 10000

apksigner sign --ks sime-tv.keystore \
  --out sime-tv.apk app/build/outputs/apk/release/app-release-unsigned.apk
```

Guarde o keystore: sem ele não dá para publicar atualização por cima da
instalação existente.

## Instalar num box

O caminho que evita digitar token no controle remoto:

```bash
adb connect <IP_DO_BOX>:5555
adb install sime-tv.apk

# Telão 1 — Dia D, 7ª Zona
adb shell am start -n br.jus.sime.tv/.PainelActivity \
  --es painel dia --es token BX86FPJ7 --es zona 7

# Telão 2 — Expedição, 7ª Zona
adb shell am start -n br.jus.sime.tv/.PainelActivity \
  --es painel expedicao --es token <OUTRO_TOKEN> --es zona 7
```

Valores de `painel`: `preparacao`, `expedicao`, `vespera`, `dia`.

O app grava a configuração e daí em diante sobe sozinho no boot. Quem estiver
só com o controle remoto usa a tela de configuração, que abre na primeira
execução.

Para voltar à configuração depois: **segure OK por 5 segundos** no painel.

## Onde conseguir o token de TV

No `SIME_tokens.html`, gerando um token do tipo `tv`. Ele vale ~90 dias, não
tem PIN (a TV não tem quem digite) e dá **somente leitura** da zona — um box
levado embora não altera nada, e o token é revogável pelo Admin.

## O que testar no primeiro box

Nesta ordem, porque cada item só faz sentido se o anterior passou:

1. **O painel carrega e sai do fallback** — é o teste que valida a decisão do
   GeckoView. Se falhar aqui, nada mais importa.
2. **Realtime chega** — mude algo pelo Admin e veja o telão reagir.
3. **Desligue e religue na tomada** — o painel tem que voltar sozinho.
4. **Tire o Wi-Fi por 2 minutos e devolva** — tem que reconectar sem ajuda.
5. **Deixe ligado algumas horas** — é onde aparece consumo de memória e travamento.

O item 5 é o único que não dá para apressar, e é o que mais se aproxima do dia
4 de outubro.
