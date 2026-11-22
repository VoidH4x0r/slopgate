"""Python side of delegated assertions: a helper does the asserting."""


def verify(result, expected):
    assert result == expected


def test_delegates_to_a_helper():
    verify(compute(), 1)


def test_has_no_assertion_at_all():
    compute()


def compute():
    return 1
