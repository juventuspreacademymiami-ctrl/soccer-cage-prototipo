/* ============================================================
   Conexión con la base de datos compartida (Supabase).

   La URL y la clave "publishable" son públicas por diseño: van en
   la página web de cualquier sitio que use Supabase. La seguridad
   la dan las reglas del servidor (supabase/schema.sql).
   NUNCA poner aquí la clave secreta ni la service_role.

   enabled: false → demo local en el navegador (como siempre).
   Con la base activa, ?modo=demo sigue abriendo la demo local.
   ============================================================ */
window.SOCCERCAGE_CLOUD = {
  enabled: true,
  url: 'https://abrjwvfeymexkwecjpxr.supabase.co',
  key: 'sb_publishable_rFqmTypStQiaEZu4lfaqCg__cziAcGE'
};

/* Dominio propio de cada tienda: al entrar por ese dominio se abre solo esa
   tienda (igual que ?store=…), y el QR y los enlaces del panel lo usan.
   Se completa cuando los subdominios apunten al sitio. */
window.SOCCERCAGE_HOSTS = {
  // 'store.juventuscamps.com': 'camps',
  // 'store.athletumfc.com': 'athletum',
  // 'store.jacademylasvegas.com': 'lasvegas'
};
