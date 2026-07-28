package br.jus.sime.tv

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView

/**
 * A tela que fica ligada o dia inteiro.
 *
 * Não desenha nada por cima do painel: relógio, status e dados já vêm da
 * página. O que esta Activity acrescenta é sobrevivência — ver docs/APP_TV_BOX.md §6.
 */
class PainelActivity : AppCompatActivity() {

    private lateinit var config: Config
    private lateinit var geckoView: GeckoView
    private lateinit var sessao: GeckoSession

    private val handler = Handler(Looper.getMainLooper())
    private var ultimoCarregamentoOk = 0L
    private var falhasSeguidas = 0

    // Anti burn-in: telão parado 12h no mesmo layout marca a tela.
    private var deslocamento = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        config = Config(this)

        // Extras de linha de comando — o caminho de instalação em campo:
        //   adb shell am start -n br.jus.sime.tv/.PainelActivity \
        //     --es painel dia --es token BX86FPJ7 --es zona 7
        // Evita digitar o token no controle remoto (ver docs §8).
        aplicarExtras(intent)

        if (!config.configurado) {
            startActivity(Intent(this, ConfiguracaoActivity::class.java))
            finish()
            return
        }

        setContentView(R.layout.activity_painel)
        geckoView = findViewById(R.id.gecko)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        telaCheia()

        sessao = GeckoSession().apply {
            progressDelegate = object : GeckoSession.ProgressDelegate {
                override fun onPageStop(session: GeckoSession, sucesso: Boolean) {
                    if (sucesso) {
                        ultimoCarregamentoOk = System.currentTimeMillis()
                        falhasSeguidas = 0
                    } else {
                        agendarNovaTentativa()
                    }
                }
            }
            navigationDelegate = object : GeckoSession.NavigationDelegate {
                // O painel não navega para fora. Se algo tentar, ignora — não
                // pode aparecer outra página no telão do cartório.
                override fun onLoadRequest(
                    session: GeckoSession,
                    request: GeckoSession.NavigationDelegate.LoadRequest,
                ) = org.mozilla.geckoview.GeckoResult.fromValue(
                    request.uri.startsWith(config.servidor).not()
                )
            }
            open(runtime())
        }
        geckoView.setSession(sessao)
        carregar()

        handler.post(vigia)
        handler.postDelayed(antiBurnIn, INTERVALO_BURNIN)
    }

    private fun aplicarExtras(intent: Intent?) {
        intent ?: return
        intent.getStringExtra("painel")?.let { Painel.porId(it)?.also { p -> config.painel = p } }
        intent.getStringExtra("token")?.let { config.token = it }
        intent.getStringExtra("zona")?.let { config.zona = it }
        intent.getStringExtra("servidor")?.let { config.servidor = it }
    }

    private fun carregar() {
        ultimoCarregamentoOk = System.currentTimeMillis()
        sessao.loadUri(config.url())
    }

    /**
     * Recarrega com espera crescente. Sem o teto, uma queda longa de internet
     * viraria uma tentativa por segundo a noite inteira.
     */
    private fun agendarNovaTentativa() {
        falhasSeguidas++
        val espera = minOf(ESPERA_BASE * falhasSeguidas, ESPERA_MAXIMA)
        handler.postDelayed({ carregar() }, espera)
    }

    /**
     * Se a página parar de dar sinal de vida por muito tempo, recarrega.
     * Cobre o caso mais traiçoeiro: a tela continua desenhada, com dados
     * velhos, e ninguém percebe que congelou.
     */
    private val vigia = object : Runnable {
        override fun run() {
            val parado = System.currentTimeMillis() - ultimoCarregamentoOk
            if (parado > LIMITE_SEM_SINAL) carregar()
            handler.postDelayed(this, INTERVALO_VIGIA)
        }
    }

    private val antiBurnIn = object : Runnable {
        override fun run() {
            deslocamento = (deslocamento + 1) % 3
            geckoView.translationX = (deslocamento - 1).toFloat()
            geckoView.translationY = (deslocamento - 1).toFloat()
            handler.postDelayed(this, INTERVALO_BURNIN)
        }
    }

    private fun telaCheia() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            )
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) telaCheia()
    }

    /**
     * Segurar OK por 5s volta à configuração. Sem essa saída, um box com token
     * errado precisaria ser reinstalado.
     */
    private var okDesde = 0L
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) {
            if (okDesde == 0L) okDesde = System.currentTimeMillis()
            if (System.currentTimeMillis() - okDesde > 5_000) {
                startActivity(Intent(this, ConfiguracaoActivity::class.java))
                finish()
            }
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) {
            okDesde = 0L
            return true
        }
        return super.onKeyUp(keyCode, event)
    }

    // O painel não tem "voltar": sair da tela não é uma ação desejada aqui.
    override fun onBackPressed() { /* ignorado de propósito */ }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (::sessao.isInitialized) sessao.close()
        super.onDestroy()
    }

    companion object {
        private const val INTERVALO_VIGIA = 60_000L
        private const val LIMITE_SEM_SINAL = 10 * 60_000L
        private const val INTERVALO_BURNIN = 5 * 60_000L
        private const val ESPERA_BASE = 5_000L
        private const val ESPERA_MAXIMA = 60_000L

        // Um runtime por processo — criar mais de um derruba o app.
        private var runtimeUnico: GeckoRuntime? = null
    }

    private fun runtime(): GeckoRuntime =
        runtimeUnico ?: GeckoRuntime.create(applicationContext).also { runtimeUnico = it }
}
