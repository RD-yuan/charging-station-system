import { WorkingState } from '@prisma/client'
import type { SchedulerAssignment, SchedulerOrder, SchedulerPile } from './dispatch.service'

interface DispatchOptions {
  respectMode: boolean
}

interface Slot {
  id: number
  pile: SchedulerPile
  baseHours: number
  coefficient: number
}

interface SelectedAssignment {
  order: SchedulerOrder
  slot: Slot
}

interface Edge {
  to: number
  rev: number
  capacity: number
  cost: number
  orderIndex?: number
  slotIndex?: number
}

interface PathStep {
  previous: number
  edgeIndex: number
}

const COST_SCALE = 1_000_000

/**
 * Exact optimal dispatch by min-cost max-flow.
 *
 * For one pile with existing work W and m new jobs sorted by SPT
 * (requested amount ascending), the sum of new completion times is:
 *
 *   m * W + m*p1/s + (m-1)*p2/s + ... + 1*pm/s
 *
 * So each pile can be expanded into slots with coefficients 1..freeSlots.
 * Matching job j to a slot has cost:
 *
 *   W + amount_j * slotCoefficient / power
 *
 * After the min-cost matching selects the jobs for each pile, we restore the
 * real per-pile sequence by SPT and recompute projected finish times.
 */
function exactOptimalDispatch(
  orders: SchedulerOrder[],
  piles: SchedulerPile[],
  options: DispatchOptions
): SchedulerAssignment[] {
  const usablePiles = piles.filter((pile) => pile.working_state !== WorkingState.FAULT)
  const slots = buildSlots(usablePiles)
  if (orders.length === 0 || slots.length === 0) return []

  const selected = minCostMatch(orders, slots, options)
  return restorePileSchedules(selected)
}

function buildSlots(piles: SchedulerPile[]): Slot[] {
  const slots: Slot[] = []
  let id = 0
  for (const pile of piles) {
    const occupied = pile.queued_orders.length
    const freeSlots = Math.max(0, pile.queue_capacity - occupied)
    const baseHours = existingWorkHours(pile)
    for (let coefficient = 1; coefficient <= freeSlots; coefficient += 1) {
      slots.push({ id: id++, pile, baseHours, coefficient })
    }
  }
  return slots
}

function minCostMatch(
  orders: SchedulerOrder[],
  slots: Slot[],
  options: DispatchOptions
): SelectedAssignment[] {
  const source = 0
  const orderOffset = 1
  const slotOffset = orderOffset + orders.length
  const sink = slotOffset + slots.length
  const graph = Array.from({ length: sink + 1 }, () => [] as Edge[])

  for (let index = 0; index < orders.length; index += 1) {
    addEdge(graph, source, orderOffset + index, 1, 0)
  }

  for (let orderIndex = 0; orderIndex < orders.length; orderIndex += 1) {
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      const order = orders[orderIndex]
      const slot = slots[slotIndex]
      if (options.respectMode && order.charge_mode !== slot.pile.pile_type) continue
      addEdge(
        graph,
        orderOffset + orderIndex,
        slotOffset + slotIndex,
        1,
        scaledCost(order, slot),
        orderIndex,
        slotIndex
      )
    }
  }

  for (let index = 0; index < slots.length; index += 1) {
    addEdge(graph, slotOffset + index, sink, 1, 0)
  }

  const targetFlow = Math.min(orders.length, slots.length)
  for (let flow = 0; flow < targetFlow; flow += 1) {
    const path = shortestPath(graph, source, sink)
    if (!path) break
    let current = sink
    while (current !== source) {
      const { previous, edgeIndex } = path[current]!
      const edge = graph[previous][edgeIndex]
      edge.capacity -= 1
      graph[edge.to][edge.rev].capacity += 1
      current = previous
    }
  }

  const selected: SelectedAssignment[] = []
  for (let orderIndex = 0; orderIndex < orders.length; orderIndex += 1) {
    const node = orderOffset + orderIndex
    for (const edge of graph[node]) {
      if (edge.orderIndex == null || edge.slotIndex == null) continue
      if (edge.capacity === 0) {
        selected.push({ order: orders[edge.orderIndex], slot: slots[edge.slotIndex] })
      }
    }
  }
  return selected
}

function shortestPath(graph: Edge[][], source: number, sink: number): Array<PathStep | undefined> | null {
  const distance = Array(graph.length).fill(Number.POSITIVE_INFINITY) as number[]
  const inQueue = Array(graph.length).fill(false) as boolean[]
  const path: Array<PathStep | undefined> = Array(graph.length)
  const queue: number[] = [source]
  distance[source] = 0
  inQueue[source] = true

  while (queue.length > 0) {
    const node = queue.shift()!
    inQueue[node] = false
    for (let edgeIndex = 0; edgeIndex < graph[node].length; edgeIndex += 1) {
      const edge = graph[node][edgeIndex]
      if (edge.capacity <= 0) continue
      const nextDistance = distance[node] + edge.cost
      if (nextDistance >= distance[edge.to]) continue
      distance[edge.to] = nextDistance
      path[edge.to] = { previous: node, edgeIndex }
      if (!inQueue[edge.to]) {
        queue.push(edge.to)
        inQueue[edge.to] = true
      }
    }
  }

  return Number.isFinite(distance[sink]) ? path : null
}

function addEdge(
  graph: Edge[][],
  from: number,
  to: number,
  capacity: number,
  cost: number,
  orderIndex?: number,
  slotIndex?: number
) {
  const forward: Edge = {
    to,
    rev: graph[to].length,
    capacity,
    cost,
    orderIndex,
    slotIndex
  }
  const backward: Edge = {
    to: from,
    rev: graph[from].length,
    capacity: 0,
    cost: -cost
  }
  graph[from].push(forward)
  graph[to].push(backward)
}

function restorePileSchedules(selected: SelectedAssignment[]): SchedulerAssignment[] {
  const byPile = new Map<string, SelectedAssignment[]>()
  for (const item of selected) {
    const group = byPile.get(item.slot.pile.pile_id) ?? []
    group.push(item)
    byPile.set(item.slot.pile.pile_id, group)
  }

  const assignments: SchedulerAssignment[] = []
  for (const [pileId, items] of [...byPile.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const pile = items[0].slot.pile
    let finishTime = existingWorkHours(pile)
    for (const item of items.sort(compareOrdersForSpt)) {
      finishTime += item.order.requested_amount / pile.power
      assignments.push({
        order_id: item.order.order_id,
        queue_no: item.order.queue_no,
        pile_id: pileId,
        projected_finish_time: round(finishTime, 4)
      })
    }
  }
  return assignments
}

function scaledCost(order: SchedulerOrder, slot: Slot) {
  return Math.round((slot.baseHours + order.requested_amount * slot.coefficient / slot.pile.power) * COST_SCALE)
}

function existingWorkHours(pile: SchedulerPile) {
  return pile.queued_orders.reduce((sum, order) => sum + order.requested_amount / pile.power, 0)
}

function compareOrdersForSpt(left: SelectedAssignment, right: SelectedAssignment) {
  return left.order.requested_amount - right.order.requested_amount
    || left.order.queue_no.localeCompare(right.order.queue_no)
    || left.order.order_id.localeCompare(right.order.order_id)
}

/**
 * Extension A: single optimal dispatch.
 * - FAST orders can only use FAST piles; SLOW orders can only use SLOW piles.
 * - Waiting-area order is ignored inside this optimization batch.
 * - Objective: minimize the sum of completion times for the entering cars.
 */
export function singleOptimalDispatch(
  orders: SchedulerOrder[],
  piles: SchedulerPile[]
): SchedulerAssignment[] {
  return exactOptimalDispatch(orders, piles, { respectMode: true })
}

/**
 * Extension B: batch optimal dispatch.
 * - Charge mode is ignored; any order may use any pile type.
 * - Arrival order is ignored inside this optimization batch.
 * - Objective: minimize the sum of completion times for the whole batch.
 */
export function batchOptimalDispatch(
  orders: SchedulerOrder[],
  piles: SchedulerPile[]
): SchedulerAssignment[] {
  return exactOptimalDispatch(orders, piles, { respectMode: false })
}

export function totalFinishTime(assignments: SchedulerAssignment[]): number {
  return round(assignments.reduce((sum, assignment) => {
    return sum + (assignment.projected_finish_time ?? assignment.projectedFinishTime ?? 0)
  }, 0), 4)
}

function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
