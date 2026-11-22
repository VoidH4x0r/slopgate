"""Common swallowed-exception shapes that should all be high confidence."""


def bare_binding():
    try:
        work()
    except Exception as error:
        pass


def bare_no_binding():
    try:
        work()
    except Exception:
        pass


def tuple_binding():
    try:
        work()
    except (Exception,) as error:
        pass


def base_exception_binding():
    try:
        work()
    except BaseException as error:
        pass


def work():
    return 1
