import { prisma } from "../src/db/client.js";

const users = [
  { id: "u-100", name: "Ana Pérez", status: "active" },
  { id: "u-200", name: "Luis Gómez", status: "suspended" },
  { id: "8492", name: "Marta Ruiz", status: "suspended" },
];

for (const u of users) {
  await prisma.user.upsert({ where: { id: u.id }, create: u, update: u });
}
console.log(`Seed OK: ${users.length} usuarios`);
await prisma.$disconnect();
