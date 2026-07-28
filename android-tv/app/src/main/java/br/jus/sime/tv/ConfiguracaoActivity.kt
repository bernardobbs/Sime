package br.jus.sime.tv

import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * Só aparece na primeira execução — ou quando alguém segura OK por 5s no painel.
 *
 * Tudo aqui é navegável pelo D-pad do controle remoto: o box não tem toque, e
 * mouse/teclado USB nem sempre estão à mão na hora da instalação.
 *
 * O caminho preferido continua sendo passar tudo por adb (docs/APP_TV_BOX.md §8);
 * esta tela é o plano B para quem estiver só com o controle.
 */
class ConfiguracaoActivity : AppCompatActivity() {

    private lateinit var config: Config
    private var escolhido: Painel? = null

    private val botoes = mutableMapOf<Painel, Button>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        config = Config(this)
        setContentView(R.layout.activity_configuracao)

        botoes[Painel.PREPARACAO] = findViewById(R.id.btn_preparacao)
        botoes[Painel.EXPEDICAO] = findViewById(R.id.btn_expedicao)
        botoes[Painel.VESPERA] = findViewById(R.id.btn_vespera)
        botoes[Painel.DIA] = findViewById(R.id.btn_dia)

        botoes.forEach { (painel, botao) ->
            botao.text = "${painel.icone}\n${painel.titulo}\n${painel.descricao}"
            botao.setOnClickListener { selecionar(painel) }
        }

        val campoToken = findViewById<EditText>(R.id.campo_token)
        campoToken.setText(config.token.orEmpty())

        val zonas = findViewById<Spinner>(R.id.campo_zona)
        val opcoes = listOf("7", "94")
        zonas.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, opcoes)
        zonas.setSelection(opcoes.indexOf(config.zona).coerceAtLeast(0))

        findViewById<TextView>(R.id.rodape).text =
            getString(R.string.rodape_servidor, config.servidor)

        findViewById<Button>(R.id.btn_salvar).setOnClickListener {
            val token = campoToken.text.toString().trim().uppercase()
            when {
                escolhido == null ->
                    Toast.makeText(this, R.string.erro_sem_painel, Toast.LENGTH_LONG).show()
                // O gerador usa 8 caracteres sem 0/O/1/I — dá para conferir o
                // tamanho antes de gastar uma viagem até o telão.
                token.length != 8 ->
                    Toast.makeText(this, R.string.erro_token, Toast.LENGTH_LONG).show()
                else -> {
                    config.painel = escolhido
                    config.token = token
                    config.zona = opcoes[zonas.selectedItemPosition]
                    startActivity(Intent(this, PainelActivity::class.java))
                    finish()
                }
            }
        }

        config.painel?.let { selecionar(it) }
        botoes[escolhido ?: Painel.DIA]?.requestFocus()
    }

    private fun selecionar(painel: Painel) {
        escolhido = painel
        botoes.forEach { (p, b) -> b.isSelected = (p == painel) }
        findViewById<TextView>(R.id.escolhido).text =
            getString(R.string.painel_escolhido, painel.titulo)
    }
}
