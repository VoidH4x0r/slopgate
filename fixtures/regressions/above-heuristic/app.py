"""How the above-try comment heuristic behaves on different comment texts."""


def a_clear_explanation(ctx):
    # any errors here, just abort; impossible to guarantee the value
    try:
        ctx.flush()
    except Exception:
        pass


def b_clear_explanation(ctx):
    # the caller already logs this, so we ignore it
    try:
        ctx.flush()
    except Exception:
        pass


def c_genuine_but_no_keyword(ctx):
    # harmless on Windows; the OS closes the handle for us
    try:
        ctx.flush()
    except Exception:
        pass


def d_unrelated_error_mention(ctx):
    # returns an error string when the payload is invalid
    try:
        ctx.flush()
        ctx.record_error_state()
    except Exception:
        pass


def e_unrelated_expected_mention(ctx):
    # the expected format is validated by the schema
    try:
        ctx.flush()
    except Exception:
        pass
