import { getDb } from "@/db/client";
import { clients } from "@/db/schema";
import { desc } from "drizzle-orm";
import { ClientsAdmin, type ClientRow } from "@/components/company/ClientsAdmin";
import { createClient, deleteClient } from "@/lib/company/actions";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const rows = await getDb()
    .select({
      id: clients.id,
      name: clients.name,
      status: clients.status,
      valueCents: clients.valueCents,
      acquiredOn: clients.acquiredOn,
    })
    .from(clients)
    .orderBy(desc(clients.acquiredOn));

  return <ClientsAdmin clients={rows as ClientRow[]} createAction={createClient} deleteAction={deleteClient} />;
}
