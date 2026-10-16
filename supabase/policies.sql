-- Ejecutar una vez en Supabase > SQL Editor, después de `npx prisma migrate deploy`.
-- Prisma se conecta como `postgres` (ignora RLS); el dashboard usa la anon key (sujeta a RLS).
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PendingApproval" ENABLE ROW LEVEL SECURITY; -- sin policy: anon no ve el historial de mensajes

DROP POLICY IF EXISTS "anon lee auditoria" ON "AuditLog";
CREATE POLICY "anon lee auditoria" ON "AuditLog" FOR SELECT TO anon USING (true);

-- Tabla que lee el dashboard (una fila por solicitud).
ALTER TABLE "Request" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon lee solicitudes" ON "Request";
CREATE POLICY "anon lee solicitudes" ON "Request" FOR SELECT TO anon USING (true);

-- Usuarios: solo el backend (rol postgres) los toca; anon no ve nada.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
