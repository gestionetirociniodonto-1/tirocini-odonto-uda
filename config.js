// ==============================================================================
// CONFIGURAZIONE CENTRALE - SISTEMA TIROCINI UD'A (D.M. 653/2022)
// Compilare SUPABASE_URL e SUPABASE_ANON_KEY da: Supabase -> Project Settings -> API
// ==============================================================================

window.UDA_CONFIG = {
  SUPABASE_URL: 'https://gifwjaazrxhwglemzfpp.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpZndqYWF6cnhod2dsZW16ZnBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwMDEzNjAsImV4cCI6MjEwODU3NzM2MH0.-T_blS16bhiDPs4An0p0hrsyHGXNzqlHujONfiK0-9A',

  // URL pubblico del sito (es. 'https://tuo-utente.github.io/tirocini-uda').
  // Se lasciato vuoto, viene rilevato automaticamente dalla barra degli indirizzi.
  PORTAL_BASE_URL: '',

  // Nome della Edge Function per l'invio email automatico
  EMAIL_EDGE_FUNCTION: 'send-credentials',

  // Intestazioni istituzionali (usate nei portali e nei certificati PDF)
  ATENEO_NOME: 'Università degli Studi "G. d\'Annunzio" Chieti-Pescara',
  CDS_NOME: 'Corso di Laurea Magistrale Abilitante in Odontoiatria e Protesi Dentaria',
  NORMATIVA: 'D.M. 653/2022',
  CREDITS: 'Mohaidine Aariouach'
};