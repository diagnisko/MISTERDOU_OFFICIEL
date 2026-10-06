"use client";

import { useState, type ReactNode } from "react";
import {
  MANAGER_PERMISSIONS,
  MANAGER_PERMISSION_LABELS,
  MANAGER_PERMISSION_DESCRIPTIONS,
  SHIFT_DAYS,
  SHIFT_DAY_LABELS,
  USER_STATUSES,
  managerCreateSchema,
  managerUpdateSchema,
} from "@misterdou/shared";
import { request } from "@/lib/api";
import { Alert, Badge, Button, SelectInput, StatusBadge, TextInput } from "@/components/ui";
import { errorMessage, minutesToTime } from "../_lib/api";
import { useAdminList } from "../_lib/hooks";
import {
  AdminModal,
  AdminPageHead,
  DataTable,
  ErrorAlert,
  NoticeAlert,
  RowAction,
  TableCard,
  TableEmpty,
  TableLoading,
} from "../_lib/ui";
import { PasswordConfirmDialog } from "@/components/password-confirm";

// ---------------------------------------------------------------------------
// Équipe — GET /admin/managers (liste), POST/PATCH/DELETE /admin/managers[/:id].
// Validations client calquées sur managerCreateSchema / managerUpdateSchema
// (packages/shared/src/index.ts) : mêmes règles que l'API.
// Un e-mail déjà inscrit (client) rejoint l'équipe avec son compte ; retiré de
// l'équipe, il redevient client. Les créneaux se saisissent en plages de jours
// (« du lundi au mercredi, 14:00 – 18:00 ») et sont enregistrés jour par jour.
// ---------------------------------------------------------------------------

type Shift = { id?: string; day: string; startMinute: number; endMinute: number };

type ManagerRow = {
  id: string;
  title: string | null;
  permissions: string[];
  previousRole: string | null;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    status: string;
    twoFactorEnabled: boolean;
    createdAt: string;
  };
  shifts: Shift[];
};

/** Plage de présence : du jour « from » au jour « to » (inclus), de start à end. */
type FormShift = { from: string; to: string; start: string; end: string };

const DAY_SHORT: Record<string, string> = {
  MONDAY: "Lun",
  TUESDAY: "Mar",
  WEDNESDAY: "Mer",
  THURSDAY: "Jeu",
  FRIDAY: "Ven",
  SATURDAY: "Sam",
  SUNDAY: "Dim",
};

const toMinutes = (time: string) => Number(time.split(":")[0] ?? "0") * 60 + Number(time.split(":")[1] ?? "0");

/** Jours couverts par une plage, dans l'ordre de la semaine (« ven → lun » passe par le week-end). */
function daysOf(range: FormShift): string[] {
  const from = SHIFT_DAYS.indexOf(range.from as (typeof SHIFT_DAYS)[number]);
  const to = SHIFT_DAYS.indexOf(range.to as (typeof SHIFT_DAYS)[number]);
  const count = ((to - from + 7) % 7) + 1;
  return Array.from({ length: count }, (_, i) => SHIFT_DAYS[(from + i) % 7]!);
}

/** Créneaux enregistrés (un par jour) → plages lisibles : jours consécutifs aux mêmes horaires. */
function toRanges(shifts: Shift[]): FormShift[] {
  const byHours = new Map<string, number[]>();
  for (const s of shifts) {
    const key = `${s.startMinute}-${s.endMinute}`;
    const list = byHours.get(key) ?? [];
    list.push(SHIFT_DAYS.indexOf(s.day as (typeof SHIFT_DAYS)[number]));
    byHours.set(key, list);
  }
  const ranges: Array<FormShift & { order: number }> = [];
  for (const [key, days] of byHours) {
    const [startMinute, endMinute] = key.split("-").map(Number) as [number, number];
    const sorted = [...new Set(days)].sort((a, b) => a - b);
    let first = sorted[0]!;
    let prev = first;
    const flush = () =>
      ranges.push({
        from: SHIFT_DAYS[first]!,
        to: SHIFT_DAYS[prev]!,
        start: minutesToTime(startMinute),
        end: minutesToTime(endMinute),
        order: first * 10_000 + startMinute,
      });
    for (const day of sorted.slice(1)) {
      if (day === prev + 1) {
        prev = day;
        continue;
      }
      flush();
      first = day;
      prev = day;
    }
    flush();
  }
  return ranges.sort((a, b) => a.order - b.order).map(({ order: _order, ...range }) => range);
}

function rangeLabel(range: FormShift): string {
  const days = range.from === range.to ? DAY_SHORT[range.from] : `${DAY_SHORT[range.from]} → ${DAY_SHORT[range.to]}`;
  return `${days} · ${range.start}–${range.end}`;
}

type FormState = {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  title: string;
  permissions: string[];
  shifts: FormShift[];
  status: string;
};

function emptyForm(): FormState {
  return {
    email: "",
    firstName: "",
    lastName: "",
    password: "",
    title: "",
    permissions: [],
    shifts: [],
    status: "ACTIVE",
  };
}

function formFromRow(row: ManagerRow): FormState {
  return {
    email: row.user.email,
    firstName: row.user.firstName,
    lastName: row.user.lastName,
    password: "",
    title: row.title ?? "",
    permissions: [...row.permissions],
    shifts: toRanges(row.shifts),
    status: row.user.status,
  };
}

function toPayload(mode: "create" | "edit", form: FormState): unknown {
  const shifts = form.shifts.flatMap((range) =>
    daysOf(range).map((day) => ({ day, startMinute: toMinutes(range.start), endMinute: toMinutes(range.end) })),
  );

  if (mode === "create") {
    return {
      email: form.email.trim(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      ...(form.password ? { password: form.password } : {}),
      ...(form.title.trim() ? { title: form.title.trim() } : {}),
      permissions: form.permissions,
      ...(shifts.length > 0 ? { shifts } : {}),
    };
  }

  return {
    title: form.title.trim() ? form.title.trim() : null,
    permissions: form.permissions,
    shifts,
    ...(form.password ? { password: form.password } : {}),
    status: form.status,
  };
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
      {children}
    </span>
  );
}

export default function TeamPage() {
  const [modal, setModal] = useState<{ mode: "create" } | { mode: "edit"; row: ManagerRow } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagerRow | null>(null);

  const list = useAdminList<ManagerRow>("/api/v1/admin/managers");

  async function createMember(payload: unknown) {
    const created = await request<{ promoted: boolean }>("/api/v1/admin/managers", { method: "POST", body: JSON.stringify(payload) });
    setModal(null);
    await list.refresh(
      created.promoted
        ? "Ce compte client a rejoint l’équipe : à sa prochaine connexion, il arrive dans son espace manager."
        : "Membre ajouté à l’équipe.",
    );
  }

  async function updateMember(row: ManagerRow, payload: unknown) {
    await request(`/api/v1/admin/managers/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    setModal(null);
    await list.refresh("Membre mis à jour.");
  }

  async function deleteMember(row: ManagerRow, password: string) {
    await request(`/api/v1/admin/managers/${row.id}`, { method: "DELETE", body: JSON.stringify({ password }) });
    setDeleteTarget(null);
    await list.refresh(row.previousRole ? "Retiré de l’équipe : c’est de nouveau un compte client." : "Membre retiré de l’équipe.");
  }

  return (
    <>
      <AdminPageHead
        kicker="Paramètres & équipe"
        title="Équipe"
        meta="Managers et leurs permissions par module."
        action={
          <>
            <Button variant="outline" loading={list.refreshing} onClick={() => void list.refresh()}>
              Actualiser
            </Button>
            <Button onClick={() => setModal({ mode: "create" })}>Nouveau membre</Button>
          </>
        }
      />

      <ErrorAlert error={list.error} />
      <NoticeAlert notice={list.notice} />

      <TableCard>
        {list.loading ? (
          <TableLoading label="Chargement de l’équipe…" />
        ) : list.items.length === 0 ? (
          <TableEmpty label="Aucun membre dans l’équipe." />
        ) : (
          <DataTable columns={["Nom", "E-mail", "Titre", "Permissions", "Présence", "Statut", "2FA"]} minWidth={1080}>
            {list.items.map((row) => (
              <tr key={row.id} className="transition hover:bg-white/[0.025]">
                <td className="px-4 py-3.5 text-stone-200">
                  {[row.user.firstName, row.user.lastName].filter(Boolean).join(" ") || "—"}
                </td>
                <td className="max-w-[220px] truncate px-4 py-3.5 text-stone-300">{row.user.email}</td>
                <td className="px-4 py-3.5 text-stone-300">{row.title ?? "—"}</td>
                <td className="px-4 py-3.5">
                  <span className="flex flex-wrap gap-1.5">
                    {row.permissions.length === 0 ? (
                      <span className="text-stone-600">—</span>
                    ) : (
                      row.permissions.map((permission) => (
                        <Badge key={permission} cls="border-white/15 bg-white/5 text-stone-300">
                          {MANAGER_PERMISSION_LABELS[permission as keyof typeof MANAGER_PERMISSION_LABELS] ??
                            permission}
                        </Badge>
                      ))
                    )}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-[12.5px] text-stone-300">
                  {row.shifts.length === 0 ? (
                    <span className="text-stone-500">Sans restriction</span>
                  ) : (
                    <span className="flex flex-col gap-0.5">
                      {toRanges(row.shifts).map((range) => (
                        <span key={rangeLabel(range)} className="whitespace-nowrap">
                          {rangeLabel(range)}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  <StatusBadge status={row.user.status} />
                </td>
                <td className="px-4 py-3.5">
                  <Badge
                    cls={
                      row.user.twoFactorEnabled
                        ? "text-[#6ee7b7] border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.1)]"
                        : "text-stone-400 border-white/15 bg-white/5"
                    }
                  >
                    {row.user.twoFactorEnabled ? "Activée" : "Désactivée"}
                  </Badge>
                </td>
                <td className="px-4 py-3.5">
                  <span className="flex flex-wrap gap-3">
                    <RowAction label="Modifier" onClick={() => setModal({ mode: "edit", row })} />
                    <RowAction label="Supprimer" tone="danger" onClick={() => setDeleteTarget(row)} />
                  </span>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </TableCard>

      {modal && (
        <MemberFormModal
          mode={modal.mode}
          initial={modal.mode === "edit" ? modal.row : undefined}
          onClose={() => setModal(null)}
          onSubmit={(payload) =>
            modal.mode === "edit" ? updateMember(modal.row, payload) : createMember(payload)
          }
        />
      )}

      {deleteTarget && (
        <PasswordConfirmDialog
          title="Retirer ce membre"
          confirmLabel="Supprimer"
          message={
            deleteTarget.previousRole ? (
              <>
                Retirer <strong className="text-stone-100">{deleteTarget.user.email}</strong> de l’équipe ? Ses permissions et
                ses créneaux sont effacés ; son compte redevient un compte client (commandes et mot de passe intacts).
              </>
            ) : (
              <>
                Supprimer définitivement <strong className="text-stone-100">{deleteTarget.user.email}</strong> de l’équipe ? Ses
                permissions et ses créneaux seront perdus, et ce compte d’équipe sera désactivé.
              </>
            )
          }
          onClose={() => setDeleteTarget(null)}
          onConfirm={(password) => deleteMember(deleteTarget, password)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function MemberFormModal({
  mode,
  initial,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial?: ManagerRow;
  onClose: () => void;
  onSubmit: (payload: unknown) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => (initial ? formFromRow(initial) : emptyForm()));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function patch(partial: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function togglePermission(permission: string) {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter((item) => item !== permission)
        : [...prev.permissions, permission],
    }));
  }

  function addShift() {
    setForm((prev) => ({ ...prev, shifts: [...prev.shifts, { from: "MONDAY", to: "FRIDAY", start: "09:00", end: "18:00" }] }));
  }

  function updateShift(index: number, partial: Partial<FormShift>) {
    setForm((prev) => ({
      ...prev,
      shifts: prev.shifts.map((shift, i) => (i === index ? { ...shift, ...partial } : shift)),
    }));
  }

  function removeShift(index: number) {
    setForm((prev) => ({ ...prev, shifts: prev.shifts.filter((_, i) => i !== index) }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const badRange = form.shifts.find((range) => toMinutes(range.end) <= toMinutes(range.start));
    if (badRange) {
      setError(`Créneau « ${rangeLabel(badRange)} » : l’heure de fin doit être après l’heure de début.`);
      return;
    }
    const payload = toPayload(mode, form);
    const parsed = mode === "create" ? managerCreateSchema.safeParse(payload) : managerUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Formulaire invalide.");
      return;
    }
    setPending(true);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={mode === "create" ? "Nouveau membre" : "Modifier ce membre"}
      onClose={onClose}
      width="max-w-2xl"
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <Label>E-mail</Label>
            {mode === "create" && (
              <span className="mb-2 block text-[11.5px] leading-relaxed text-stone-500">
                Déjà inscrit comme client ? Saisissez son e-mail : son compte rejoint l’équipe et il garde son mot de passe.
                Retiré de l’équipe, il redevient client.
              </span>
            )}
            <TextInput
              type="email"
              required
              value={form.email}
              readOnly={mode === "edit"}
              onChange={(event) => patch({ email: event.target.value })}
              placeholder="prenom.nom@misterdou.com"
              className={mode === "edit" ? "opacity-70" : undefined}
            />
          </label>
          <label className="block">
            <Label>Prénom</Label>
            <TextInput
              required
              value={form.firstName}
              readOnly={mode === "edit"}
              onChange={(event) => patch({ firstName: event.target.value })}
            />
          </label>
          <label className="block">
            <Label>Nom</Label>
            <TextInput
              required
              value={form.lastName}
              readOnly={mode === "edit"}
              onChange={(event) => patch({ lastName: event.target.value })}
            />
          </label>
          <label className="block">
            <Label>Mot de passe {mode === "edit" ? "(laisser vide pour conserver)" : ""}</Label>
            <TextInput
              type="password"
              value={form.password}
              onChange={(event) => patch({ password: event.target.value })}
              placeholder={mode === "create" ? "8 caractères minimum" : ""}
              autoComplete="new-password"
            />
            {mode === "create" && (
              <span className="mt-1.5 block text-[11px] text-stone-500">
                Obligatoire pour un nouveau compte. Compte client existant : laissez vide (sauf inscription Google sans mot de passe).
              </span>
            )}
          </label>
          <label className="block">
            <Label>Titre</Label>
            <TextInput
              value={form.title}
              onChange={(event) => patch({ title: event.target.value })}
              placeholder="Responsable opérations"
            />
          </label>
          {mode === "edit" && (
            <label className="block sm:col-span-2">
              <Label>Statut du compte</Label>
              <SelectInput value={form.status} onChange={(event) => patch({ status: event.target.value })}>
                {USER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status === "ACTIVE"
                      ? "Actif"
                      : status === "SUSPENDED"
                        ? "Suspendu"
                        : "Banni"}
                  </option>
                ))}
              </SelectInput>
            </label>
          )}
        </div>

        <div>
          <Label>Permissions</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {MANAGER_PERMISSIONS.map((permission) => {
              const checked = form.permissions.includes(permission);
              return (
                <label
                  key={permission}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                    checked
                      ? "border-[rgba(232,71,36,0.45)] bg-amber-300/[0.07]"
                      : "border-white/10 bg-black/10 hover:bg-white/[0.04]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePermission(permission)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--lux-gold)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-stone-200">
                      {MANAGER_PERMISSION_LABELS[permission]}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-stone-500">
                      {MANAGER_PERMISSION_DESCRIPTIONS[permission]}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <Label>Créneaux de présence</Label>
            <button
              type="button"
              onClick={addShift}
              className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--lux-gold-light)] transition hover:opacity-80"
            >
              + Ajouter un créneau
            </button>
          </div>
          {form.shifts.length === 0 ? (
            <p className="text-xs text-stone-500">Aucun créneau — la disponibilité ne sera pas restreinte.</p>
          ) : (
            <div className="mt-2 space-y-2.5">
              {form.shifts.map((shift, index) => (
                <div key={index} className="rounded-2xl border border-white/10 bg-black/10 p-3">
                  <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 sm:grid-cols-[auto_1fr_auto_1fr]">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-stone-500">Du</span>
                    <SelectInput value={shift.from} onChange={(event) => updateShift(index, { from: event.target.value })}>
                      {SHIFT_DAYS.map((day) => (
                        <option key={day} value={day}>
                          {SHIFT_DAY_LABELS[day]}
                        </option>
                      ))}
                    </SelectInput>
                    <span className="text-[11px] uppercase tracking-[0.14em] text-stone-500">au</span>
                    <SelectInput value={shift.to} onChange={(event) => updateShift(index, { to: event.target.value })}>
                      {SHIFT_DAYS.map((day) => (
                        <option key={day} value={day}>
                          {SHIFT_DAY_LABELS[day]}
                        </option>
                      ))}
                    </SelectInput>
                    <span className="text-[11px] uppercase tracking-[0.14em] text-stone-500">De</span>
                    <TextInput type="time" value={shift.start} onChange={(event) => updateShift(index, { start: event.target.value })} />
                    <span className="text-[11px] uppercase tracking-[0.14em] text-stone-500">à</span>
                    <TextInput type="time" value={shift.end} onChange={(event) => updateShift(index, { end: event.target.value })} />
                  </div>
                  <div className="mt-2.5 flex items-center justify-between gap-3">
                    <span className="text-[12px] text-[#ffb08a]">{rangeLabel(shift)}</span>
                    <button
                      type="button"
                      onClick={() => removeShift(index)}
                      className="rounded-xl border border-white/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] text-stone-400 transition hover:text-red-200"
                    >
                      Retirer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <Alert tone="danger">{error}</Alert>}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button type="submit" loading={pending}>
            {mode === "create" ? "Créer le membre" : "Enregistrer"}
          </Button>
        </div>
      </form>
    </AdminModal>
  );
}
