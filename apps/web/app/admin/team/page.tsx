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
import { Alert, Button, SelectInput, TextInput } from "@/components/ui";
import { errorMessage, minutesToTime } from "../_lib/api";
import { useAdminList } from "../_lib/hooks";
import { AdminModal, AdminPageHead, ErrorAlert, NoticeAlert, TableCard, TableEmpty, TableLoading } from "../_lib/ui";
import { PasswordConfirmDialog } from "@/components/password-confirm";

// ---------------------------------------------------------------------------
// Équipe — GET /admin/managers (liste), POST/PATCH/DELETE /admin/managers[/:id].
// Une barre par membre, trois boutons : Permissions (et compte), Créneaux,
// Supprimer. Hors de ses créneaux (heure de Dakar), la console est fermée au
// membre : c'est l'API qui refuse (lib/shifts.ts). Validations client calquées
// sur managerCreateSchema / managerUpdateSchema (packages/shared).
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

const STATUS_TEXT: Record<string, string> = { ACTIVE: "Actif", SUSPENDED: "Suspendu", BANNED: "Banni" };

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

function toShiftPayload(ranges: FormShift[]) {
  return ranges.flatMap((range) =>
    daysOf(range).map((day) => ({ day, startMinute: toMinutes(range.start), endMinute: toMinutes(range.end) })),
  );
}

/** Message d'erreur si une plage finit avant de commencer. */
function badRangeMessage(ranges: FormShift[]): string | null {
  const bad = ranges.find((range) => toMinutes(range.end) <= toMinutes(range.start));
  return bad ? `Créneau « ${rangeLabel(bad)} » : l’heure de fin doit être après l’heure de début.` : null;
}

function fullName(row: ManagerRow): string {
  return [row.user.firstName, row.user.lastName].filter(Boolean).join(" ") || row.user.email;
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
      {children}
    </span>
  );
}

type Dialog =
  | { kind: "create" }
  | { kind: "permissions"; row: ManagerRow }
  | { kind: "shifts"; row: ManagerRow }
  | { kind: "delete"; row: ManagerRow };

export default function TeamPage() {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const list = useAdminList<ManagerRow>("/api/v1/admin/managers");

  async function createMember(payload: unknown) {
    const created = await request<{ promoted: boolean }>("/api/v1/admin/managers", { method: "POST", body: JSON.stringify(payload) });
    setDialog(null);
    await list.refresh(
      created.promoted
        ? "Ce compte client a rejoint l’équipe : à sa prochaine connexion, il arrive dans son espace manager."
        : "Membre ajouté à l’équipe.",
    );
  }

  async function updateMember(row: ManagerRow, payload: unknown, notice: string) {
    await request(`/api/v1/admin/managers/${row.id}`, { method: "PATCH", body: JSON.stringify(payload) });
    setDialog(null);
    await list.refresh(notice);
  }

  async function deleteMember(row: ManagerRow, password: string) {
    await request(`/api/v1/admin/managers/${row.id}`, { method: "DELETE", body: JSON.stringify({ password }) });
    setDialog(null);
    await list.refresh(row.previousRole ? "Retiré de l’équipe : c’est de nouveau un compte client." : "Membre retiré de l’équipe.");
  }

  return (
    <>
      <AdminPageHead
        kicker="Paramètres & équipe"
        title="Équipe"
        meta="Qui fait partie de l’équipe, ce que chacun peut faire et quand."
        action={
          <>
            <Button variant="outline" loading={list.refreshing} onClick={() => void list.refresh()}>
              Actualiser
            </Button>
            <Button onClick={() => setDialog({ kind: "create" })}>Nouveau membre</Button>
          </>
        }
      />

      <ErrorAlert error={list.error} />
      <NoticeAlert notice={list.notice} />

      {list.loading ? (
        <TableCard>
          <TableLoading label="Chargement de l’équipe…" />
        </TableCard>
      ) : list.items.length === 0 ? (
        <TableCard>
          <TableEmpty label="Aucun membre dans l’équipe." />
        </TableCard>
      ) : (
        <ul className="mt-6 space-y-2.5">
          {list.items.map((row) => (
            <MemberBar
              key={row.id}
              row={row}
              onPermissions={() => setDialog({ kind: "permissions", row })}
              onShifts={() => setDialog({ kind: "shifts", row })}
              onDelete={() => setDialog({ kind: "delete", row })}
            />
          ))}
        </ul>
      )}

      {dialog?.kind === "create" && <CreateMemberModal onClose={() => setDialog(null)} onSubmit={createMember} />}

      {dialog?.kind === "permissions" && (
        <PermissionsModal
          row={dialog.row}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => updateMember(dialog.row, payload, "Permissions enregistrées.")}
        />
      )}

      {dialog?.kind === "shifts" && (
        <ShiftsModal
          row={dialog.row}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => updateMember(dialog.row, payload, "Créneaux enregistrés.")}
        />
      )}

      {dialog?.kind === "delete" && (
        <PasswordConfirmDialog
          title="Retirer ce membre"
          confirmLabel="Supprimer"
          message={
            dialog.row.previousRole ? (
              <>
                Retirer <strong className="text-stone-100">{dialog.row.user.email}</strong> de l’équipe ? Ses permissions et
                ses créneaux sont effacés ; son compte redevient un compte client (commandes et mot de passe intacts).
              </>
            ) : (
              <>
                Supprimer définitivement <strong className="text-stone-100">{dialog.row.user.email}</strong> de l’équipe ? Ses
                permissions et ses créneaux seront perdus, et ce compte d’équipe sera désactivé.
              </>
            )
          }
          onClose={() => setDialog(null)}
          onConfirm={(password) => deleteMember(dialog.row, password)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Une barre par membre
// ---------------------------------------------------------------------------

function MemberBar({
  row,
  onPermissions,
  onShifts,
  onDelete,
}: {
  row: ManagerRow;
  onPermissions: () => void;
  onShifts: () => void;
  onDelete: () => void;
}) {
  const name = fullName(row);
  const initials = [row.user.firstName, row.user.lastName].map((part) => part?.[0] ?? "").join("").toUpperCase() || "?";
  const ranges = toRanges(row.shifts);
  const active = row.user.status === "ACTIVE";
  const presence = ranges.length === 0 ? "Accès à toute heure" : ranges.length === 1 ? rangeLabel(ranges[0]!) : `${ranges.length} créneaux`;

  return (
    <li className="dash-card flex flex-wrap items-center gap-x-4 gap-y-3 !rounded-2xl px-4 py-3.5 sm:flex-nowrap">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#ff8a5c,#c83a24)] text-[13px] font-bold text-white">
        {initials}
      </span>

      <span className="min-w-0 flex-1 basis-48">
        <span className="flex items-center gap-2">
          <span className="truncate text-[14.5px] font-semibold text-stone-100">{name}</span>
          {!active && (
            <span className="shrink-0 rounded-full border border-[rgba(239,68,68,0.4)] px-2 py-px text-[10.5px] font-semibold text-[#fca5a5]">
              {STATUS_TEXT[row.user.status] ?? row.user.status}
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-stone-500">
          {row.title ? `${row.title} · ` : ""}
          {row.user.email}
        </span>
      </span>

      <span className="hidden min-w-0 shrink-0 flex-col items-end text-right text-[12px] leading-relaxed text-stone-400 md:flex">
        <span title={row.permissions.map((p) => MANAGER_PERMISSION_LABELS[p as keyof typeof MANAGER_PERMISSION_LABELS] ?? p).join(", ")}>
          {row.permissions.length} permission{row.permissions.length > 1 ? "s" : ""}
          <span className={row.user.twoFactorEnabled ? "text-[#6ee7b7]" : "text-stone-500"}>
            {" · "}
            {row.user.twoFactorEnabled ? "2FA activée" : "2FA désactivée"}
          </span>
        </span>
        <span className="max-w-[220px] truncate text-stone-500">{presence}</span>
      </span>

      <span className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto">
        <BarButton onClick={onPermissions}>Permissions</BarButton>
        <BarButton onClick={onShifts}>Créneaux</BarButton>
        <BarButton onClick={onDelete} danger>
          Supprimer
        </BarButton>
      </span>
    </li>
  );
}

function BarButton({ children, onClick, danger = false }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition ${
        danger
          ? "border-[rgba(239,68,68,0.35)] text-[#fca5a5] hover:bg-[rgba(239,68,68,0.1)]"
          : "border-white/12 text-stone-200 hover:border-[rgba(255,138,92,0.5)] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Briques des fenêtres : choix des permissions, éditeur de créneaux
// ---------------------------------------------------------------------------

function PermissionPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {MANAGER_PERMISSIONS.map((permission) => {
        const checked = value.includes(permission);
        return (
          <label
            key={permission}
            className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
              checked ? "border-[rgba(232,71,36,0.45)] bg-amber-300/[0.07]" : "border-white/10 bg-black/10 hover:bg-white/[0.04]"
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onChange(checked ? value.filter((p) => p !== permission) : [...value, permission])}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--lux-gold)]"
            />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-stone-200">{MANAGER_PERMISSION_LABELS[permission]}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-stone-500">
                {MANAGER_PERMISSION_DESCRIPTIONS[permission]}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function ShiftEditor({ value, onChange }: { value: FormShift[]; onChange: (next: FormShift[]) => void }) {
  const update = (index: number, partial: Partial<FormShift>) =>
    onChange(value.map((shift, i) => (i === index ? { ...shift, ...partial } : shift)));

  return (
    <div>
      {value.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-xs text-stone-500">
          Aucun créneau : accès à la console à toute heure.
        </p>
      ) : (
        <div className="space-y-2.5">
          {value.map((shift, index) => (
            <div key={index} className="rounded-2xl border border-white/10 bg-black/10 p-3">
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 sm:grid-cols-[auto_1fr_auto_1fr]">
                <span className="text-[11px] uppercase tracking-[0.14em] text-stone-500">Du</span>
                <SelectInput value={shift.from} onChange={(event) => update(index, { from: event.target.value })}>
                  {SHIFT_DAYS.map((day) => (
                    <option key={day} value={day}>
                      {SHIFT_DAY_LABELS[day]}
                    </option>
                  ))}
                </SelectInput>
                <span className="text-[11px] uppercase tracking-[0.14em] text-stone-500">au</span>
                <SelectInput value={shift.to} onChange={(event) => update(index, { to: event.target.value })}>
                  {SHIFT_DAYS.map((day) => (
                    <option key={day} value={day}>
                      {SHIFT_DAY_LABELS[day]}
                    </option>
                  ))}
                </SelectInput>
                <span className="text-[11px] uppercase tracking-[0.14em] text-stone-500">De</span>
                <TextInput type="time" value={shift.start} onChange={(event) => update(index, { start: event.target.value })} />
                <span className="text-[11px] uppercase tracking-[0.14em] text-stone-500">à</span>
                <TextInput type="time" value={shift.end} onChange={(event) => update(index, { end: event.target.value })} />
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3">
                <span className="text-[12px] text-[#ffb08a]">{rangeLabel(shift)}</span>
                <button
                  type="button"
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                  className="rounded-xl border border-white/10 px-3 py-1.5 text-[11px] text-stone-400 transition hover:text-red-200"
                >
                  Retirer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => onChange([...value, { from: "MONDAY", to: "FRIDAY", start: "09:00", end: "18:00" }])}
        className="mt-3 text-[12px] font-medium text-[#ff8a5c] transition hover:opacity-80"
      >
        + Ajouter un créneau
      </button>
    </div>
  );
}

/** Pied de fenêtre commun : erreur, Annuler, Enregistrer. */
function ModalFooter({ error, pending, onClose, submitLabel }: { error: string | null; pending: boolean; onClose: () => void; submitLabel: string }) {
  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" type="button" onClick={onClose} disabled={pending}>
          Annuler
        </Button>
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </>
  );
}

/** Envoi d'un formulaire : validation, attente, message d'erreur de l'API. */
function useSubmit(onSubmit: (payload: unknown) => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function run(payload: unknown, schema: { safeParse: (v: unknown) => { success: true; data: unknown } | { success: false; error: { issues: Array<{ message: string }> } } }) {
    setError(null);
    const parsed = schema.safeParse(payload);
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
  return { error, setError, pending, run };
}

// ---------------------------------------------------------------------------
// Fenêtres
// ---------------------------------------------------------------------------

function PermissionsModal({
  row,
  onClose,
  onSubmit,
}: {
  row: ManagerRow;
  onClose: () => void;
  onSubmit: (payload: unknown) => Promise<void>;
}) {
  const [permissions, setPermissions] = useState<string[]>(row.permissions);
  const [title, setTitle] = useState(row.title ?? "");
  const [status, setStatus] = useState(row.user.status);
  const [password, setPassword] = useState("");
  const { error, pending, run } = useSubmit(onSubmit);

  return (
    <AdminModal title={`Permissions — ${fullName(row)}`} onClose={onClose} width="max-w-2xl">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            {
              permissions,
              title: title.trim() || null,
              status,
              ...(password ? { password } : {}),
            },
            managerUpdateSchema,
          );
        }}
        className="space-y-5"
      >
        <div>
          <Label>Ce que ce membre peut faire</Label>
          <PermissionPicker value={permissions} onChange={setPermissions} />
        </div>

        <details className="group rounded-2xl border border-white/10 bg-black/10 p-4">
          <summary className="cursor-pointer list-none text-[13px] font-medium text-stone-300">
            Compte : titre, statut, mot de passe
            <span className="ml-2 text-stone-500 group-open:hidden">▾</span>
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <Label>Titre</Label>
              <TextInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Responsable opérations" />
            </label>
            <label className="block">
              <Label>Statut du compte</Label>
              <SelectInput value={status} onChange={(event) => setStatus(event.target.value)}>
                {USER_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {STATUS_TEXT[value] ?? value}
                  </option>
                ))}
              </SelectInput>
            </label>
            <label className="block sm:col-span-2">
              <Label>Nouveau mot de passe (laisser vide pour le garder)</Label>
              <TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
            </label>
          </div>
        </details>

        <ModalFooter error={error} pending={pending} onClose={onClose} submitLabel="Enregistrer" />
      </form>
    </AdminModal>
  );
}

function ShiftsModal({
  row,
  onClose,
  onSubmit,
}: {
  row: ManagerRow;
  onClose: () => void;
  onSubmit: (payload: unknown) => Promise<void>;
}) {
  const [ranges, setRanges] = useState<FormShift[]>(() => toRanges(row.shifts));
  const { error, setError, pending, run } = useSubmit(onSubmit);

  return (
    <AdminModal title={`Créneaux — ${fullName(row)}`} onClose={onClose} width="max-w-2xl">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const bad = badRangeMessage(ranges);
          if (bad) {
            setError(bad);
            return;
          }
          void run({ shifts: toShiftPayload(ranges) }, managerUpdateSchema);
        }}
        className="space-y-5"
      >
        <p className="text-[12.5px] leading-relaxed text-stone-400">
          Jours et heures où ce membre peut utiliser la console (heure de Dakar). En dehors, la console lui est fermée ; il la retrouve au début de son créneau suivant.
        </p>
        <ShiftEditor value={ranges} onChange={setRanges} />
        <ModalFooter error={error} pending={pending} onClose={onClose} submitLabel="Enregistrer" />
      </form>
    </AdminModal>
  );
}

function CreateMemberModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (payload: unknown) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [title, setTitle] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [ranges, setRanges] = useState<FormShift[]>([]);
  const { error, setError, pending, run } = useSubmit(onSubmit);

  return (
    <AdminModal title="Nouveau membre" onClose={onClose} width="max-w-2xl">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const bad = badRangeMessage(ranges);
          if (bad) {
            setError(bad);
            return;
          }
          const shifts = toShiftPayload(ranges);
          void run(
            {
              email: email.trim(),
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              ...(password ? { password } : {}),
              ...(title.trim() ? { title: title.trim() } : {}),
              permissions,
              ...(shifts.length > 0 ? { shifts } : {}),
            },
            managerCreateSchema,
          );
        }}
        className="space-y-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <Label>E-mail</Label>
            <span className="mb-2 block text-[11.5px] leading-relaxed text-stone-500">
              Déjà inscrit comme client ? Saisissez son e-mail : son compte rejoint l’équipe et il garde son mot de passe.
              Retiré de l’équipe, il redevient client.
            </span>
            <TextInput type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="prenom.nom@misterdou.com" />
          </label>
          <label className="block">
            <Label>Prénom</Label>
            <TextInput required value={firstName} onChange={(event) => setFirstName(event.target.value)} />
          </label>
          <label className="block">
            <Label>Nom</Label>
            <TextInput required value={lastName} onChange={(event) => setLastName(event.target.value)} />
          </label>
          <label className="block">
            <Label>Mot de passe</Label>
            <TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8 caractères minimum" autoComplete="new-password" />
            <span className="mt-1.5 block text-[11px] text-stone-500">
              Obligatoire pour un nouveau compte. Compte client existant : laissez vide (sauf inscription Google sans mot de passe).
            </span>
          </label>
          <label className="block">
            <Label>Titre</Label>
            <TextInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Responsable opérations" />
          </label>
        </div>

        <div>
          <Label>Permissions</Label>
          <PermissionPicker value={permissions} onChange={setPermissions} />
        </div>

        <div>
          <Label>Créneaux de présence</Label>
          <ShiftEditor value={ranges} onChange={setRanges} />
        </div>

        <ModalFooter error={error} pending={pending} onClose={onClose} submitLabel="Créer le membre" />
      </form>
    </AdminModal>
  );
}
