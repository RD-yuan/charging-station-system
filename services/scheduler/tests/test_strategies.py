from app.schemas import CarOrder, ChargeMode, PileQueueState
from app.strategies import basic_shortest_dispatch, batch_optimization_dispatch, fault_priority_dispatch, fault_time_order_dispatch


def test_basic_dispatch_chooses_shortest_projected_finish_time():
    orders = [
        CarOrder(order_id="o1", queue_no="F1", charge_mode=ChargeMode.FAST, requested_amount=30),
    ]
    piles = [
        PileQueueState(
            pile_id="F01",
            pile_type=ChargeMode.FAST,
            power=30,
            queued_orders=[CarOrder(order_id="old", queue_no="F0", charge_mode=ChargeMode.FAST, requested_amount=60)],
        ),
        PileQueueState(pile_id="F02", pile_type=ChargeMode.FAST, power=30),
    ]

    result = basic_shortest_dispatch(orders, piles)

    assert result[0].pile_id == "F02"


def test_fault_priority_dispatch_only_uses_affected_orders():
    affected = [
        CarOrder(order_id="faulted", queue_no="F3", charge_mode=ChargeMode.FAST, requested_amount=10),
    ]
    piles = [
        PileQueueState(pile_id="F01", pile_type=ChargeMode.FAST, power=30),
    ]

    result = fault_priority_dispatch(affected, piles)

    assert [item.order_id for item in result] == ["faulted"]


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


def test_dispatch_never_assigns_beyond_pile_queue_capacity():
    orders = [
        CarOrder(order_id="o1", queue_no="F1", charge_mode=ChargeMode.FAST, requested_amount=10),
        CarOrder(order_id="o2", queue_no="F2", charge_mode=ChargeMode.FAST, requested_amount=10),
    ]
    piles = [
        PileQueueState(pile_id="F01", pile_type=ChargeMode.FAST, power=30, queue_capacity=1),
    ]

    result = basic_shortest_dispatch(orders, piles)

    assert [item.order_id for item in result] == ["o1"]
