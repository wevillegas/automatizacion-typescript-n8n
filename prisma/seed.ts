import { prisma } from "../src/db/client.js";

const users = [
  { id: "u-100", name: "Ana Pérez", status: "active" },
  { id: "u-200", name: "Luis Gómez", status: "suspended" },
  { id: "8492", name: "Marta Ruiz", status: "suspended" },
];

for (const u of users) {
  await prisma.user.upsert({ where: { id: u.id }, create: u, update: u });
}
// Tickets de ejemplo solo si el usuario todavía no tiene ninguno (no pisa los que creó el agente).
const tickets = [
  { userId: "8492", category: "facturación", summary: "Cobro duplicado en la factura de marzo", status: "cerrado" },
  { userId: "8492", category: "acceso", summary: "No puede iniciar sesión tras la suspensión", status: "abierto" },
];
if ((await prisma.ticket.count({ where: { userId: "8492" } })) === 0) {
  await prisma.ticket.createMany({ data: tickets });
}
console.log(`Seed OK: ${users.length} usuarios, ${await prisma.ticket.count()} tickets`);
await prisma.$disconnect();
