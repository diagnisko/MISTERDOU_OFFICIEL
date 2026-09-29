// Module partagé serveur/client (pas de "use client") : le layout racine
// injecte ce script tel quel dans <head>.

export const THEME_KEY = "md-theme";
export const LOCALE_KEY = "md-locale";

/** Exécuté dans <head> avant l'affichage : évite un flash de thème ou de sens d'écriture. */
export const PREFERENCES_BOOT_SCRIPT = `(function(){try{var h=document.documentElement,t=localStorage.getItem("${THEME_KEY}"),l=localStorage.getItem("${LOCALE_KEY}");if(t==="light"){h.dataset.theme="light";h.classList.remove("dark")}else{h.dataset.theme="dark"}if(l==="en"||l==="ar"){h.lang=l;h.dir=l==="ar"?"rtl":"ltr"}if(l){document.cookie="${LOCALE_KEY}="+l+"; path=/; max-age=31536000; samesite=lax"}}catch(e){}})();`;
