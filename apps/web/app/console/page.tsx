import { redirect } from "next/navigation";

// L'ancienne console est remplacée par /admin (même session, mêmes modules).
export default function ConsoleRedirect() {
  redirect("/admin");
}
