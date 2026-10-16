-- Ejecutar una vez en Supabase > SQL Editor, después de `npx prisma migrate deploy`.
-- Prisma se conecta como `postgres` (ignora RLS); el dashboard usa la anon key (sujeta a RLS).
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PendingApproval" ENABLE ROW LEVEL SECURITY; -- sin policy: anon no ve el historial de mensajes

DROP POLICY IF EXISTS "anon lee auditoria" ON "AuditLog";
CREATE POLICY "anon lee auditoria" ON "AuditLog" FOR SELECT TO anon USING (true);
