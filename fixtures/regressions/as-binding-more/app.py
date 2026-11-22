"""More binding/tuple variants for the swallowed-exception classifier."""


def ellipsis_body():
    try:
        work()
    except Exception as error:
        ...


def except_star():
    try:
        work()
    except* Exception as error:
        pass


def tuple_specific():
    try:
        work()
    except (ValueError, RuntimeError) as error:
        pass


def tuple_broad_mixed():
    try:
        work()
    except (ValueError, Exception) as error:
        pass


def work():
    return 1
