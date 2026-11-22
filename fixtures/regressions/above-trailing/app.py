"""A trailing comment on the statement above `try` now decides the confidence."""


def f(ctx):
    value = ctx.read()  # returns an error string when the payload is invalid
    try:
        ctx.flush(value)
    except Exception:
        pass


def g(ctx):
    state = ctx.state()  # expected to be a dict
    try:
        ctx.flush(state)
    except Exception:
        pass
