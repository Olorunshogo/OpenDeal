"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Wand2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { NetworkBanner } from "@/components/NetworkBanner";
import { PreparedDealImport } from "@/components/PreparedDealImport";
import {
  AddressInput,
  Alert,
  Amount,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Checkbox,
  DataList,
  Input,
  PubkeyInput,
  SatsInput,
  Select,
  Switch,
  Textarea,
  type SelectOption,
} from "@/components/ui";
import { createDeal, generateRegtestAddress, getApprovedMediators, getMeta } from "@/lib/api";
import { validateBitcoinAddressForNetwork } from "@/lib/bitcoin-address";
import { loadContacts, removeContact, saveContact, validatedContact } from "@/lib/contacts";
import { normPubkey } from "@/lib/crypto";
import {
  buildCreateDealInput,
  formValuesFromPreparedDeal,
  type ImportedConstraints,
  type PreparedDeal,
} from "@/lib/prepared-deal";
import { errorMessage } from "@/lib/server-errors";
import { loadSession, useSession, type Session } from "@/lib/session";
import { createNewDealSchema, type NewDealSchemaOptions, type NewDealValues } from "@/schemas/deal";

export function NewDealClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session: Session | null = useSession();
  const searchParams = useSearchParams();
  const contactsQuery = useQuery({ queryKey: ["public-contacts"], queryFn: async () => loadContacts() });
  const mediatorsQuery = useQuery({ queryKey: ["approved-mediators"], queryFn: getApprovedMediators });
  const metaQuery = useQuery({ queryKey: ["meta"], queryFn: getMeta });

  const [contactName, setContactName] = useState<string>("");
  const [contactKey, setContactKey] = useState<string>("");
  const [walletConfirmed, setWalletConfirmed] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  // null keeps the manual default: three days from submission.
  const [deliveryDeadline, setDeliveryDeadline] = useState<string | null>(null);
  const [acceptanceWindowHours, setAcceptanceWindowHours] = useState<number>(48);
  const [imported, setImported] = useState<ImportedConstraints | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const network: string = metaQuery.data?.network ?? "";
  const pilotMaxAmountSats: number | null = metaQuery.data?.pilot_max_amount_sats ?? null;
  const schemaOptions = useRef<NewDealSchemaOptions>({ network: "", pilotMaxAmountSats: null });
  useLayoutEffect(() => {
    schemaOptions.current = { network, pilotMaxAmountSats };
  }, [network, pilotMaxAmountSats]);

  const resolver: Resolver<NewDealValues> = (values, context, options) =>
    zodResolver(createNewDealSchema(schemaOptions.current))(values, context, options);

  const form = useForm<NewDealValues>({
    resolver,
    defaultValues: {
      title: searchParams.get("title") || "Used laptop",
      description: "",
      amountSats: searchParams.get("amount_sats") || "50000",
      manualKeys: false,
      buyerPubkey: "",
      mediatorPubkey: "",
      sellerPayoutAddress: "",
      buyerRefundAddress: "",
    },
  });
  const { control, register, handleSubmit, setValue, formState } = form;
  const [title, amountSats, buyerPubkey, mediatorPubkey, manualKeys] = useWatch({
    control,
    name: ["title", "amountSats", "buyerPubkey", "mediatorPubkey", "manualKeys"],
  });
  const busy: boolean = formState.isSubmitting || generating;

  const sellerKey: string = normPubkey(session?.pubkey ?? "");
  const contactOptions: SelectOption[] = (contactsQuery.data ?? [])
    .filter((contact) => contact.pubkey !== sellerKey)
    .map((contact) => ({ value: contact.pubkey, label: contact.name, description: `${contact.pubkey.slice(0, 12)}…` }));
  const mediatorOptions: SelectOption[] = (mediatorsQuery.data ?? []).map((mediator) => ({
    value: mediator.pubkey,
    label: mediator.display_name,
    description: `${mediator.pubkey.slice(0, 12)}…`,
  }));
  const buyerIsSavedContact: boolean = Boolean(
    buyerPubkey && contactsQuery.data?.some((contact) => contact.pubkey === buyerPubkey),
  );

  function applyPreparedDeal(prepared: PreparedDeal) {
    const { values, constraints } = formValuesFromPreparedDeal(prepared);
    // The buyer is stored as a public contact so the normal contact selector can use it.
    const contacts = saveContact({ name: "Imported buyer", pubkey: values.buyerPubkey });
    queryClient.setQueryData(["public-contacts"], contacts);
    form.reset({
      title: values.title,
      description: values.description,
      amountSats: values.amountSats,
      manualKeys: false,
      buyerPubkey: values.buyerPubkey,
      mediatorPubkey: values.mediatorPubkey,
      sellerPayoutAddress: values.sellerPayoutAddress,
      buyerRefundAddress: values.buyerRefundAddress,
    });
    setDeliveryDeadline(values.deliveryDeadline);
    setAcceptanceWindowHours(values.acceptanceWindowHours);
    setImported(constraints);
    setError(null);
    setImportNotice(`Imported prepared terms for seller ${constraints.seller_pubkey.slice(0, 12)}… on ${constraints.network}.`);
  }

  function clearImport() {
    setImported(null);
    setDeliveryDeadline(null);
    setAcceptanceWindowHours(48);
    setImportNotice(null);
  }

  function onSaveContact() {
    try {
      const contact = validatedContact(contactName, contactKey);
      const contacts = saveContact(contact);
      queryClient.setQueryData(["public-contacts"], contacts);
      setValue("buyerPubkey", contact.pubkey, { shouldValidate: true });
      setContactName("");
      setContactKey("");
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Contact could not be saved"));
    }
  }

  async function onGenerateAddresses() {
    if (!session?.token || busy) return;
    setGenerating(true);
    try {
      const payout = await generateRegtestAddress(session.token);
      const refund = await generateRegtestAddress(session.token);
      validateBitcoinAddressForNetwork(payout, "regtest");
      validateBitcoinAddressForNetwork(refund, "regtest");
      setValue("sellerPayoutAddress", payout, { shouldValidate: true });
      setValue("buyerRefundAddress", refund, { shouldValidate: true });
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Wallet address generation failed"));
    } finally {
      setGenerating(false);
    }
  }

  const onSubmit = handleSubmit(async (values: NewDealValues) => {
    setError(null);
    const current = loadSession();
    if (!current?.token) {
      setError("Sign in first: create or restore your identity on the Sign in page.");
      return;
    }
    if (!metaQuery.data) {
      setError("Waiting for the configured Bitcoin network. Try again when API status is online.");
      return;
    }
    if (!values.manualKeys && !contactsQuery.data?.some((contact) => contact.pubkey === values.buyerPubkey)) {
      form.setError("buyerPubkey", { message: "Select an available buyer contact; no identity will be substituted." });
      return;
    }
    if (
      !values.manualKeys &&
      !mediatorsQuery.data?.some((mediator) => mediator.pubkey === normPubkey(values.mediatorPubkey))
    ) {
      form.setError("mediatorPubkey", {
        message: "Select a currently approved mediator. Refresh the directory if approval changed.",
      });
      return;
    }
    if (
      new Set([normPubkey(current.pubkey), normPubkey(values.buyerPubkey), normPubkey(values.mediatorPubkey)]).size !== 3
    ) {
      setError("Seller, buyer and mediator must be three distinct identities.");
      return;
    }
    try {
      const deal = await createDeal(
        current.token,
        buildCreateDealInput(
          {
            title: values.title,
            description: values.description,
            amountSats: values.amountSats,
            buyerPubkey: values.buyerPubkey,
            mediatorPubkey: values.mediatorPubkey,
            sellerPayoutAddress: values.sellerPayoutAddress,
            buyerRefundAddress: values.buyerRefundAddress,
            deliveryDeadline,
            acceptanceWindowHours,
          },
          imported,
        ),
      );
      router.push(`/deals/${deal.id}`);
    } catch (err) {
      setError(errorMessage(err, "failed to create deal"));
    }
  });

  const amountNumber: number = Number(amountSats);

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 animate-rise">
        <NetworkBanner />
        <PageHeader
          eyebrow="Create"
          title="New deal"
          description="Seller proposes terms. Buyer and seller both sign the same canonical agreement."
        />

        {!session?.token ? (
          <Alert
            tone="warn"
            title="Sign in as the seller to create a deal"
            action={
              <ButtonLink href="/onboarding?next=/deals/new" size="sm">
                Sign in or create identity
              </ButtonLink>
            }
          />
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
          <Alert
            tone="ok"
            title={importNotice}
            action={
              <Button variant="link" size="sm" onClick={clearImport}>
                Clear imported constraints
              </Button>
            }
          />
        ) : null}

        <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
          <Card>
            <CardHeader title="Terms" description="What is being sold and for how much." />
            <Input label="Title" required error={formState.errors.title?.message} {...register("title")} />
            <Controller
              control={control}
              name="amountSats"
              render={({ field, fieldState }) => (
                <SatsInput
                  label="Amount"
                  required
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  hint={
                    metaQuery.data?.pilot_max_amount_sats
                      ? `Pilot cap: ${metaQuery.data.pilot_max_amount_sats.toLocaleString()} sats`
                      : undefined
                  }
                />
              )}
            />
            <Textarea
              label="Description (optional)"
              error={formState.errors.description?.message}
              {...register("description")}
            />
          </Card>

          <Card>
            <CardHeader title="Parties" description="The buyer and an approved mediator. You sign as the seller." />
            <Controller
              control={control}
              name="manualKeys"
              render={({ field }) => (
                <Switch
                  label="Advanced manual public-key entry"
                  description="The mediator must still be approved by the API."
                  checked={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            {manualKeys ? (
              <div className="grid gap-4">
                <Controller
                  control={control}
                  name="buyerPubkey"
                  render={({ field, fieldState }) => (
                    <PubkeyInput
                      label="Buyer pubkey"
                      required
                      value={field.value}
                      onValueChange={field.onChange}
                      error={fieldState.error?.message}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="mediatorPubkey"
                  render={({ field, fieldState }) => (
                    <PubkeyInput
                      label="Mediator pubkey"
                      required
                      value={field.value}
                      onValueChange={field.onChange}
                      error={fieldState.error?.message}
                    />
                  )}
                />
              </div>
            ) : (
              <div className="grid gap-4">
                <Controller
                  control={control}
                  name="buyerPubkey"
                  render={({ field, fieldState }) => (
                    <Select
                      label="Buyer contact"
                      required
                      placeholder="Choose a saved buyer identity"
                      options={contactOptions}
                      value={field.value || null}
                      onChange={field.onChange}
                      disabled={busy}
                      error={fieldState.error?.message}
                      hint={
                        contactOptions.length
                          ? undefined
                          : "No contacts yet. Ask the buyer for their public identity (shown after they sign in) and add it below, or import a prepared configuration. Only public contact details are stored."
                      }
                    />
                  )}
                />
                {buyerIsSavedContact ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="w-fit text-xs"
                    disabled={busy}
                    onClick={() => {
                      queryClient.setQueryData(["public-contacts"], removeContact(buyerPubkey));
                      setValue("buyerPubkey", "");
                    }}
                  >
                    Remove this saved contact
                  </Button>
                ) : null}
                <details className="rounded-2xl border border-line">
                  <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm text-ink-muted hover:text-ink">
                    <UserPlus aria-hidden="true" className="size-4 text-violet-soft" />
                    Add a buyer contact
                  </summary>
                  <div className="flex flex-col gap-3 border-t border-line p-4">
                    <Input
                      label="Contact display name"
                      value={contactName}
                      onChange={(event) => setContactName(event.target.value)}
                    />
                    <PubkeyInput label="Contact public identity" value={contactKey} onValueChange={setContactKey} />
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-fit"
                      disabled={busy || !contactName.trim() || !contactKey.trim()}
                      onClick={onSaveContact}
                    >
                      Save public contact
                    </Button>
                  </div>
                </details>
                <Controller
                  control={control}
                  name="mediatorPubkey"
                  render={({ field, fieldState }) => (
                    <Select
                      label="Approved mediator"
                      required
                      placeholder={mediatorsQuery.isLoading ? "Loading approved mediators…" : "Choose an approved mediator"}
                      options={mediatorOptions}
                      value={field.value || null}
                      onChange={field.onChange}
                      disabled={busy || mediatorsQuery.isLoading}
                      error={fieldState.error?.message}
                    />
                  )}
                />
                {mediatorsQuery.isError ? (
                  <Alert tone="warn" title="Mediator directory unavailable">
                    Check API availability and registry migration, or use advanced manual entry for an identity your
                    API already trusts. The server still checks approval.
                  </Alert>
                ) : mediatorsQuery.isSuccess && !mediatorsQuery.data.length ? (
                  <Alert
                    tone="info"
                    title="No approved mediators"
                    action={
                      <ButtonLink href="/mediator" size="sm" variant="secondary">
                        Mediator desk
                      </ButtonLink>
                    }
                  >
                    Apply at the mediator desk or use the gated local demo registration.
                  </Alert>
                ) : null}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Settlement destinations"
              description="Both exact addresses become signed agreement terms. Funds can only ever settle to one of them."
            />
            <Controller
              control={control}
              name="sellerPayoutAddress"
              render={({ field, fieldState }) => (
                <AddressInput
                  label="Seller payout address"
                  required
                  network={network}
                  value={field.value}
                  onValueChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="buyerRefundAddress"
              render={({ field, fieldState }) => (
                <AddressInput
                  label="Buyer refund address"
                  required
                  network={network}
                  value={field.value}
                  onValueChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
            {metaQuery.data?.demo_enabled && metaQuery.data.network === "regtest" ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-violet/40 p-4">
                <Checkbox
                  label="Developer helper (local regtest API only)"
                  description="Generate two addresses in the node's wallet. Real users paste addresses from their own wallets."
                  checked={walletConfirmed}
                  onChange={setWalletConfirmed}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-fit"
                  leading={<Wand2 className="size-4" />}
                  loading={generating}
                  disabled={busy || !walletConfirmed || !session?.token}
                  onClick={() => void onGenerateAddresses()}
                >
                  Developer: generate regtest addresses
                </Button>
              </div>
            ) : (
              <p className="text-xs text-ink-subtle">
                Use destinations from the seller and buyer wallets. Production wallet-assisted address generation
                requires a compatible wallet integration; no server wallet custody is implied.
              </p>
            )}
          </Card>

          <Card tone="violet">
            <CardHeader title="Review" description="This is what both parties will sign." />
            <DataList
              items={[
                { label: "Title", value: title || "Untitled" },
                {
                  label: "Amount",
                  value: Number.isFinite(amountNumber) && amountNumber > 0 ? <Amount sats={amountNumber} size="sm" /> : "Not set",
                },
                { label: "Buyer", value: buyerPubkey ? `${normPubkey(buyerPubkey).slice(0, 12)}…` : "Not selected" },
                {
                  label: "Mediator",
                  value: mediatorPubkey ? `${normPubkey(mediatorPubkey).slice(0, 12)}…` : "Not selected",
                },
                {
                  label: "Delivery deadline",
                  value: deliveryDeadline ?? "Three days from creation",
                },
                { label: "Acceptance window", value: `${acceptanceWindowHours} hours` },
              ]}
            />
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Button
              type="submit"
              size="lg"
              loading={formState.isSubmitting}
              loadingLabel="Creating…"
              disabled={busy || (!manualKeys && mediatorsQuery.isError)}
              className="w-full sm:w-fit"
            >
              Create deal
            </Button>
          </Card>
        </form>
      </div>
    </AppShell>
  );
}
