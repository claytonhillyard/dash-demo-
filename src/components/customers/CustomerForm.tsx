"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import type { CustomerView, CustomerAddress } from "@/db/customers";
import type { ActionResult } from "@/lib/customers/actions";

/**
 * Action prop polymorphism:
 *   - create mode: `createCustomer(raw)` resolves to `{ok:true, id}` so we
 *     can route to /customers/<id>/edit on success.
 *   - edit mode: `updateCustomer(raw)` resolves to a plain `ActionResult`.
 *
 * The form normalizes both to "did it succeed?" + an optional new id.
 */
export type CreateAction = (
  raw: unknown,
) => Promise<{ ok: true; id: number } | { ok: false; error: string }>;
export type UpdateAction = (raw: unknown) => Promise<ActionResult>;
export type DeleteAction = (raw: unknown) => Promise<ActionResult>;

type CustomerFormProps =
  | {
      mode: "create";
      action: CreateAction;
      initial?: undefined;
      deleteAction?: undefined;
    }
  | {
      mode: "edit";
      action: UpdateAction;
      initial: CustomerView;
      /** Optional — edit mode shows a Delete button when this is wired. */
      deleteAction?: DeleteAction;
    };

/** Common country codes for the form's dropdown — order roughly by jewelry-
 *  trade relevance, not alphabetical, so the most-likely picks surface first. */
const ISO2_COUNTRIES: ReadonlyArray<[code: string, label: string]> = [
  ["US", "United States"],
  ["IN", "India"],
  ["FR", "France"],
  ["GB", "United Kingdom"],
  ["JP", "Japan"],
  ["AE", "United Arab Emirates"],
  ["SG", "Singapore"],
  ["HK", "Hong Kong"],
  ["IT", "Italy"],
  ["DE", "Germany"],
  ["CH", "Switzerland"],
  ["BR", "Brazil"],
  ["MX", "Mexico"],
  ["CA", "Canada"],
  ["AU", "Australia"],
  ["TR", "Türkiye"],
  ["TH", "Thailand"],
  ["ZA", "South Africa"],
  ["ES", "Spain"],
  ["NL", "Netherlands"],
];

function emptyToUndef(s: string): string | undefined {
  const t = s.trim();
  return t === "" ? undefined : t;
}

export function CustomerForm(props: CustomerFormProps) {
  const router = useRouter();
  const initial = props.mode === "edit" ? props.initial : undefined;
  const initialAddress: CustomerAddress = initial?.address ?? {};

  const [name, setName] = useState(initial?.name ?? "");
  const [businessName, setBusinessName] = useState(initial?.businessName ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [externalRef, setExternalRef] = useState(initial?.externalRef ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [street1, setStreet1] = useState(initialAddress.street1 ?? "");
  const [street2, setStreet2] = useState(initialAddress.street2 ?? "");
  const [city, setCity] = useState(initialAddress.city ?? "");
  const [state, setState] = useState(initialAddress.state ?? "");
  const [zip, setZip] = useState(initialAddress.zip ?? "");
  const [country, setCountry] = useState(initialAddress.country ?? "");

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);

    const payload: Record<string, unknown> = {
      name: name.trim(),
      businessName: emptyToUndef(businessName),
      email: emptyToUndef(email),
      phone: emptyToUndef(phone),
      address: {
        street1: emptyToUndef(street1),
        street2: emptyToUndef(street2),
        city: emptyToUndef(city),
        state: emptyToUndef(state),
        zip: emptyToUndef(zip),
        country: emptyToUndef(country),
      },
      notes: emptyToUndef(notes),
      externalRef: emptyToUndef(externalRef),
    };
    if (props.mode === "edit") {
      payload.id = props.initial.id;
    }

    startTransition(async () => {
      if (props.mode === "create") {
        const res = await props.action(payload);
        if (res.ok) {
          setOk(true);
          router.push(`/customers/${res.id}/edit`);
          router.refresh();
        } else {
          setError(res.error);
        }
      } else {
        const res = await props.action(payload);
        if (res.ok) {
          setOk(true);
          router.refresh();
        } else {
          setError(res.error);
        }
      }
    });
  }

  async function handleDelete() {
    if (props.mode !== "edit" || !props.deleteAction) return;
    if (!window.confirm("Delete this customer? This cannot be undone.")) return;
    setError(null);
    setOk(false);
    startTransition(async () => {
      // safe because mode==="edit" implies deleteAction may be defined and
      // initial is required
      const res = await props.deleteAction!({ id: props.initial.id });
      if (res.ok) {
        router.push("/customers");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      aria-label="customer form"
      className="surface-card flex flex-col gap-3 rounded-xl p-4 text-sm"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          Name *
          <input
            aria-label="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          Business name
          <input
            aria-label="business name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            maxLength={200}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          Email
          <input
            aria-label="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          Phone
          <input
            aria-label="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={50}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
      </div>

      <fieldset className="grid grid-cols-1 gap-3 rounded border border-border p-3 md:grid-cols-2">
        <legend className="px-2 text-[10px] uppercase tracking-widest text-text/40">
          Address
        </legend>
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60 md:col-span-2">
          Street 1
          <input
            aria-label="street1"
            value={street1}
            onChange={(e) => setStreet1(e.target.value)}
            maxLength={200}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60 md:col-span-2">
          Street 2
          <input
            aria-label="street2"
            value={street2}
            onChange={(e) => setStreet2(e.target.value)}
            maxLength={200}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          City
          <input
            aria-label="city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            maxLength={100}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          State / Region
          <input
            aria-label="state"
            value={state}
            onChange={(e) => setState(e.target.value)}
            maxLength={100}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          ZIP / Postcode
          <input
            aria-label="zip"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            maxLength={20}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          Country
          <select
            aria-label="country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          >
            <option value="">(none)</option>
            {ISO2_COUNTRIES.map(([code, label]) => (
              <option key={code} value={code}>
                {label} ({code})
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
        Notes
        <textarea
          aria-label="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={4}
          className="mt-1 bg-bg p-2 font-mono text-sm text-text normal-case tracking-normal"
        />
      </label>

      <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
        External ref
        <input
          aria-label="external ref"
          value={externalRef}
          onChange={(e) => setExternalRef(e.target.value)}
          maxLength={100}
          placeholder="e.g. WJ-10421 (legacy system id)"
          className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
        />
      </label>

      <FormStatus error={error} ok={ok} />

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending || name.trim() === ""}
            className="rounded bg-gold px-3 py-2 text-sm text-black disabled:opacity-50"
          >
            {pending
              ? "Saving…"
              : props.mode === "edit"
                ? "Save changes"
                : "Create customer"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/customers")}
            className="rounded border border-border px-3 py-2 text-sm text-text/70 hover:text-text"
          >
            Cancel
          </button>
        </div>
        {props.mode === "edit" && props.deleteAction ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            aria-label="delete customer"
            className="text-[11px] uppercase tracking-wider text-bad hover:underline disabled:opacity-50"
          >
            Delete customer
          </button>
        ) : null}
      </div>
    </form>
  );
}
