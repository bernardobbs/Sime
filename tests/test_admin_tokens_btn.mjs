// Testa o card "Tokens & QR Codes" na aba Config de SIME_admin.html.
//
// Emitir um cartão de acesso (QR + PIN) é criar credencial de entrada no
// sistema — mesmo nível de "Gerenciar seções" e da gestão de equipe. Por isso
// o card é gated por config_equipe, e a checagem mora em applyUser() (não em
// renderConfig()): o seletor de perfil fica DENTRO da aba Config, que não
// re-renderiza ao trocar de usuário.
import pw from 'playwright';
const { chromium } = pw;

const BASE = 'http://localhost:8917';
const results = [];
const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

const b = await chromium.launch();
const p = await b.newPage();

const erros = [];
p.on('pageerror', e => erros.push(String(e)));

// Equipe de teste cobrindo os dois lados da permissão: coordenador tem
// config_equipe; monitor, gestor_dist e observador não.
await p.addInitScript(() => {
  localStorage.setItem('sime_equipe_v1', JSON.stringify([
    { id: 'u1', nome: 'Rafael A.', iniciais: 'RA', perfil: 'coordenador', cor: '#2a2a2a' },
    { id: 'u2', nome: 'Maria S.',  iniciais: 'MS', perfil: 'monitor',     cor: '#3a5fa0' },
    { id: 'u5', nome: 'Joana O.',  iniciais: 'JO', perfil: 'observador',  cor: '#6a6560' },
  ]));
});

await p.goto(`${BASE}/modules/SIME_admin.html`, { waitUntil: 'load' });
await p.click('#login-offline');
// A aba Equipe é quem popula o seletor #cfg-user (ver renderTeam) — sem passar
// por ela o select fica só com o placeholder.
await p.click('button[onclick="goTab(\'equipe\',this)"]');
await p.click('button[onclick="goTab(\'config\',this)"]');
await p.waitForTimeout(300);

const visivel = async () => p.isVisible('#card-tokens');

// curUser começa como o primeiro da equipe (coordenador) — tem config_equipe.
check('coordenador: card de tokens aparece', await visivel());

const href = await p.getAttribute('#card-tokens a', 'href');
check('botão aponta para SIME_tokens.html', href === 'SIME_tokens.html', href);
const alvo = await p.getAttribute('#card-tokens a', 'target');
check('botão abre em nova aba', alvo === '_blank', alvo);

// Troca para monitor (sem config_equipe) — o seletor está na própria aba
// Config, então isso valida a regressão que motivou mover a checagem.
await p.selectOption('#cfg-user', 'u2');
await p.waitForTimeout(200);
check('monitor: card some sem precisar trocar de aba', !(await visivel()));

await p.selectOption('#cfg-user', 'u5');
await p.waitForTimeout(200);
check('observador: card continua oculto', !(await visivel()));

// Volta pro coordenador — o card tem que reaparecer.
await p.selectOption('#cfg-user', 'u1');
await p.waitForTimeout(200);
check('coordenador de novo: card reaparece', await visivel());

// Sair e voltar da aba (renderConfig roda de novo) não pode reverter o estado.
await p.click('button[onclick="goTab(\'dash\',this)"]');
await p.click('button[onclick="goTab(\'config\',this)"]');
await p.waitForTimeout(200);
check('card sobrevive ao re-render da aba Config', await visivel());

check('nenhum erro JS não tratado', erros.length === 0, erros.join(' | '));

await b.close();

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
