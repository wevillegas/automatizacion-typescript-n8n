-- Ejecutar una vez en Supabase > SQL Editor, después de `npx prisma migrate deploy`.
-- Prisma se conecta como `postgres` (ignora RLS); el dashboard usa la anon key + el token del usuario
-- logueado (rol `authenticated`). Sin login (rol `anon`) no se ve nada.
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PendingApproval" ENABLE ROW LEVEL SECURITY; -- sin policy: nadie ve el historial de mensajes
ALTER TABLE "Request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;            -- sin policy: solo el backend toca usuarios
ALTER TABLE "Ticket" ENABLE ROW LEVEL SECURITY;          -- ídem tickets

DROP POLICY IF EXISTS "anon lee auditoria" ON "AuditLog";
DROP POLICY IF EXISTS "anon lee solicitudes" ON "Request";

DROP POLICY IF EXISTS "logueados leen auditoria" ON "AuditLog";
CREATE POLICY "logueados leen auditoria" ON "AuditLog" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "logueados leen solicitudes" ON "Request";
CREATE POLICY "logueados leen solicitudes" ON "Request" FOR SELECT TO authenticated USING (true);

-- Realtime: el dashboard recibe los cambios de Request por websocket (respeta la policy de arriba).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'Request') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "Request";
  END IF;
END $$;
