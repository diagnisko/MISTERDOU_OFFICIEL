"use client";

import { useRouter } from "next/navigation";
import { DashHeading } from "@/components/dash/dash-ui";
import { OfferForm } from "@/components/offers/offer-form";
import { SellerFrame } from "@/components/seller/seller-frame";
import { useT } from "@/lib/i18n";

// Nouvelle offre d'un vendeur : publiée dès l'enregistrement.
export default function NewSellerOfferPage() {
  const t = useT();
  const router = useRouter();
  return (
    <SellerFrame>
      <DashHeading
        greeting={t("seller.area")}
        title={t("offer.newTitle")}
      />
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[#b8a6a1]">{t("offer.newLead")}</p>
      <div className="mt-6 max-w-3xl">
        <OfferForm apiBase="/api/v1/seller/offers" onDone={() => router.push("/seller")} doneLabel={t("offer.finish")} />
      </div>
    </SellerFrame>
  );
}
