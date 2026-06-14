import { BillingPeriod, ChargeMode, PhysicalState, PrismaClient, WorkingState } from '@prisma/client'
import { hashPassword } from '../src/common/security'

const prisma = new PrismaClient()

async function main() {
  await prisma.administrator.upsert({
    where: { username: 'admin' },
    update: { adminName: '超级管理员' },
    create: {
      username: 'admin',
      adminName: '超级管理员',
      passwordHash: hashPassword('admin888')
    }
  })

  await prisma.user.upsert({
    where: { username: 'user_01' },
    update: {},
    create: {
      username: 'user_01',
      passwordHash: hashPassword('password123'),
      batteryCapacity: 60
    }
  })

  const piles = [
    { id: 'F01', pileType: ChargeMode.FAST, power: Number(process.env.FAST_PILE_POWER ?? 30) },
    { id: 'F02', pileType: ChargeMode.FAST, power: Number(process.env.FAST_PILE_POWER ?? 30) },
    { id: 'T01', pileType: ChargeMode.SLOW, power: Number(process.env.SLOW_PILE_POWER ?? 10) },
    { id: 'T02', pileType: ChargeMode.SLOW, power: Number(process.env.SLOW_PILE_POWER ?? 10) },
    { id: 'T03', pileType: ChargeMode.SLOW, power: Number(process.env.SLOW_PILE_POWER ?? 10) }
  ]

  for (const pile of piles) {
    await prisma.chargingPile.upsert({
      where: { id: pile.id },
      update: { pileType: pile.pileType, power: pile.power },
      create: {
        ...pile,
        physicalState: PhysicalState.ON,
        workingState: WorkingState.IDLE
      }
    })
  }

  const existingRules = await prisma.billingRule.count({ where: { active: true, version: 1 } })
  if (existingRules === 0) {
    await prisma.billingRule.createMany({
      data: [
        { period: BillingPeriod.FLAT, startMinute: 7 * 60, endMinute: 10 * 60, price: 0.7, serviceFeeRate: 0.8, version: 1 },
        { period: BillingPeriod.PEAK, startMinute: 10 * 60, endMinute: 15 * 60, price: 1.0, serviceFeeRate: 0.8, version: 1 },
        { period: BillingPeriod.FLAT, startMinute: 15 * 60, endMinute: 18 * 60, price: 0.7, serviceFeeRate: 0.8, version: 1 },
        { period: BillingPeriod.PEAK, startMinute: 18 * 60, endMinute: 21 * 60, price: 1.0, serviceFeeRate: 0.8, version: 1 },
        { period: BillingPeriod.FLAT, startMinute: 21 * 60, endMinute: 23 * 60, price: 0.7, serviceFeeRate: 0.8, version: 1 },
        { period: BillingPeriod.VALLEY, startMinute: 23 * 60, endMinute: 7 * 60, price: 0.4, serviceFeeRate: 0.8, version: 1 }
      ]
    })
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    process.exit(1)
  })
