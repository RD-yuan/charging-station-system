import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { config } from 'dotenv'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { randomUUID } from 'crypto'

for (const envPath of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
  resolve(__dirname, '../.env'),
  resolve(__dirname, '../../../.env')
]) {
  if (existsSync(envPath)) config({ path: envPath, override: false })
}

const prisma = new PrismaClient()

async function main() {
  const adminPasswordHash = await bcrypt.hash('admin123', 10)
  const demoPasswordHash = await bcrypt.hash('user123', 10)
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
      batteryCapacity: 100
    },
    create: {
      username: 'admin',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
      batteryCapacity: 100
    }
  })
  console.log(`Admin user seeded: ${admin.username} (id: ${admin.id}, role: ${admin.role})`)

  const demoUser = await prisma.user.upsert({
    where: { username: 'user_01' },
    update: {
      passwordHash: demoPasswordHash,
      role: 'USER',
      batteryCapacity: 60
    },
    create: {
      username: 'user_01',
      passwordHash: demoPasswordHash,
      role: 'USER',
      batteryCapacity: 60
    }
  })
  console.log(`Demo user seeded: ${demoUser.username} (id: ${demoUser.id}, role: ${demoUser.role})`)

  const fastPower = Number(process.env.FAST_PILE_POWER ?? 30)
  const slowPower = Number(process.env.SLOW_PILE_POWER ?? 10)
  const piles = [
    { id: 'F01', pileType: 'FAST' as const, power: fastPower },
    { id: 'F02', pileType: 'FAST' as const, power: fastPower },
    { id: 'T01', pileType: 'SLOW' as const, power: slowPower },
    { id: 'T02', pileType: 'SLOW' as const, power: slowPower },
    { id: 'T03', pileType: 'SLOW' as const, power: slowPower }
  ]

  for (const duplicateId of ['F1', 'F2', 'T1', 'T2', 'T3']) {
    const [orders, sessions] = await Promise.all([
      prisma.chargingOrder.count({ where: { assignedPileId: duplicateId } }),
      prisma.chargingSession.count({ where: { pileId: duplicateId } })
    ])
    if (orders === 0 && sessions === 0) {
      await prisma.chargingPile.deleteMany({ where: { id: duplicateId } })
    }
  }

  for (const pile of piles) {
    await prisma.chargingPile.upsert({
      where: { id: pile.id },
      update: {
        pileType: pile.pileType,
        power: pile.power,
        physicalState: 'ON',
        workingState: 'IDLE'
      },
      create: {
        ...pile,
        physicalState: 'ON',
        workingState: 'IDLE'
      }
    })
  }
  console.log(`Charging piles seeded: ${piles.map((pile) => pile.id).join(', ')}`)

  const now = new Date()
  await prisma.$executeRaw`
    UPDATE BillingRule
    SET active = false, updatedAt = ${now}
    WHERE active = true
  `
  const billingRules = [
    { period: 'FLAT' as const, startMinute: 7 * 60, endMinute: 10 * 60, price: 0.7 },
    { period: 'PEAK' as const, startMinute: 10 * 60, endMinute: 15 * 60, price: 1.0 },
    { period: 'FLAT' as const, startMinute: 15 * 60, endMinute: 18 * 60, price: 0.7 },
    { period: 'PEAK' as const, startMinute: 18 * 60, endMinute: 21 * 60, price: 1.0 },
    { period: 'FLAT' as const, startMinute: 21 * 60, endMinute: 23 * 60, price: 0.7 },
    { period: 'VALLEY' as const, startMinute: 23 * 60, endMinute: 7 * 60, price: 0.4 }
  ]
  for (const rule of billingRules) {
    await prisma.$executeRaw`
      INSERT INTO BillingRule (
        id, period, startMinute, endMinute, price, serviceFeeRate, version, active, createdAt, updatedAt
      )
      VALUES (
        ${randomUUID()}, ${rule.period}, ${rule.startMinute}, ${rule.endMinute}, ${rule.price}, 0.8, 1, true, ${now}, ${now}
      )
    `
  }
  console.log('Billing rules seeded: peak/flat/valley version 1')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
