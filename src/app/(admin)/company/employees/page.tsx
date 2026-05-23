import { getDb } from "@/db/client";
import { employees } from "@/db/schema";
import { desc } from "drizzle-orm";
import { EmployeesAdmin, type EmployeeRow } from "@/components/company/EmployeesAdmin";
import { createEmployee, deleteEmployee } from "@/lib/company/actions";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const rows = (await getDb()
    .select({
      id: employees.id,
      name: employees.name,
      role: employees.role,
      hiredOn: employees.hiredOn,
    })
    .from(employees)
    .orderBy(desc(employees.hiredOn))) as EmployeeRow[];

  return <EmployeesAdmin rows={rows} createAction={createEmployee} deleteAction={deleteEmployee} />;
}
