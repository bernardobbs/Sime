// modules/sime_acesso_perfil.js
// Fonte única de verdade: quais módulos admin um perfil RESTRITO pode abrir.
// Pedido direto (14/09/2026): "os auxiliares devem ter acesso somente a
// parte de gestão de problemas, consulta a rotas".
//
// Ausente do mapa = sem restrição nenhuma — comportamento de sempre pros
// demais perfis (coordenador, gestor_prob, coord_motoristas, etc. continuam
// abrindo qualquer módulo admin, mesma decisão já documentada pra
// SIME_convocacao.html: "convocação de mesários é trabalho de todo mundo do
// cartório, não de um perfil específico"). Só auxiliar_eleicao tem trava.
//
// Mesmo nível de segurança já usado no resto do app (ex.: aba Zonas só pro
// super_admin em SIME_admin.html/SIME_principal.html): um redirecionamento
// no cliente, não uma barreira de RLS — a proteção de DADO continua sendo a
// RLS por zona de sempre; isto é só navegação/UX, coerente com como todo o
// resto do controle de acesso deste projeto já funciona.
window.SIME_PAGINAS_PERMITIDAS = {
  auxiliar_eleicao: ['SIME_problemas.html', 'SIME_rotas.html'],
};

// true = pode abrir a página informada (ou perfil sem restrição nenhuma).
window.simeAcessoPermitido = function simeAcessoPermitido(perfil, pagina) {
  const permitidas = window.SIME_PAGINAS_PERMITIDAS[perfil];
  if (!permitidas) return true;
  const alvo = pagina || location.pathname.split('/').pop();
  return permitidas.includes(alvo);
};

// Chamar assim que o perfil do usuário logado for conhecido, em toda página
// admin que NÃO esteja sempre liberada (Problemas/Rotas nunca chamam isto —
// não têm restrição pra ninguém). Sem perfil ainda resolvido, nunca bloqueia
// — evita redirecionar por engano antes do login terminar.
window.simeExigirAcesso = function simeExigirAcesso(perfil) {
  if (!perfil) return true;
  if (window.simeAcessoPermitido(perfil)) return true;
  alert('Seu perfil (Auxiliar de Eleição) não tem acesso a este módulo — você será levado de volta ao painel principal.');
  location.replace('SIME_principal.html');
  return false;
};
