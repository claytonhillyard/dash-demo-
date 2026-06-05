import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getWebsiteSnapshots } from "@/db/website";
import { WebsiteAdmin } from "@/components/website/WebsiteAdmin";
import {
  createWebsiteSnapshot,
  updateWebsiteSnapshot,
  deleteWebsiteSnapshot,
} from "@/lib/website/actions";

export const dynamic = "force-dynamic";

export default async function WebsitePage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const rows = await getWebsiteSnapshots(db, orgId);
  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Website</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>
      <WebsiteAdmin
        rows={rows}
        createAction={createWebsiteSnapshot}
        updateAction={updateWebsiteSnapshot}
        deleteAction={deleteWebsiteSnapshot}
      />
    </main>
  );
}
