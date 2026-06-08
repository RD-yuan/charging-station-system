from app.schemas import CarOrder, ChargeMode, PileQueueState
from app.strategies import batch_optimization_dispatch, fault_time_order_dispatch


def test_fault_time_order_keeps_original_queue_numbers():
    affected = [
        CarOrder(order_id="o3", queue_no="F3", charge_mode=ChargeMode.FAST, requested_amount=10),
        CarOrder(order_id="o1", queue_no="F1", charge_mode=ChargeMode.FAST, requested_amount=10),
    ]
    piles = [
        PileQueueState(pile_id="F01", pile_type=ChargeMode.FAST, power=30),
        PileQueueState(pile_id="F02", pile_type=ChargeMode.FAST, power=30),
    ]

    result = fault_time_order_dispatch(affected, piles)

    assert [item.queue_no for item in result] == ["F1", "F3"]


def test_batch_optimization_does_not_require_mode():
    orders = [
        CarOrder(order_id="f1", queue_no="F1", charge_mode=ChargeMode.FAST, requested_amount=30),
        CarOrder(order_id="t1", queue_no="T1", charge_mode=ChargeMode.SLOW, requested_amount=20),
    ]
    piles = [
        PileQueueState(pile_id="F01", pile_type=ChargeMode.FAST, power=30),
        PileQueueState(pile_id="T01", pile_type=ChargeMode.SLOW, power=10),
    ]

    result = batch_optimization_dispatch(orders, piles, spots_count=2)

    assert {item.order_id for item in result} == {"f1", "t1"}
