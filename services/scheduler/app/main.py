from fastapi import FastAPI

from .schemas import (
    BasicDispatchRequest,
    BatchOptimizationRequest,
    DispatchResponse,
    FaultDispatchRequest,
    SingleOptimizationRequest,
)
from .strategies import (
    basic_shortest_dispatch,
    batch_optimization_dispatch,
    fault_priority_dispatch,
    fault_time_order_dispatch,
    single_optimization_dispatch,
)

app = FastAPI(title="Charging Scheduler Service", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/dispatch/basic", response_model=DispatchResponse)
def dispatch_basic(payload: BasicDispatchRequest) -> DispatchResponse:
    orders = [order for order in payload.waiting_orders if order.charge_mode == payload.mode]
    piles = [pile for pile in payload.pile_queues if pile.pile_type == payload.mode]
    return DispatchResponse(assignments=basic_shortest_dispatch(orders, piles))


@app.post("/dispatch/fault-priority", response_model=DispatchResponse)
def dispatch_fault_priority(payload: FaultDispatchRequest) -> DispatchResponse:
    return DispatchResponse(
        message="waiting-area call paused; affected queue has priority",
        assignments=fault_priority_dispatch(payload.affected_orders, payload.same_mode_pile_queues),
    )


@app.post("/dispatch/fault-time-order", response_model=DispatchResponse)
def dispatch_fault_time_order(payload: FaultDispatchRequest) -> DispatchResponse:
    return DispatchResponse(
        message="same-mode uncharged vehicles are reordered by original F/T queue number",
        assignments=fault_time_order_dispatch(payload.affected_orders, payload.same_mode_pile_queues),
    )


@app.post("/dispatch/recovery-time-order", response_model=DispatchResponse)
def dispatch_recovery_time_order(payload: FaultDispatchRequest) -> DispatchResponse:
    return DispatchResponse(
        message="recovered pile participates in same-mode queue-number reorder",
        assignments=fault_time_order_dispatch(payload.affected_orders, payload.same_mode_pile_queues),
    )


@app.post("/dispatch/single-optimization", response_model=DispatchResponse)
def dispatch_single_optimization(payload: SingleOptimizationRequest) -> DispatchResponse:
    piles = [pile for pile in payload.pile_queues if pile.pile_type == payload.mode]
    orders = [order for order in payload.candidate_orders if order.charge_mode == payload.mode]
    return DispatchResponse(
        assignments=single_optimization_dispatch(orders, piles, payload.spots_count)
    )


@app.post("/dispatch/batch-optimization", response_model=DispatchResponse)
def dispatch_batch_optimization(payload: BatchOptimizationRequest) -> DispatchResponse:
    return DispatchResponse(
        message="batch optimization ignores charge mode by requirement",
        assignments=batch_optimization_dispatch(payload.candidate_orders, payload.pile_queues, payload.spots_count),
    )
