// modules/sime_config.js
// Configuração única do Supabase para TODOS os módulos do front.
// Ao apontar para outro projeto Supabase (fork/nova zona), troque só AQUI —
// em vez de editar os 15 arquivos HTML.
//
// Ambos os valores são PÚBLICOS por design (a anon key é feita para ir no
// cliente; quem protege os dados é a RLS). A chave `service_role` NUNCA entra
// aqui nem em qualquer arquivo de modules/ — ela só vive em variáveis de
// ambiente do servidor (Vercel), usada por api/hermes-update.js.
// exigirPin: controla apenas se o CAMPO de PIN aparece nas telas de campo.
// Quem de fato valida é a Edge Function sime-login (SIME_EXIGIR_PIN) — este
// flag sozinho não abre nada, e os dois precisam bater: campo escondido com
// servidor exigindo resulta em "PIN incorreto" para todo mundo.
export const SIME_CONFIG = {
  // Voltou a exigir depois que a supressão (exigirPin=false) ficou inútil na
  // prática: o SIME_EXIGIR_PIN correspondente nunca foi configurado na Edge
  // Function sime-login, então o servidor continuava exigindo PIN e todo
  // login por QR falhava com 401 "PIN incorreto" — sem o cartório perceber
  // que o problema era esse par de flags dessincronizado, não o token.
  exigirPin: true,
  supabaseUrl: 'https://unjhnlcmxbrlonppchux.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuamhubGNteGJybG9ucHBjaHV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNDM1MTEsImV4cCI6MjA5ODkxOTUxMX0.3o3UhHXrLkHYz4ffBev0zb62VwcnPNP-ggbuiJG4vBs',
};
