"use client";

import { ArrowRight, Inbox, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { RevealOnView } from "@/components/motion/RevealOnView";
import {
  AddressInput,
  Alert,
  Amount,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Checkbox,
  Combobox,
  CopyButton,
  DataList,
  Dialog,
  EmptyState,
  HashValue,
  Input,
  PasswordInput,
  PubkeyInput,
  SatsInput,
  SegmentedControl,
  Select,
  Skeleton,
  StatusBadge,
  Stepper,
  Switch,
  Tabs,
  Textarea,
  Timeline,
  Tooltip,
  UploadField,
} from "@/components/ui";
import {
  COLOR_GROUPS,
  CONTACT_OPTIONS,
  LIFECYCLE_STEPS,
  NETWORK_OPTIONS,
  PURPOSE_OPTIONS,
  SAMPLE_TXID,
  STATUS_SAMPLES,
  TIMELINE_SAMPLE,
  TYPE_SCALE,
  type SettlementPurposeOption,
} from "./content";

// === Layout helpers

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <RevealOnView className="flex flex-col gap-6 border-t border-line pt-10">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>
        <p className="text-sm text-ink-muted">{description}</p>
      </div>
      {children}
    </RevealOnView>
  );
}

// === Component

export function DesignSystemClient(): React.JSX.Element {
  const [title, setTitle] = useState<string>("Used laptop");
  const [passphrase, setPassphrase] = useState<string>("");
  const [sats, setSats] = useState<string>("50000");
  const [address, setAddress] = useState<string>("");
  const [pubkey, setPubkey] = useState<string>("");
  const [network, setNetwork] = useState<string | null>("regtest");
  const [buyer, setBuyer] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [reviewed, setReviewed] = useState<boolean>(false);
  const [keepOnDevice, setKeepOnDevice] = useState<boolean>(true);
  const [purpose, setPurpose] = useState<SettlementPurposeOption>("payout_seller");
  const [tab, setTab] = useState<string>("overview");
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  function simulateLoading(): void {
    setLoading(true);
    setTimeout(() => setLoading(false), 1500);
  }

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
        <div className="flex flex-col gap-3">
          <Badge tone="violet" dot>
            Internal reference
          </Badge>
          <h1 className="font-display text-4xl font-semibold text-ink sm:text-5xl">
            OpenDeal <span className="text-brand">design system</span>
          </h1>
          <p className="max-w-2xl text-ink-muted">
            Near-black base, violet atmosphere, Bitcoin orange for action. Every screen is built from the
            components on this page, so agree on them here first.
          </p>
        </div>

        <Section title="Colour" description="Named Tailwind tokens. Use these classes, never raw palette colours.">
          <div className="grid gap-8">
            {COLOR_GROUPS.map((group) => (
              <div key={group.title} className="flex flex-col gap-3">
                <h3 className="text-xs uppercase tracking-[0.14em] text-ink-subtle">{group.title}</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {group.tokens.map((token) => (
                    <div key={token.name} className="flex flex-col gap-2 rounded-2xl border border-line bg-glass p-3">
                      <span className={`h-14 rounded-xl border border-line ${token.className}`} />
                      <span className="flex flex-col gap-0.5">
                        <span className="font-mono text-xs text-ink">{token.name}</span>
                        <span className="font-mono text-[11px] text-ink-subtle">{token.value}</span>
                        <span className="text-xs text-ink-muted">{token.role}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="grid gap-3 sm:grid-cols-2">
              <Card tone="brand">
                <CardHeader title="Brand glow" description="Primary moments: the main call to action, a funded escrow." />
              </Card>
              <Card tone="violet">
                <CardHeader title="Violet glow" description="Atmosphere: focus, menus, informational emphasis." />
              </Card>
            </div>
          </div>
        </Section>

        <Section title="Type" description="Sora for display, Figtree for body, JetBrains Mono for keys, addresses and txids.">
          <div className="flex flex-col gap-5">
            {TYPE_SCALE.map((sample) => (
              <div key={sample.name} className="flex flex-col gap-1">
                <span className="text-xs text-ink-subtle">{sample.name}</span>
                <span className={`break-words text-ink ${sample.className}`}>{sample.sample}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons" description="Primary is orange and reserved for the one main action on a screen.">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button>Create deal</Button>
              <Button variant="secondary">Verify funding</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="danger">Open dispute</Button>
              <Button variant="link">View receipt</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg" trailing={<ArrowRight className="size-4" />}>
                Large with icon
              </Button>
              <Button loading={loading} loadingLabel="Signing…" onClick={simulateLoading}>
                Click to load
              </Button>
              <Button disabled>Disabled</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ButtonLink href="/deals/new" variant="secondary" leading={<ShieldCheck className="size-4" />}>
                Button as a link
              </ButtonLink>
              <CopyButton value={SAMPLE_TXID} label="Copy txid" />
              <CopyButton value={SAMPLE_TXID} iconOnly variant="ghost" label="Copy txid" />
            </div>
          </div>
        </Section>

        <Section title="Fields" description="Every input sits in the same shell. No bare inputs, selects or textareas.">
          <div className="grid gap-5 sm:grid-cols-2">
            <Input label="Title" required value={title} onChange={(event) => setTitle(event.target.value)} />
            <SatsInput label="Amount" required value={sats} onValueChange={setSats} />
            <PasswordInput
              label="Recovery passphrase"
              required
              showStrength
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              hint="At least 12 characters."
            />
            <Select label="Network" options={NETWORK_OPTIONS} value={network} onChange={setNetwork} />
            <Combobox
              label="Buyer"
              options={CONTACT_OPTIONS}
              value={buyer}
              onChange={setBuyer}
              allowCustomValue
              placeholder="Search contacts or paste a pubkey"
              hint="Pick a saved contact or paste a new key."
            />
            <PubkeyInput label="Mediator pubkey" value={pubkey} onValueChange={setPubkey} />
            <AddressInput
              label="Seller payout address"
              network="regtest"
              value={address}
              onValueChange={setAddress}
              fieldClassName="sm:col-span-2"
            />
            <Input label="With an error" value="not-a-number" readOnly error="Amount must be a whole number of sats." />
            <Input label="Disabled" value="Locked after signing" disabled />
            <Textarea label="Evidence" placeholder="Describe what happened…" fieldClassName="sm:col-span-2" />
            <UploadField
              label="Recovery file"
              accept=".json"
              file={file}
              onFileChange={setFile}
              hint="opendeal-identity-xxxxxxxx.json"
              className="sm:col-span-2"
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Checkbox
              label="I reviewed the purpose, destination, output amount and fee."
              description="Signing moves escrow with 2-of-3."
              checked={reviewed}
              onChange={setReviewed}
            />
            <Switch
              label="Keep the encrypted identity on this device"
              description="You still need the passphrase to unlock it."
              checked={keepOnDevice}
              onChange={setKeepOnDevice}
            />
            <SegmentedControl label="Purpose" options={PURPOSE_OPTIONS} value={purpose} onChange={setPurpose} />
          </div>
        </Section>

        <Section title="Status and feedback" description="Deal status has one colour everywhere it appears.">
          <div className="flex flex-wrap gap-2">
            {STATUS_SAMPLES.map((status) => (
              <StatusBadge key={status} status={status} />
            ))}
          </div>
          <div className="grid gap-3">
            <Alert tone="info" title="Regtest experimental">Test coins only. Nothing here moves real Bitcoin.</Alert>
            <Alert tone="ok" title="Receipt verified">Every event hash chains back to the signed agreement.</Alert>
            <Alert tone="warn" title="API degraded" action={<Button size="sm" variant="secondary">Retry</Button>}>
              The database is unavailable. Retrying every 10 seconds.
            </Alert>
            <Alert tone="danger" title="Destination contradicts signed agreement">
              Use the exact payout address from the agreement.
            </Alert>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <EmptyState
              icon={<Inbox className="size-5" />}
              title="No deals yet"
              description="Create a deal or ask the seller to add your public key."
              action={<ButtonLink href="/deals/new" size="sm">New deal</ButtonLink>}
            />
            <Card tone="solid">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-10 w-32 rounded-full" />
            </Card>
          </div>
        </Section>

        <Section title="Data" description="Amounts always show sats and BTC. Hashes are shortened with copy and a full tooltip.">
          <Card>
            <CardHeader
              title="Used laptop"
              description="Seller · Buyer · Mediator"
              action={<StatusBadge status="funded" />}
            />
            <DataList
              columns={3}
              items={[
                { label: "Amount", value: <Amount sats={50000} size="lg" /> },
                { label: "Confirmations", value: "1 of 1" },
                { label: "Network", value: <Badge tone="violet">regtest</Badge> },
                { label: "Funding txid", value: <HashValue value={SAMPLE_TXID} />, wide: true },
              ]}
            />
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
              <Tooltip content="Two of the three keys must sign to move funds.">
                <Badge tone="brand">2-of-3 escrow</Badge>
              </Tooltip>
              <span>Hover or focus the badge for a tooltip.</span>
            </div>
          </Card>
        </Section>

        <Section title="Navigation and progress" description="Tabs for sections of a page, Stepper for a flow, Timeline for history.">
          <Stepper steps={LIFECYCLE_STEPS} currentIndex={2} />
          <Tabs
            label="Deal sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "overview", label: "Overview", content: <Timeline entries={TIMELINE_SAMPLE} /> },
              {
                value: "evidence",
                label: "Evidence",
                content: <EmptyState title="No evidence submitted" description="Either party can add evidence." />,
              },
              { value: "receipt", label: "Receipt", content: <HashValue value={SAMPLE_TXID} full /> },
            ]}
          />
        </Section>

        <Section title="Overlays" description="Bottom sheet on phones, centred panel on desktop. Escape or the backdrop closes it.">
          <div>
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
              Open dialog
            </Button>
          </div>
          <Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            title="Finalize settlement?"
            description="This broadcasts the fully signed PSBT. It cannot be undone."
            footer={
              <>
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setDialogOpen(false)}>Finalize and broadcast</Button>
              </>
            }
          >
            <DataList
              columns={2}
              items={[
                { label: "Pays", value: <Amount sats={49500} /> },
                { label: "Fee", value: <Amount sats={500} showBtc={false} /> },
              ]}
            />
          </Dialog>
        </Section>
      </div>
    </AppShell>
  );
}
