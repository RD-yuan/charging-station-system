from enum import Enum
from pydantic import BaseModel, Field


class ChargeMode(str, Enum):
    FAST = "FAST"
    SLOW = "SLOW"


class OrderStatus(str, Enum):
    WAITING = "WAITING"
    IN_PILE_QUEUE = "IN_PILE_QUEUE"
    CHARGING = "CHARGING"
    FINISHED = "FINISHED"
    CANCELED = "CANCELED"
    ABORTED = "ABORTED"


class WorkingState(str, Enum):
    IDLE = "IDLE"
    CHARGING = "CHARGING"
    FAULT = "FAULT"


class CarOrder(BaseModel):
    order_id: str
    queue_no: str
    charge_mode: ChargeMode | None = None
    requested_amount: float = Field(gt=0)
    status: OrderStatus = OrderStatus.WAITING


class PileQueueState(BaseModel):
    pile_id: str
    pile_type: ChargeMode
    power: float = Field(gt=0)
    working_state: WorkingState = WorkingState.IDLE
    queue_capacity: int = Field(default=2, gt=0)
    queued_orders: list[CarOrder] = Field(default_factory=list)


class BasicDispatchRequest(BaseModel):
    mode: ChargeMode
    waiting_orders: list[CarOrder] = Field(default_factory=list)
    pile_queues: list[PileQueueState] = Field(default_factory=list)


class FaultDispatchRequest(BaseModel):
    pile_id: str
    affected_orders: list[CarOrder] = Field(default_factory=list)
    same_mode_pile_queues: list[PileQueueState] = Field(default_factory=list)


class SingleOptimizationRequest(BaseModel):
    spots_count: int = Field(gt=0)
    mode: ChargeMode
    candidate_orders: list[CarOrder] = Field(default_factory=list)
    pile_queues: list[PileQueueState] = Field(default_factory=list)


class BatchOptimizationRequest(BaseModel):
    spots_count: int = Field(gt=0)
    candidate_orders: list[CarOrder] = Field(default_factory=list)
    pile_queues: list[PileQueueState] = Field(default_factory=list)


class Assignment(BaseModel):
    order_id: str
    queue_no: str
    pile_id: str
    projected_finish_time: float


class DispatchResponse(BaseModel):
    applied: bool = True
    message: str = "ok"
    assignments: list[Assignment] = Field(default_factory=list)
