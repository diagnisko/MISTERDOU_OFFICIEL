"use client";

import { useEffect, useState } from "react";
import { request } from "@/lib/api";
import { IconChat } from "@/components/dash/dash-icons";
import { useT } from "@/lib/i18n";

// Contacts du support (Console > Paramètres) : WhatsApp et e-mail.
// Affichés uniquement là où l'on demande de l'aide, jamais ailleurs.

type Contacts = { whatsapp: string | null; email: string | null };

let cached: Contacts | null = null;

function useSupportContacts(): Contacts | null {
  const [contacts, setContacts] = useState<Contacts | null>(cached);
  useEffect(() => {
    if (cached) return;
    request<Contacts>("/api/v1/support/contacts")
      .then((c) => {
        cached = c;
        setContacts(c);
      })
      .catch(() => setContacts({ whatsapp: null, email: null }));
  }, []);
  return contacts;
}

function whatsappUrl(number: string, text: string) {
  return `https://wa.me/${number.replace(/[^\d]/g, "")}?text=${encodeURIComponent(text)}`;
}

function IconWhatsapp({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.5 1.1 2.7.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.4-.3Z" />
    </svg>
  );
}

function IconMail({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

const CHOICE =
  "flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-start transition hover:border-[rgba(255,106,50,0.4)] hover:bg-white/[0.04]";

/** Page « Aide et support » : message suivi, WhatsApp ou e-mail. */
export function SupportContactChoices({ onMessage }: { onMessage: () => void }) {
  const t = useT();
  const contacts = useSupportContacts();
  return (
    <section className="mt-6">
      <h2 className="text-[15px] font-semibold text-stone-100">{t("contact.title")}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <button type="button" onClick={onMessage} className={CHOICE}>
          <span className="dash-icon !h-9 !w-9 shrink-0"><IconChat size={17} /></span>
          <span>
            <span className="block text-[14px] font-medium text-stone-100">{t("contact.message")}</span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-stone-400">{t("contact.messageHint")}</span>
          </span>
        </button>
        {contacts?.whatsapp && (
          <a href={whatsappUrl(contacts.whatsapp, t("contact.whatsappText"))} target="_blank" rel="noopener noreferrer" className={CHOICE}>
            <span className="dash-icon !h-9 !w-9 shrink-0"><IconWhatsapp size={17} /></span>
            <span>
              <span className="block text-[14px] font-medium text-stone-100">WhatsApp</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-stone-400">{t("contact.whatsappHint")}</span>
            </span>
          </a>
        )}
        {contacts?.email && (
          <a href={`mailto:${contacts.email}`} className={CHOICE}>
            <span className="dash-icon !h-9 !w-9 shrink-0"><IconMail size={17} /></span>
            <span>
              <span className="block text-[14px] font-medium text-stone-100">{t("contact.email")}</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-stone-400">{contacts.email}</span>
            </span>
          </a>
        )}
      </div>
    </section>
  );
}

/** Sous un signalement : WhatsApp en complément, numéro de commande inclus. */
export function WhatsappUrgentLine({ orderNumber }: { orderNumber: string }) {
  const t = useT();
  const contacts = useSupportContacts();
  if (!contacts?.whatsapp) return null;
  return (
    <p className="mt-3 flex items-center gap-2 text-[12px] text-stone-400">
      <IconWhatsapp size={14} />
      {t("contact.urgent")}{" "}
      <a
        href={whatsappUrl(contacts.whatsapp, t("contact.whatsappOrderText", { order: orderNumber }))}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--lux-gold-light)] underline-offset-2 hover:underline"
      >
        {t("contact.urgentLink")}
      </a>
    </p>
  );
}
