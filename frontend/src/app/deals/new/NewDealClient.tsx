"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { NetworkBanner } from "@/components/NetworkBanner";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { PreparedDealImport } from "@/components/PreparedDealImport";
import {
  createDeal,
  getApprovedMediators,
  generateRegtestAddress,
} from "@/lib/api";
import {
  loadContacts,
  removeContact,
  saveContact,
  validatedContact,
} from "@/lib/contacts";
import { normPubkey } from "@/lib/crypto";
import { getMeta } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { validateBitcoinAddressForNetwork } from "@/lib/bitcoin-address";
import { loadSession, useSession } from "@/lib/session";
import {
  buildCreateDealInput,
  formValuesFromPreparedDeal,
  type ImportedConstraints,
  type PreparedDeal,
} from "@/lib/prepared-deal";

export function NewDealClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const contactsQuery = useQuery({
    queryKey: ["public-contacts"],
    queryFn: async () => loadContacts(),
  });
  const mediatorsQuery = useQuery({
    queryKey: ["approved-mediators"],
    queryFn: getApprovedMediators,
  });
  const [manualKeys, setManualKeys] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactKey, setContactKey] = useState("");
  const [walletConfirmed, setWalletConfirmed] = useState(false);

  const searchParams = useSearchParams();
  const metaQuery = useQuery({ queryKey: ["meta"], queryFn: getMeta });
  const [title, setTitle] = useState<string>(
    () => searchParams.get("title") || "Used laptop"
  );
  const [amountSats, setAmountSats] = useState<string>(
    () => searchParams.get("amount_sats") || "50000"
  );
  const [buyerPubkey, setBuyerPubkey] = useState("");
  const [mediatorPubkey, setMediatorPubkey] = useState("");
  const [sellerPayoutAddress, setSellerPayoutAddress] = useState<string>("");
  const [buyerRefundAddress, setBuyerRefundAddress] = useState<string>("");
  const [description, setDescription] = useState("");
  // null keeps the manual default: three days from submission.
  const [deliveryDeadline, setDeliveryDeadline] = useState<string | null>(null);
  const [acceptanceWindowHours, setAcceptanceWindowHours] = useState(48);
  const [imported, setImported] = useState<ImportedConstraints | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  function applyPreparedDeal(prepared: PreparedDeal) {
    const { values, constraints } = formValuesFromPreparedDeal(prepared);
    // The buyer is stored as a public contact so the normal contact selector can use it.
    const contacts = saveContact({
      name: "Imported buyer",
      pubkey: values.buyerPubkey,
    });
    queryClient.setQueryData(["public-contacts"], contacts);
    setManualKeys(false);
    setTitle(values.title);
    setDescription(values.description);
    setAmountSats(values.amountSats);
    setBuyerPubkey(values.buyerPubkey);
    setMediatorPubkey(values.mediatorPubkey);
    setSellerPayoutAddress(values.sellerPayoutAddress);
    setBuyerRefundAddress(values.buyerRefundAddress);
    setDeliveryDeadline(values.deliveryDeadline);
    setAcceptanceWindowHours(values.acceptanceWindowHours);
    setImported(constraints);
    setError(null);
    setImportNotice(
      `Imported prepared terms for seller ${constraints.seller_pubkey.slice(0, 12)}… on ${constraints.network}.`
    );
  }

  function clearImport() {
    setImported(null);
    setDeliveryDeadline(null);
    setAcceptanceWindowHours(48);
    setImportNotice(null);
  }
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Sign in first: create or restore your identity on the Sign in page.");
      return;
    }
    if (!metaQuery.data) {
      setError(
        "Waiting for the configured Bitcoin network. Try again when API status is online."
      );
      return;
    }
    try {
      if (
        !manualKeys &&
        !contactsQuery.data?.some((contact) => contact.pubkey === buyerPubkey)
      ) {
        throw new Error(
          "Select an available buyer contact; no identity will be substituted."
        );
      }
      if (
        !manualKeys &&
        !mediatorsQuery.data?.some(
          (mediator) => mediator.pubkey === normPubkey(mediatorPubkey)
        )
      ) {
        throw new Error(
          "Select a currently approved mediator. Refresh the directory if approval changed."
        );
      }
      if (
        new Set([
          normPubkey(session.pubkey),
          normPubkey(buyerPubkey),
          normPubkey(mediatorPubkey),
        ]).size !== 3
      ) {
        throw new Error(
          "Seller, buyer and mediator must be three distinct identities."
        );
      }
      validateBitcoinAddressForNetwork(
        sellerPayoutAddress,
        metaQuery.data.network
      );
      validateBitcoinAddressForNetwork(
        buyerRefundAddress,
        metaQuery.data.network
      );
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Invalid settlement address."
      );
      return;
    }
    setBusy(true);
    try {
      const deal = await createDeal(
        session.token,
        buildCreateDealInput(
          {
            title,
            description,
            amountSats,
            buyerPubkey,
            mediatorPubkey,
            sellerPayoutAddress,
            buyerRefundAddress,
            deliveryDeadline,
            acceptanceWindowHours,
          },
          imported
        )
      );
      router.push(`/deals/${deal.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create deal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-8 animate-rise">
        <NetworkBanner />
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">
            Create
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
            New deal
          </h1>
          <p className="text-[var(--ink-muted)]">
            Seller proposes terms. Buyer and seller both sign the same canonical
            agreement.
          </p>
        </div>

        {!session?.token ? (
          <div
            role="note"
            className="flex flex-col gap-2 rounded border border-[var(--warn)] p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <span>You need to be signed in as the seller to create a deal.</span>
            <Link
              href="/onboarding?next=/deals/new"
              className="w-full rounded bg-[var(--accent)] px-4 py-2 text-center font-semibold text-[var(--bg-deep)] sm:w-fit"
            >
              Sign in or create identity
            </Link>
          </div>
        ) : null}
        <PreparedDealImport
          network={metaQuery.data?.network}
          pilotMaxAmountSats={metaQuery.data?.pilot_max_amount_sats ?? null}
          sessionPubkey={session?.pubkey}
          approvedMediators={mediatorsQuery.data}
          disabled={busy}
          onApply={applyPreparedDeal}
        />
        {importNotice ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 text-sm text-[var(--ok)]"
          >
            <span>{importNotice}</span>
            <button type="button" className="underline" onClick={clearImport}>
              Clear imported constraints
            </button>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <Input
            label="Amount (sats)"
            type="number"
            min={1}
            value={amountSats}
            onChange={(e) => setAmountSats(e.target.value)}
            required
          />
          <Textarea
            label="Description (optional)"
            value={description}
            maxLength={10000}
            onChange={(e) => setDescription(e.target.value)}
          />
          <label className="flex flex-col gap-1 text-sm">
            Buyer contact
            <select
              className="rounded border border-[var(--line)] bg-[var(--bg-deep)] p-2"
              value={buyerPubkey}
              disabled={busy || manualKeys}
              onChange={(e) => setBuyerPubkey(e.target.value)}
            >
              <option value="">Choose a saved buyer identity</option>
              {(contactsQuery.data ?? [])
                .filter(
                  (contact) =>
                    contact.pubkey !== normPubkey(session?.pubkey ?? "")
                )
                .map((contact) => (
                  <option key={contact.pubkey} value={contact.pubkey}>
                    {contact.name} · {contact.pubkey.slice(0, 12)}…
                  </option>
                ))}
            </select>
          </label>
          {buyerPubkey &&
          !manualKeys &&
          contactsQuery.data?.some((c) => c.pubkey === buyerPubkey) ? (
            <button
              type="button"
              disabled={busy}
              className="w-fit text-xs underline decoration-[var(--line)] underline-offset-4"
              onClick={() => {
                queryClient.setQueryData(["public-contacts"], removeContact(buyerPubkey));
                setBuyerPubkey("");
              }}
            >
              Remove this saved contact
            </button>
          ) : null}
          {!contactsQuery.data?.length ? (
            <p className="text-xs text-[var(--ink-muted)]">
              No contacts yet. Ask the buyer for their public identity
              (shown after they sign in) and add it below, or import a
              prepared configuration. Only public contact details are stored.
            </p>
          ) : null}
          <details className="text-sm">
            <summary className="cursor-pointer">Add a buyer contact</summary>
            <div className="mt-2 flex flex-col gap-2">
              <Input
                label="Contact display name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />
              <Input
                label="Contact public identity"
                value={contactKey}
                onChange={(e) => setContactKey(e.target.value)}
              />
              <button
                type="button"
                disabled={busy || !contactName.trim() || !contactKey.trim()}
                onClick={() => {
                  try {
                    const contact = validatedContact(contactName, contactKey);
                    const contacts = saveContact(contact);
                    queryClient.setQueryData(["public-contacts"], contacts);
                    setBuyerPubkey(contact.pubkey);
                    setContactName("");
                    setContactKey("");
                    setError(null);
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Contact could not be saved"
                    );
                  }
                }}
              >
                Save public contact
              </button>
            </div>
          </details>
          <label className="flex flex-col gap-1 text-sm">
            Approved mediator
            <select
              className="rounded border border-[var(--line)] bg-[var(--bg-deep)] p-2"
              value={mediatorPubkey}
              disabled={busy || manualKeys}
              onChange={(e) => setMediatorPubkey(e.target.value)}
            >
              <option value="">Choose an approved mediator</option>
              {(mediatorsQuery.data ?? []).map((mediator) => (
                <option key={mediator.pubkey} value={mediator.pubkey}>
                  {mediator.display_name} · {mediator.pubkey.slice(0, 12)}…
                </option>
              ))}
            </select>
          </label>
          {mediatorsQuery.isLoading ? (
            <p>Loading approved mediators…</p>
          ) : mediatorsQuery.isError ? (
            <p role="alert">
              Mediator directory unavailable. Check API availability and
              registry migration, or use advanced manual entry for an identity
              your API already trusts. The server still checks approval.
            </p>
          ) : !mediatorsQuery.data?.length ? (
            <p>
              No approved mediators. Apply at{" "}
              <a href="/mediator" className="underline">
                the mediator desk
              </a>{" "}
              or use the gated local demo registration.
            </p>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={manualKeys}
              onChange={(e) => setManualKeys(e.target.checked)}
            />
            Advanced manual public-key entry
          </label>
          {manualKeys ? (
            <>
              <Input
                label="Buyer pubkey"
                mono
                value={buyerPubkey}
                onChange={(e) => setBuyerPubkey(e.target.value)}
                required
              />
              <Input
                label="Mediator pubkey"
                mono
                value={mediatorPubkey}
                onChange={(e) => setMediatorPubkey(e.target.value)}
                required
              />
              <p className="text-xs">
                The mediator must still be approved by the API.
              </p>
            </>
          ) : null}
          <Input
            label="Seller payout address"
            mono
            value={sellerPayoutAddress}
            onChange={(e) => setSellerPayoutAddress(e.target.value)}
            required
          />
          <Input
            label="Buyer refund address"
            mono
            value={buyerRefundAddress}
            onChange={(e) => setBuyerRefundAddress(e.target.value)}
            required
          />
          {metaQuery.data?.demo_enabled &&
          metaQuery.data.network === "regtest" ? (
            <div className="flex flex-col gap-2 text-sm">
              <label>
                <input
                  type="checkbox"
                  checked={walletConfirmed}
                  onChange={(e) => setWalletConfirmed(e.target.checked)}
                />{" "}
                Developer helper (local regtest API only): generate two
                addresses in the node&apos;s wallet. Real users paste addresses
                from their own wallets.
              </label>
              <button
                type="button"
                disabled={busy || !walletConfirmed || !session?.token}
                onClick={async () => {
                  if (!session?.token || busy) return;
                  setBusy(true);
                  try {
                    const payout = await generateRegtestAddress(session.token);
                    const refund = await generateRegtestAddress(session.token);
                    validateBitcoinAddressForNetwork(payout, "regtest");
                    validateBitcoinAddressForNetwork(refund, "regtest");
                    setSellerPayoutAddress(payout);
                    setBuyerRefundAddress(refund);
                    setError(null);
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Wallet address generation failed"
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Developer: generate regtest addresses
              </button>
            </div>
          ) : (
            <p className="text-xs text-[var(--ink-muted)]">
              Use destinations from the seller and buyer wallets. Production
              wallet-assisted address generation requires a compatible wallet
              integration; no server wallet custody is implied.
            </p>
          )}
          <p className="text-sm">
            Review: {title} · {amountSats} sats · buyer{" "}
            {buyerPubkey
              ? `${normPubkey(buyerPubkey).slice(0, 12)}…`
              : "not selected"}{" "}
            · mediator{" "}
            {mediatorPubkey
              ? `${normPubkey(mediatorPubkey).slice(0, 12)}…`
              : "not selected"}
            .{" "}
            {deliveryDeadline
              ? `Delivery deadline is ${deliveryDeadline}`
              : "Delivery deadline is three days from creation"}
            ; acceptance window is {acceptanceWindowHours} hours. Both exact
            addresses above become signed agreement terms.
          </p>
          {error ? (
            <p className="text-sm text-[var(--danger)]">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={
              busy ||
              !buyerPubkey ||
              !mediatorPubkey ||
              (!manualKeys && mediatorsQuery.isError)
            }
            className="w-full rounded bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-50 sm:w-fit"
          >
            {busy ? "Creating…" : "Create deal"}
          </button>
        </form>
      </div>
    </AppShell>
  );
}
