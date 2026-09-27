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
  ConfirmDialog,
  DataTable,
  ErrorAlert,
  NoticeAlert,
  RowAction,
  TableCard,
  TableEmpty,
  TableLoading,
} from "../_lib/ui";

// ---------------------------------------------------------------------------
// Équipe — GET /admin/managers (liste), POST/PATCH/DELETE /admin/managers[/:id].
// Validations client calquées sur managerCreateSchema / managerUpdateSchema
// (packages/shared/src/index.ts) : mêmes règles que l'API.
// ---------------------------------------------------------------------------

type Shift = { id?: string; day: string; startMinute: number; endMinute: number };

type ManagerRow = {
  id: string;
  title: string | null;
  permissions: string[];
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

type FormShift = { day: string; start: string; end: string };

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
    shifts: row.shifts.map((shift) => ({
      day: shift.day,
      start: minutesToTime(shift.startMinute),
      end: minutesToTime(shift.endMinute),
    })),
    status: row.user.status,
  };
}

function toPayload(mode: "create" | "edit", form: FormState): unknown {
  const shifts = form.shifts.map((shift) => ({
    day: shift.day,
    startMinute: Number(shift.start.split(":")[0] ?? "0") * 60 + Number(shift.start.split(":")[1] ?? "0"),
    endMinute: Number(shift.end.split(":")[0] ?? "0") * 60 + Number(shift.end.split(":")[1] ?? "0"),
  }));

  if (mode === "create") {
    return {
      email: form.email.trim(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      password: form.password,
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
    await request("/api/v1/admin/managers", { method: "POST", body: JSON.stringify(payload) });
    setModal(null);
    await list.refresh("Membre ajouté à l’équipe.");
  }

  async function updateMember(row: ManagerRow, payload: unknown) {
    await request(`/api/v1/admin/managers/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    setModal(null);
    await list.refresh("Membre mis à jour.");
  }

  async function deleteMember(row: ManagerRow) {
    await request(`/api/v1/admin/managers/${row.id}`, { method: "DELETE", body: JSON.stringify({}) });
    setDeleteTarget(null);
    await list.refresh("Membre retiré de l’équipe.");
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
          <DataTable columns={["Nom", "E-mail", "Titre", "Permissions", "Statut", "2FA"]} minWidth={960}>
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
        <ConfirmDialog
          title="Retirer ce membre"
          danger
          confirmLabel="Supprimer"
          message={
            <>
              Supprimer définitivement{" "}
              <strong className="text-stone-100">{deleteTarget.user.email}</strong> de l’équipe ? Ses
              permissions et ses créneaux seront perdus.
            </>
          }
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteMember(deleteTarget)}
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
    setForm((prev) => ({ ...prev, shifts: [...prev.shifts, { day: "MONDAY", start: "09:00", end: "18:00" }] }));
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
            <Label>
              Mot de passe {mode === "edit" ? "(laisser vide pour conserver)" : ""}
              {mode === "create" && <span className="ml-1 text-[var(--lux-gold, #f59e0b)]">*</span>}
            </Label>
            <TextInput
              type="password"
              required={mode === "create"}
              value={form.password}
              onChange={(event) => patch({ password: event.target.value })}
              placeholder={mode === "create" ? "8 caractères minimum" : ""}
              autoComplete="new-password"
            />
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
                      ? "border-[rgba(245,158,11,0.45)] bg-amber-300/[0.07]"
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
            <div className="mt-2 space-y-2">
              {form.shifts.map((shift, index) => (
                <div key={`${shift.day}-${index}`} className="flex flex-wrap items-center gap-2">
                  <SelectInput
                    value={shift.day}
                    onChange={(event) => updateShift(index, { day: event.target.value })}
                    className="min-w-[140px] flex-1"
                  >
                    {SHIFT_DAYS.map((day) => (
                      <option key={day} value={day}>
                        {SHIFT_DAY_LABELS[day]}
                      </option>
                    ))}
                  </SelectInput>
                  <TextInput
                    type="time"
                    value={shift.start}
                    onChange={(event) => updateShift(index, { start: event.target.value })}
                    className="w-32"
                  />
                  <TextInput
                    type="time"
                    value={shift.end}
                    onChange={(event) => updateShift(index, { end: event.target.value })}
                    className="w-32"
                  />
                  <button
                    type="button"
                    onClick={() => removeShift(index)}
                    className="rounded-xl border border-white/10 px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-stone-400 transition hover:text-red-200"
                  >
                    Retirer
                  </button>
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
