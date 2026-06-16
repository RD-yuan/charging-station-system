import { WorkingState } from '@prisma/client'
import { SchedulerAssignment, SchedulerOrder, SchedulerPile } from './dispatch.service'

/**
 * 多机调度最优解（P||∑C_j 问题）：
 *
 * 目标：min sum_j (完工时间_j)
 *
 * 已知结论：把订单按加工时间（amount/power）**升序**排，每次给"完工时间最早"的桩，
 * 是该问题的最优解（SPT-rule，Shortest Processing Time first）。
 *
 * 直觉：
 *   - 小订单先做，它的完工时间短，对总和贡献小
 *   - 大订单后做，无论它在哪个桩，都会拉长后续订单的等待
 *   - 把小订单放在前面"清场"，让总完工时间最小
 */
function solveSpt(
  orders: SchedulerOrder[],
  piles: SchedulerPile[]
): { order: SchedulerOrder; pile: SchedulerPile; finishTime: number }[] {
  // 按加工时间 = amount / power 升序排
  // 但 power 取决于桩 —— 这里先按 amount 升序（等功率下等价于按加工时间）
  const sortedOrders = [...orders].sort((a, b) => a.requested_amount - b.requested_amount)

  const pileStates = piles
    .filter((p) => p.working_state !== WorkingState.FAULT)
    .map((p) => ({
      pile: p,
      queueSum: p.queued_orders.reduce((s, o) => s + o.requested_amount, 0),
      slotsLeft: p.queue_capacity - p.queued_orders.length
    }))

  const result: { order: SchedulerOrder; pile: SchedulerPile; finishTime: number }[] = []

  for (const order of sortedOrders) {
    // 选当前 queueSum 最大的空闲 slot（最不"忙"的桩），让负载均衡
    // 同时考虑：加工时间 = (queueSum + amount) / power 最小
    pileStates.sort((a, b) => {
      const aFinish = (a.queueSum + order.requested_amount) / a.pile.power
      const bFinish = (b.queueSum + order.requested_amount) / b.pile.power
      if (aFinish !== bFinish) return aFinish - bFinish
      // 平局：倾向于高功率桩（让快桩处理大单，慢桩处理小单）
      return b.pile.power - a.pile.power
    })
    const target = pileStates.find((s) => s.slotsLeft > 0)
    if (!target) continue
    const finishTime = (target.queueSum + order.requested_amount) / target.pile.power
    result.push({ order, pile: target.pile, finishTime })
    target.queueSum += order.requested_amount
    target.slotsLeft -= 1
  }
  return result
}

/**
 * 单次最优调度（PS 扩展 a）：
 *   - 同模式约束（F→F 桩，T→T 桩）
 *   - 最小化所有车"完工时间"之和
 *
 * 算法：SPT rule（按 amount 升序）+ earliest-finish-first，对 P||∑C_j 是数学最优。
 */
export function singleOptimalDispatch(
  orders: SchedulerOrder[],
  piles: SchedulerPile[]
): SchedulerAssignment[] {
  const assignments: SchedulerAssignment[] = []
  for (const mode of ['FAST', 'SLOW'] as const) {
    const modeOrders = orders.filter((o) => o.charge_mode === mode)
    const modePiles = piles.filter((p) => p.pile_type === mode)
    const solved = solveSpt(modeOrders, modePiles)
    for (const r of solved) {
      assignments.push({
        order_id: r.order.order_id,
        queue_no: r.order.queue_no,
        pile_id: r.pile.pile_id,
        projected_finish_time: Math.round(r.finishTime * 10000) / 10000
      })
    }
  }
  return assignments
}

/**
 * 批量最优调度（PS 扩展 b）：
 *   - 无模式约束（任意车可分到任意桩）
 *   - 最小化所有车"完工时间"之和
 *
 * 算法：SPT rule + earliest-finish-first（跨模式）。大订单（如 100 度）在 F 桩只需 3.33h，
 * 在 T 桩要 10h，所以系统会自然把大订单优先放到 F 桩（因为 F 桩完工时间更短）。
 */
export function batchOptimalDispatch(
  orders: SchedulerOrder[],
  piles: SchedulerPile[]
): SchedulerAssignment[] {
  const solved = solveSpt(orders, piles)
  return solved.map((r) => ({
    order_id: r.order.order_id,
    queue_no: r.order.queue_no,
    pile_id: r.pile.pile_id,
    projected_finish_time: Math.round(r.finishTime * 10000) / 10000
  }))
}

/**
 * 计算一组调度结果的总完工时间（用于策略对比）。
 * 总完工时间 = 所有订单 projected_finish_time 之和。
 */
export function totalFinishTime(assignments: SchedulerAssignment[]): number {
  return assignments.reduce((s, a) => s + (a.projected_finish_time ?? 0), 0)
}
