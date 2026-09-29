"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { errorMessage } from "@/lib/api";
import { Alert, Spinner } from "@/components/ui";
import { useAccount } from "@/lib/account";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { fetchProductThread, replyInThread, writeToSeller, type ThreadDetail } from "@/lib/product-chat";
import { Composer, MessageList } from "./product-chat";
import { useT } from "@/lib/i18n";

// Fiche d'un compte : « Discuter avec le vendeur ». Le fil s'ouvre sur place ;
// il est aussi retrouvable dans « Mes discussions ».
export function SellerChatBox({ productId, slug }: { productId: string; slug: string }) {
  const t = useT();
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<ThreadDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setThread(await fetchProductThread(productId));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t("chat.unavailable")));
    }
  }, [productId]);

  useEffect(() => {
    if (open && account.status === "member") void load();
  }, [open, account.status, load]);
  useVisiblePoll(load, 6_000, { enabled: open && Boolean(thread) });

  if (account.status === "guest") {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(`/catalogue/${slug}`)}`}
        className="lux-btn lux-btn-ghost w-full !min-h-[48px] text-[12.5px] uppercase tracking-[0.14em]"
        style={{ borderRadius: 18 }}
      >
        {t("chat.loginToChat")}
      </Link>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="lux-btn lux-btn-ghost w-full !min-h-[48px] text-[12.5px] uppercase tracking-[0.14em]"
        style={{ borderRadius: 18 }}
      >
        {t("chat.open")}
</button>
    );
  }

  return (
    <section className="lux-glass rounded-[22px] p-4" aria-label={t("chat.boxLabel")}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-stone-300">{t("chat.boxTitle")}</h2>
        <div className="flex items-center gap-3">
          {thread && (
            <Link href={`/account/messages?thread=${thread.id}`} className="text-[12px] text-[var(--lux-gold-light)] hover:underline">
              {t("chat.openFull")}
</Link>
          )}
          <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-stone-400 hover:text-white">
            {t("chat.close")}
</button>
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {thread === undefined && !error ? (
        <p className="flex items-center gap-2 text-[13px] text-stone-400">
          <Spinner className="h-4 w-4" /> {t("chat.loading")}
        </p>
      ) : (
        <>
          <div className="max-h-[320px] overflow-y-auto pr-1">
            {thread ? (
              <MessageList messages={thread.messages} showAuthors={false} />
            ) : (
              <p className="py-3 text-[13px] leading-relaxed text-stone-400">
                {t("chat.boxIntro")}
              </p>
            )}
          </div>
          <div className="mt-3">
            <Composer
              placeholder={t("chat.writeSeller")}
              onSend={async (content) => {
                if (thread) await replyInThread(thread.id, content);
                else await writeToSeller(productId, content);
                await load();
              }}
            />
          </div>
        </>
      )}
    </section>
  );
}
