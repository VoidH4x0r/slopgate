"""A helper whose name is not in the lexical assertion list."""


def run_suite(cases):
    for actual, expected in cases:
        assert actual == expected


def test_delegates_to_run_suite():
    run_suite([(compute(), 1)])


def compute():
    return 1
