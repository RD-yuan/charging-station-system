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

  const obsoletePileIds = ['F1', 'F2', 'T1', 'T2', 'T3']
  const removedObsoletePiles = await prisma.chargingPile.deleteMany({
    where: {
      id: { in: obsoletePileIds },
      orders: { none: {} },
      sessions: { none: {} }
    }
  })
  if (removedObsoletePiles.count > 0) {
    console.log(`Obsolete charging piles removed: ${removedObsoletePiles.count}`)
  }

  const piles = [
    { id: 'F01', pileType: 'FAST' as const, power: Number(process.env.FAST_PILE_POWER ?? 30) },
    { id: 'F02', pileType: 'FAST' as const, power: Number(process.env.FAST_PILE_POWER ?? 30) },
    { id: 'T01', pileType: 'SLOW' as const, power: Number(process.env.SLOW_PILE_POWER ?? 10) },
    { id: 'T02', pileType: 'SLOW' as const, power: Number(process.env.SLOW_PILE_POWER ?? 10) },
    { id: 'T03', pileType: 'SLOW' as const, power: Number(process.env.SLOW_PILE_POWER ?? 10) }
  ]
  for (const pile of piles) {
    await prisma.chargingPile.upsert({
      where: { id: pile.id },
      update: { pileType: pile.pileType, power: pile.power },
      create: { ...pile, physicalState: 'ON', workingState: 'IDLE' }
    })
  }
  console.log(`Charging piles seeded: ${piles.map((pile) => pile.id).join(', ')}`)

  const rules = [
    { id: 'rule-v1-flat-morning', period: 'FLAT' as const, startMinute: 420, endMinute: 600, price: 0.7 },
    { id: 'rule-v1-peak-day', period: 'PEAK' as const, startMinute: 600, endMinute: 900, price: 1.0 },
    { id: 'rule-v1-flat-afternoon', period: 'FLAT' as const, startMinute: 900, endMinute: 1080, price: 0.7 },
    { id: 'rule-v1-peak-evening', period: 'PEAK' as const, startMinute: 1080, endMinute: 1260, price: 1.0 },
    { id: 'rule-v1-flat-night', period: 'FLAT' as const, startMinute: 1260, endMinute: 1380, price: 0.7 },
    { id: 'rule-v1-valley', period: 'VALLEY' as const, startMinute: 1380, endMinute: 420, price: 0.4 }
  ]
  const now = new Date()
  for (const rule of rules) {
    await prisma.$executeRaw`
      INSERT INTO \`BillingRule\`
        (\`id\`, \`period\`, \`startMinute\`, \`endMinute\`, \`price\`, \`serviceFeeRate\`, \`version\`, \`active\`, \`createdAt\`, \`updatedAt\`)
      VALUES
        (${rule.id}, ${rule.period}, ${rule.startMinute}, ${rule.endMinute}, ${rule.price}, ${0.8}, ${1}, ${true}, ${now}, ${now})
      ON DUPLICATE KEY UPDATE
        \`period\` = VALUES(\`period\`),
        \`startMinute\` = VALUES(\`startMinute\`),
        \`endMinute\` = VALUES(\`endMinute\`),
        \`price\` = VALUES(\`price\`),
        \`serviceFeeRate\` = VALUES(\`serviceFeeRate\`),
        \`version\` = VALUES(\`version\`),
        \`active\` = VALUES(\`active\`),
        \`updatedAt\` = VALUES(\`updatedAt\`)
    `
  }
  console.log(`Billing rules seeded: ${rules.length}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
