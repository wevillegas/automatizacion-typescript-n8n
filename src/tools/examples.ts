import { z } from "zod";
import { registerTool } from "./registry.js";

registerTool({
  name: "getUserStatus",
  description: "Consulta el estado de una cuenta de usuario por id.",
  risk: "low",
  schema: z.object({ userId: z.string() }),
  jsonSchema: {
    type: "object",
    properties: { userId: { type: "string" } },
    required: ["userId"],
  },
  run: async ({ userId }: { userId: string }) => {
    // ponytail: stub en memoria, reemplazar por consulta real vía Prisma cuando exista el modelo de usuario.
    return { userId, status: "suspended" };
  },
});

registerTool({
  name: "createSupportTicket",
  description: "Crea un ticket de soporte para un usuario con una categoría.",
  risk: "medium",
  schema: z.object({ userId: z.string(), category: z.string(), summary: z.string() }),
  jsonSchema: {
    type: "object",
    properties: {
      userId: { type: "string" },
      category: { type: "string" },
      summary: { type: "string" },
    },
    required: ["userId", "category", "summary"],
  },
  run: async (args: { userId: string; category: string; summary: string }) => {
    return { ticketId: `TCK-${Date.now()}`, ...args };
  },
});

registerTool({
  name: "reactivarCuenta",
  description: "Reactiva una cuenta de usuario suspendida.",
  risk: "high",
  schema: z.object({ userId: z.string() }),
  jsonSchema: {
    type: "object",
    properties: { userId: { type: "string" } },
    required: ["userId"],
  },
  run: async ({ userId }: { userId: string }) => {
    return { userId, status: "active" };
  },
});

registerTool({
  name: "consultarHistorialTickets",
  description: "Consulta los últimos tickets de soporte creados por un usuario.",
  risk: "low",
  schema: z.object({ userId: z.string() }),
  jsonSchema: {
    type: "object",
    properties: { userId: { type: "string" } },
    required: ["userId"],
  },
  run: async ({ userId }: { userId: string }) => {
    // ponytail: stub en memoria, reemplazar por consulta real vía Prisma cuando exista el modelo de tickets.
    return {
      userId,
      tickets: [
        { ticketId: "TCK-1001", category: "facturación", status: "cerrado" },
        { ticketId: "TCK-1002", category: "acceso", status: "abierto" },
      ],
    };
  },
});

registerTool({
  name: "cancelarSuscripcion",
  description: "Cancela la suscripción activa de un usuario. Acción irreversible.",
  risk: "high",
  schema: z.object({ userId: z.string(), motivo: z.string() }),
  jsonSchema: {
    type: "object",
    properties: {
      userId: { type: "string" },
      motivo: { type: "string" },
    },
    required: ["userId", "motivo"],
  },
  run: async ({ userId, motivo }: { userId: string; motivo: string }) => {
    return { userId, status: "cancelada", motivo };
  },
});
