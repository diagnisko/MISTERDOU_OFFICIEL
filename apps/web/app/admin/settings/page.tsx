"use client";

import { useEffect, useMemo, useState } from "react";
import { fieldErrors, request } from "@/lib/api";
import { Button, FieldError, SelectInput, TextInput, invalidCls } from "@/components/ui";
import { errorMessage } from "../_lib/api";
import { useAdminList } from "../_lib/hooks";
import { AdminPageHead, ErrorAlert, NoticeAlert, TableCard, TableEmpty, TableLoading } from "../_lib/ui";
import { SETTING_LABELS, groupLabel } from "./labels";

// ---------------------------------------------------------------------------
// Paramètres — GET /admin/settings → [{ key, value, valueType, group,
// description, updatedById, updatedAt }] regroupés visuellement par `group`.
// PATCH /admin/settings/:key { value } — contrôle déduit de valueType.
// ---------------------------------------------------------------------------

type SettingRow = {
  key: string;
  value: unknown;
  valueType: string;
  group: string | null;
  description: string | null;
  updatedById: string | null;
  updatedAt: string | null;
};

function draftFrom(row: SettingRow): string {
  if (row.valueType === "bool") return row.value ? "true" : "false";
  if (row.valueType === "string" || row.valueType === "int") return String(row.value ?? "");
  try {
    return JSON.stringify(row.value, null, 2);
  } catch {
    return String(row.value ?? "");
  }
}

function parseValue(valueType: string, draft: string): unknown {
  if (valueType === "int") {
    const clean = draft.replaceAll(" ", "").trim();
    if (clean === "") throw new Error("À remplir : écrivez un nombre.");
    const parsed = Number(clean);
    if (!Number.isFinite(parsed)) throw new Error("Écrivez un nombre entier, sans lettres.");
    return Math.trunc(parsed);
  }
  if (valueType === "bool") return draft === "true";
  if (valueType === "string") return draft;
  try {
    return JSON.parse(draft);
  } catch {
    throw new Error("Présentation incorrecte : gardez la même forme que la valeur d’origine.");
  }
}

/** Nom affiché d'un réglage : jamais le nom technique. */
const settingName = (row: SettingRow) => SETTING_LABELS[row.key]?.label ?? row.description ?? "Réglage";

export default function SettingsPage() {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ key: string; message: string } | null>(null);

  const list = useAdminList<SettingRow>("/api/v1/admin/settings");

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const row of list.items) next[row.key] = draftFrom(row);
    setDrafts(next);
  }, [list.items]);

  const groups = useMemo(() => {
    const map = new Map<string, SettingRow[]>();
    for (const row of list.items) {
      const group = groupLabel(row.group);
      const bucket = map.get(group);
      if (bucket) bucket.push(row);
      else map.set(group, [row]);
    }
    return [...map.entries()];
  }, [list.items]);

  async function save(row: SettingRow) {
    setSavingKey(row.key);
    setRowError(null);
    list.setNotice(null);
    list.setError(null);
    try {
      const value = parseValue(row.valueType, drafts[row.key] ?? "");
      await request(`/api/v1/admin/settings/${encodeURIComponent(row.key)}`, {
        method: "PATCH",
        body: JSON.stringify({ value }),
      });
      const reloaded = await list.refresh();
      if (reloaded) list.setNotice(`« ${settingName(row)} » enregistré.`);
    } catch (err) {
      // Le message précis du champ (« Entre 0 et 100 %. ») plutôt que le message général.
      setRowError({ key: row.key, message: fieldErrors(err).value ?? errorMessage(err) });
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <>
      <AdminPageHead
        kicker="Paramètres & équipe"
        title="Paramètres"
        meta="Les réglages du site : délais, prix, commissions, coordonnées. Chaque modification est notée dans le journal d’activité."
        action={
          <Button variant="outline" loading={list.refreshing} onClick={() => void list.refresh()}>
            Actualiser
          </Button>
        }
      />

      <ErrorAlert error={list.error} />
      <NoticeAlert notice={list.notice} />

      {list.loading ? (
        <div className="mt-8">
          <TableLoading label="Chargement des paramètres…" />
        </div>
      ) : list.items.length === 0 ? (
        <div className="mt-8">
          <TableCard>
            <TableEmpty label="Aucun paramètre enregistré." />
          </TableCard>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map(([group, rows]) => (
            <section key={group} className="lux-glass rounded-[20px] p-5 sm:p-6">
              <p className="lux-kicker">{group}</p>
              <div className="mt-4 divide-y divide-white/[0.07]">
                {rows.map((row) => {
                  const draft = drafts[row.key] ?? "";
                  const saving = savingKey === row.key;
                  const error = rowError?.key === row.key ? rowError.message : null;
                  const info = SETTING_LABELS[row.key];
                  return (
                    <div key={row.key} className="grid gap-4 py-4 first:pt-0 lg:grid-cols-[1fr_minmax(0,340px)]">
                      <div>
                        <p className="text-[14px] font-medium text-stone-100">{settingName(row)}</p>
                        {info?.help && <p className="mt-1 text-xs leading-relaxed text-stone-400">{info.help}</p>}
                        {row.updatedAt && (
                          <p className="mt-2 text-[11px] text-stone-500">
                            Modifié le {new Date(row.updatedAt).toLocaleDateString("fr-FR")}
                          </p>
                        )}
                      </div>

                      <div className="space-y-3">
                        {row.valueType === "bool" ? (
                          <label className="flex items-center gap-3 text-sm text-stone-300">
                            <input
                              type="checkbox"
                              checked={draft === "true"}
                              onChange={(event) =>
                                setDrafts((prev) => ({ ...prev, [row.key]: event.target.checked ? "true" : "false" }))
                              }
                              className="h-4 w-4 accent-[var(--lux-gold)]"
                            />
                            Oui
                          </label>
                        ) : info?.options ? (
                          <SelectInput value={draft} onChange={(event) => setDrafts((prev) => ({ ...prev, [row.key]: event.target.value }))}>
                            {info.options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </SelectInput>
                        ) : row.valueType === "string" || row.valueType === "int" ? (
                          <div className="flex items-center gap-3">
                            <TextInput
                              inputMode={row.valueType === "int" ? "numeric" : undefined}
                              value={draft}
                              aria-invalid={Boolean(error)}
                              className={invalidCls(error)}
                              onChange={(event) => {
                                setDrafts((prev) => ({ ...prev, [row.key]: event.target.value }));
                                if (rowError?.key === row.key) setRowError(null);
                              }}
                            />
                            {info?.unit && <span className="shrink-0 text-xs text-stone-400">{info.unit}</span>}
                          </div>
                        ) : (
                          <textarea
                            rows={4}
                            value={draft}
                            onChange={(event) => setDrafts((prev) => ({ ...prev, [row.key]: event.target.value }))}
                            className="glass w-full rounded-[14px] px-3.5 py-2.5 font-mono text-xs text-stone-100 outline-none transition-colors border-[rgba(255,255,255,0.12)] focus:border-[rgba(232,71,36,0.6)]"
                          />
                        )}

                        <FieldError message={error} />

                        <div className="flex justify-end">
                          <Button
                            type="button"
                            loading={saving}
                            disabled={savingKey !== null && savingKey !== row.key}
                            onClick={() => void save(row)}
                          >
                            Enregistrer
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
