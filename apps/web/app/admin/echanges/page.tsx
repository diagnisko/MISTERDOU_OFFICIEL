"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { errorMessage } from "@/lib/api";
import { Segmented } from "@/components/dash/dash-ui";
import { ExchangeDetail, ExchangeList } from "@/components/exchanges/exchange-views";
import { exchangesApi, type ExchangeSummary } from "@/lib/exchanges";
import { AdminPageHead } from "../_lib/ui";

type Filter = "todo" | "open" | "closed" | "all";

// Échanges de comptes : l'équipe (permission « Échanges ») récupère et vérifie
// le compte confié par le client, puis valide ou refuse ; elle répond aussi aux
// demandes sur les comptes MISTERDOU.
function AdminExchanges() {
  const id = useSearchParams().get("id");
  const [filter, setFilter] = useState<Filter>("todo");
  const [items, setItems] = useState<ExchangeSummary[]>([]);
  const [todo, setTodo] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) return;
    setLoading(true);
    exchangesApi
      .team(filter)
      .then((res) => {
        setItems(res.items);
        setTodo(res.todo);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id, filter]);

  if (id) return <ExchangeDetail id={id} backHref="/admin/echanges" />;

  return (
    <div className="space-y-6">
      <AdminPageHead
        kicker="Relation"
        title="Échanges de comptes"
        meta="Le client confie son compte à l’équipe avant toute remise : connectez-vous, comparez avec la vidéo, puis validez ou refusez. Les comptes MISTERDOU : c’est vous qui annoncez le complément."
      />
      <Segmented
        label="Filtrer les échanges"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "todo", label: "À traiter", count: todo },
          { value: "open", label: "En cours" },
          { value: "closed", label: "Terminés" },
          { value: "all", label: "Tous" },
        ]}
      />
      <section className="dash-card p-5">
        <ExchangeList
          items={items}
          loading={loading}
          error={error}
          base="/admin/echanges"
          side="team"
          empty={filter === "todo" ? "Rien à traiter : aucun compte à vérifier ni demande MISTERDOU sans réponse." : "Aucun échange."}
        />
      </section>
    </div>
  );
}

export default function AdminExchangesPage() {
  return (
    <Suspense>
      <AdminExchanges />
    </Suspense>
  );
}
