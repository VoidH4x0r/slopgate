"""A legitimate explanation that happens to contain the word "cleanup"."""


def with_cleanup_word(ctx):
    try:
        ctx.flush()
    # cleanup already happened in the caller, so ignoring the error here is fine
    except Exception:
        pass


def with_cleanup_inline(ctx):
    try:
        ctx.flush()
    except Exception:  # cleanup is the caller's job; the failure is harmless
        pass


def type_only_after_return():
    """Type declarations are erased, they are not dead runtime code."""


def ts_style() -> None:
    pass
