import { z } from "zod";
import { prisma } from "../db/client.js";
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
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return user ? { userId, name: user.name, status: user.status } : { userId, error: "usuario no encontrado" };
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
  run: async ({ userId, category, summary }: { userId: string; category: string; summary: string }) => {
    if (!(await prisma.user.findUnique({ where: { id: userId } }))) return { userId, error: "usuario no encontrado" };
    const t = await prisma.ticket.create({ data: { userId, category, summary } });
    return { ticketId: `TCK-${t.id}`, userId, category, summary, status: t.status };
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
    const { count } = await prisma.user.updateMany({ where: { id: userId }, data: { status: "active" } });
    return count ? { userId, status: "active" } : { userId, error: "usuario no encontrado" };
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
    const tickets = await prisma.ticket.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10 });
    return {
      userId,
      tickets: tickets.map((t) => ({
        ticketId: `TCK-${t.id}`,
        category: t.category,
        summary: t.summary,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
      })),
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
    const { count } = await prisma.user.updateMany({ where: { id: userId }, data: { status: "cancelada" } });
    return count ? { userId, status: "cancelada", motivo } : { userId, error: "usuario no encontrado" };
  },
});
