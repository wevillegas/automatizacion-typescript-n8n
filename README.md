# Agente Autónomo de Triaje de Soporte

Backend headless en TypeScript que decide qué tools ejecutar ante una solicitud de soporte, con aprobación humana obligatoria para acciones de riesgo alto. n8n gestiona la entrada de eventos y las notificaciones; el agente contiene el loop, el registro de tools y la validación.

Ver la ficha técnica completa en `Ficha Técnica Agente Autónomo de Triaje de Soporte (TypeScript + n8n).md`.

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
