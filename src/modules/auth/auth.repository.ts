import prisma from "../../config/prisma";

export function findByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export function createUser(data: { name: string; email: string; password: string }) {
  return prisma.user.create({ data });
}
