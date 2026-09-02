// Testa o parser da aba "🎓 Treinamento" (sime_turmas.js, 02/09/2026) — o
// cartório cola o conteúdo da tela de turma do ELO e o SIME extrai
// identificação + instrutores + alunos. Teste de unidade puro (sem browser):
// o parser é a parte arriscada, e ele não depende de DOM nem de Supabase.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

const src = readFileSync(new URL('../modules/sime_turmas.js', import.meta.url), 'utf8');
const ctx = vm.createContext({
  // Gêmea de sime_ui_utils.js — o parser normaliza toda inscrição pra 12
  // dígitos, mesma convenção de sime_atores.inscricao_eleitoral.
  normalizarTituloEleitor: raw => { const d = String(raw || '').replace(/\D/g, ''); return d ? d.padStart(12, '0') : ''; },
  document: { getElementById: () => null },
  window: {},
});
vm.runInContext(src, ctx);
const tuParse = ctx.tuParse;

const TURMA_1 = `turmas de treinamento
1 - Identificação da turma
UF
PI
Zona
7
Modalidade
Presencial
Número da turma
001
Nome da turma
TURMA 1
Tipo função
MRV
Função
-
Local de treinamento
CAMARA MUNICIPAL DE JATOBÁ DO PIAUÍ
Endereço local de treinamento
RUA JOAQUIM TERTO, 320, CENTRO - JÁTOBÁ DO PIAUÍ
Data treinamento
14/09/2026
Início:
08:00
Fim:
12:00
Instruções
Na impossibilidade de realizar o treinamento presencial, fale com o cartório.
Mostrar instruções no Título Net:
Sim
Mostrar instruções na carta de convocação:
Sim
2 - Instrutores
Inscrição
Instrutor
027148661511
BERNARDO BORGES SILVA
3 - Mesários alunos
Inscrição
Mesário Aluno
044475201597
ADERSON DOS SANTOS SILVA
045933751589
ANA BEATRIZ GOMES DA SILVA`;

// 1. Campos de identificação
const r1 = tuParse(TURMA_1);
const t1 = r1.turmas[0];
check('1.1 uma turma reconhecida', r1.turmas.length === 1, `veio ${r1.turmas.length}`);
check('1.2 número com zeros à esquerda preservado', t1.numero === '001', t1.numero);
check('1.3 nome da turma', t1.nome === 'TURMA 1', t1.nome);
check('1.4 data dd/mm/aaaa → ISO', t1.data_treinamento === '2026-09-14', t1.data_treinamento);
check('1.5 horas "Rótulo: valor" na MESMA linha não são lidas como valor de outro campo',
  t1.hora_inicio === '08:00' && t1.hora_fim === '12:00', `${t1.hora_inicio}/${t1.hora_fim}`);
check('1.6 local e endereço separados', /CAMARA MUNICIPAL/.test(t1.local_treinamento) && /JOAQUIM TERTO/.test(t1.endereco_treinamento), t1.local_treinamento);
check('1.7 Sim/Não vira boolean', t1.mostrar_titulo_net === true && t1.mostrar_carta === true, '');
check('1.8 tipo_funcao MRV', t1.tipo_funcao === 'MRV', String(t1.tipo_funcao));
// "Função: -" é como o ELO escreve "sem função específica" (turma de MRV) —
// gravar o traço literal poluiria a tela, então vira null.
check('1.9 Função "-" vira null', t1.funcao === null, String(t1.funcao));
check('1.10 instruções capturadas', /impossibilidade/.test(t1.instrucoes || ''), String(t1.instrucoes));

// 2. Pessoas
const instrutores = t1.pessoas.filter(p => p.papel === 'instrutor');
const alunos = t1.pessoas.filter(p => p.papel === 'aluno');
check('2.1 instrutor separado do aluno', instrutores.length === 1 && alunos.length === 2, `${instrutores.length}/${alunos.length}`);
check('2.2 inscrição casada com o nome da linha seguinte',
  alunos[0].inscricao === '044475201597' && alunos[0].nome === 'ADERSON DOS SANTOS SILVA', JSON.stringify(alunos[0]));
// Cabeçalho da tabela do ELO ("Inscrição"/"Mesário Aluno") não é gente.
check('2.3 cabeçalho da tabela não vira pessoa', !t1.pessoas.some(p => /^(Inscri|Mes[áa]rio Aluno|Instrutor)$/i.test(p.nome)), '');
check('2.4 nenhum aviso numa turma bem formada', r1.avisos.length === 0, JSON.stringify(r1.avisos));

// 3. Inscrição curta é normalizada pra 12 dígitos (mesmo bug de zero à
// esquerda já documentado pro roster — aqui nunca chega a acontecer porque
// o parser normaliza na entrada).
const r3 = tuParse(TURMA_1.replace('044475201597', '44475201597'));
check('3.1 título sem zero à esquerda é normalizado', r3.turmas[0].pessoas.some(p => p.inscricao === '044475201597'), '');

// 4. Várias turmas na mesma colagem (o cartório manda em lote)
const duas = TURMA_1 + '\n' + TURMA_1.replace('001', '002').replace('TURMA 1', 'TURMA 2');
const r4 = tuParse(duas);
check('4.1 duas turmas numa colagem só', r4.turmas.length === 2, String(r4.turmas.length));
check('4.2 números distintos', r4.turmas[0].numero === '001' && r4.turmas[1].numero === '002', '');

// 5. Texto imprestável não quebra nem inventa turma
const r5 = tuParse('bom dia, segue a lista');
check('5.1 texto solto → nenhuma turma, sem exceção', r5.turmas.length === 0, '');
// Turma sem "Número da turma" é ignorada com aviso, nunca gravada com número
// inventado — mesmo critério "nunca adivinha" do resto dos importadores.
const r6 = tuParse(TURMA_1.replace('Número da turma\n001\n', ''));
check('5.2 turma sem número é recusada com aviso', r6.turmas.length === 0 && r6.avisos.length > 0, JSON.stringify(r6.avisos));

const fails = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.n}${r.ok ? '' : ' — ' + r.e}`);
console.log(`\n${results.length - fails.length}/${results.length} ok`);
process.exit(fails.length ? 1 : 0);
