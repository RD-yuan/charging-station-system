import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(__dirname, '../.env') })

const prisma = new PrismaClient()

async function main() {
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: await bcrypt.hash('admin123', 10),
      role: 'ADMIN',
      batteryCapacity: 100
    }
  })
  console.log(`Admin user seeded: ${admin.username} (id: ${admin.id}, role: ${admin.role})`)

  const demoUser = await prisma.user.upsert({
    where: { username: 'user_01' },
    update: {},
    create: {
      username: 'user_01',
      passwordHash: await bcrypt.hash('user123', 10),
      role: 'USER',
      batteryCapacity: 60
    }
  })
  console.log(`Demo user seeded: ${demoUser.username} (id: ${demoUser.id}, role: ${demoUser.role})`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
