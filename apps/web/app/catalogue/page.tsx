import { redirect } from "next/navigation";

// L'ancien catalogue devient « /offres ». Redirection plutôt qu'une seconde
// page : deux URL pour le même contenu, c'est deux pages à maintenir et un
// référencement divisé. Les filtres existants (division, sort, page) sont
// conservés pour ne pas perdre les liens déjà partagés.
export default async function LegacyCatalogueRedirect({
  searchParams,
}: {
  searchParams: Promise<{ division?: string; sort?: string; page?: string }>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (params.division) qs.set("division", params.division);
  if (params.sort) qs.set("sort", params.sort);
  if (params.page) qs.set("page", params.page);
  const q = qs.toString();
  redirect(q ? `/offres?${q}` : "/offres");
}
