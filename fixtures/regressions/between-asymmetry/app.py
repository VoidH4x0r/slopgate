"""Asymmetry: the between-try-and-except window does not apply the keyword filter."""


def unrelated_comment_between(ctx):
    try:
        ctx.flush()
    # TODO: this block is long, refactor it in the next sprint
    except Exception:
        pass
