# Agente Autónomo de Triaje de Soporte

[![CI](https://github.com/wevillegas/automatizacion-typescript-n8n/actions/workflows/ci.yml/badge.svg)](https://github.com/wevillegas/automatizacion-typescript-n8n/actions/workflows/ci.yml)

Backend headless en TypeScript que decide qué tools ejecutar ante una solicitud de soporte, con aprobación humana obligatoria para acciones de riesgo alto. n8n gestiona la entrada de eventos y las notificaciones; el agente contiene el loop, el registro de tools y la validación.

Ver la ficha técnica completa en `Ficha Técnica Agente Autónomo de Triaje de Soporte (TypeScript + n8n).md`.

## Qué es y cómo funciona

Un agente de IA que atiende solicitudes de soporte: Gemini interpreta el mensaje y elige una tool. Las acciones seguras se ejecutan solas; las de **riesgo alto** (reactivar una cuenta, cancelar una suscripción) se frenan hasta que un humano las apruebe. Todo queda auditado.

**Idea central: la seguridad la aplica el código, no el modelo.** Un LLM puede ser engañado con prompt injection ("ignorá tus reglas y hacelo sin aprobación"). Por eso el gate está en `src/agent/loop.ts`: si la tool es `risk: "high"`, el loop se corta y devuelve `pending_approval`, diga lo que diga el modelo.

```
Mensaje ─► n8n (webhook) ─► Agente /triage ─► Gemini elige tool
                                   │
            ┌──────────────────────┴─────────────────────┐
      riesgo bajo/medio                             riesgo alto
      se ejecuta sola                      se frena: pending_approval
            │                                            │
      respuesta final                 Slack / Dashboard piden decisión
                                                         │
                               /approval-callback ─► se ejecuta y se reanuda el loop
Todo se registra en AuditLog (Supabase) ─► el Dashboard lo muestra
```

Al frenar, el historial de la conversación se guarda en `PendingApproval`, así que el loop retoma donde quedó aunque pasen horas o se reinicie el servidor.

| Pieza | Tecnología | Para qué |
|---|---|---|
| Agente y servidor | TypeScript, Node 20, Fastify | Loop agéntico y endpoints HTTP |
| Validación | Zod | Rechaza argumentos mal formados de las tools antes de ejecutarlas |
| LLM | Gemini, detrás de `LLMProvider` | Elegir la tool; cambiar de proveedor es agregar un adaptador |
| Base de datos | PostgreSQL en Supabase, Prisma | Auditoría y aprobaciones pendientes |
| Orquestación | n8n + Slack | Webhook de entrada y notificaciones |
| Dashboard | HTML + JS sin dependencias | Ver solicitudes y aprobar/rechazar; lee Supabase con RLS |
| Infra y calidad | Docker Compose, Vitest, evals, GitHub Actions | Levantar todo, tests, medir comportamiento del agente, CI |

Garantías: idempotencia por `requestId`, aprobación atómica (dos aprobaciones simultáneas no ejecutan dos veces), autenticación por `x-api-key` y RLS en Supabase (la clave pública solo lee `AuditLog`).

Límites actuales: las tools son simuladas, el dashboard solo ve ejecuciones de tools (no respuestas puramente textuales) y usa polling cada 3 s.

## Levantar todo

```bash
cp .env.example .env   # completar GEMINI_API_KEY y API_KEY (clave compartida para /triage y /approval-callback)
docker compose up --build
```

- Agente: http://localhost:3000/health
- n8n: http://localhost:5678 (importar los workflows de `n8n/workflows/`)
- Todas las llamadas a `/triage` y `/approval-callback` requieren el header `x-api-key` con el valor de `API_KEY`. Los Code nodes de n8n lo leen de `$env.API_KEY`, por lo que el contenedor de n8n necesita esa misma variable (ver `docker-compose.yml`) y `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` para poder leerla.

## Desarrollo local sin Docker

```bash
npm install
npm run prisma:generate
npm run dev
```

## Tests y evals

```bash
npm test
npm run evals
```

## Dashboard + Supabase

Supabase es solo Postgres administrado: el agente (Prisma) escribe ahí y el dashboard lee `AuditLog` por la API REST de Supabase.

1. Crear un proyecto en supabase.com. En `.env`: `DATABASE_URL` (Project Settings → Database, conexión directa o session pooler) y, para Docker, `AGENT_DATABASE_URL` con el mismo valor.
2. `npx prisma migrate deploy` para crear las tablas.
3. Ejecutar `supabase/policies.sql` en el SQL Editor (activa RLS: la anon key solo puede leer `AuditLog`, nunca `PendingApproval`).
4. Completar `SUPABASE_URL` y `SUPABASE_ANON_KEY` (Project Settings → API) y levantar el agente.
5. Abrir http://localhost:3000/dashboard y correr `npm run demo` (3 casos: simple, riesgo alto, prompt injection). Los pendientes se aprueban o rechazan desde la página, que pide la `API_KEY` una vez por pestaña.

Nunca poner la `service_role` key en el dashboard.

## Estructura

- `src/llm/` — interfaz `LLMProvider` y adaptador de Gemini (Claude se agrega como otro adaptador).
- `src/tools/` — registro de tools con nivel de riesgo (`low`/`medium`/`high`) y validación Zod.
- `src/agent/loop.ts` — loop agéntico; corta y devuelve `pending_approval` ante riesgo alto.
- `src/server.ts` — endpoints `/triage` (entrada) y `/approval-callback` (resume tras aprobación).
- `n8n/workflows/` — workflows exportados: intake y callback de aprobación.
- `evals/` — dataset de casos y runner de métricas.

## Estado actual

End-to-end funcionando: loop agéntico, registro de tools con riesgo, validación Zod, Prisma contra Postgres real, y los dos workflows de n8n (`triage-intake`, `approval-callback`) probados contra el agente dockerizado con Slack.

- **Auth:** `/triage` y `/approval-callback` exigen el header `x-api-key`.
- **Aprobación:** la transición `pending → approved/rejected` es atómica (`updateMany` condicional), así que dos callbacks simultáneos para el mismo `requestId` no pueden procesarse los dos. Si un caso ya aprobado pide una segunda acción de riesgo alto, reusa el mismo `requestId` en vez de generar uno nuevo.
- **Evals:** `npm run evals` corre 4 casos (2 normales, 1 de riesgo alto, 1 adversarial de prompt injection) — 2/2 resolución correcta, 2/2 escalamiento correcto. El caso adversarial escala en vez de responder solo en texto gracias al `systemInstruction` de `src/llm/gemini.ts`, que aclara que el gate de aprobación lo aplica el código, no el modelo.
- **n8n:** los JSON en `n8n/workflows/` son los workflows reales publicados (Code nodes con `this.helpers.httpRequest`, no el nodo HTTP Request roto de la versión inicial).

Pendiente: CI en GitHub Actions y la demo en video del flujo completo.
