import { redirect } from "next/navigation";

// La connexion de l'équipe passe par la page de connexion du site (/login) :
// le code à 6 chiffres y est demandé pour un compte d'administration.
export default function AdminSignInPage() {
  redirect("/login");
}
