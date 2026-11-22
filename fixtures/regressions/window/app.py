"""Placement probes for the swallowed-exception comment window."""


def trailing_comment_on_try_body(ctx):
    try:
        ctx.flush()  # flush is best effort
    except Exception:
        pass


def comment_between_try_and_except(ctx):
    try:
        ctx.flush()
    # the buffer may already be closed by the caller
    except Exception:
        pass


def comment_above_the_try(ctx):
    # any errors here, just abort; impossible to guarantee the value
    try:
        ctx.flush()
    except Exception:
        pass


def second_handler_with_comment(ctx):
    try:
        ctx.flush()
    except ValueError:
        raise
    # this one is a known platform quirk
    except Exception:
        pass
