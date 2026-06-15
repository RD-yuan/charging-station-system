from __future__ import annotations

from .schemas import Assignment, CarOrder, PileQueueState


def queue_no_number(queue_no: str) -> int:
    digits = "".join(ch for ch in queue_no if ch.isdigit())
    return int(digits or "0")


def projected_finish_time(order: CarOrder, pile: PileQueueState) -> float:
    queued_time = sum(item.requested_amount / pile.power for item in pile.queued_orders)
    own_time = order.requested_amount / pile.power
    return queued_time + own_time


def choose_shortest_pile(order: CarOrder, piles: list[PileQueueState]) -> PileQueueState | None:
    available = [pile for pile in piles if pile.working_state != "FAULT"]
    if not available:
        return None
    return min(
        available,
        key=lambda pile: (projected_finish_time(order, pile), pile.pile_id, len(pile.queued_orders)),
    )


def basic_shortest_dispatch(
    waiting_orders: list[CarOrder],
    pile_queues: list[PileQueueState],
) -> list[Assignment]:
    assignments: list[Assignment] = []
    for order in waiting_orders:
        target = choose_shortest_pile(order, pile_queues)
        if target is None:
            continue
        finish_time = projected_finish_time(order, target)
        assignments.append(
            Assignment(
                order_id=order.order_id,
                queue_no=order.queue_no,
                pile_id=target.pile_id,
                projected_finish_time=round(finish_time, 4),
            )
        )
        target.queued_orders.append(order)
    return assignments


def fault_priority_dispatch(
    affected_orders: list[CarOrder],
    same_mode_pile_queues: list[PileQueueState],
) -> list[Assignment]:
    # Only affected orders are dispatched while waiting-area call is paused.
    return basic_shortest_dispatch(affected_orders, same_mode_pile_queues)


def fault_time_order_dispatch(
    affected_orders: list[CarOrder],
    same_mode_pile_queues: list[PileQueueState],
) -> list[Assignment]:
    candidates = list(affected_orders)
    candidates.sort(key=lambda order: queue_no_number(order.queue_no))
    return basic_shortest_dispatch(candidates, same_mode_pile_queues)


def single_optimization_dispatch(
    candidate_orders: list[CarOrder],
    pile_queues: list[PileQueueState],
    spots_count: int,
) -> list[Assignment]:
    candidates = candidate_orders[:spots_count]
    return basic_shortest_dispatch(candidates, pile_queues)


def batch_optimization_dispatch(
    candidate_orders: list[CarOrder],
    pile_queues: list[PileQueueState],
    spots_count: int,
) -> list[Assignment]:
    # Batch optimization intentionally ignores charge mode and arrival order.
    candidates = sorted(candidate_orders[:spots_count], key=lambda order: order.requested_amount, reverse=True)
    return basic_shortest_dispatch(candidates, pile_queues)
