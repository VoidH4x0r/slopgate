"""Noise-comment and inline-comment interplay after the 0.1.5 changes."""


def bare_except_with_todo():
    try:
        do_work()
    except:  # TODO this needs a proper handler
        pass


def bare_except_with_reason():
    try:
        do_work()
    except:  # already logged by the transport layer
        pass


def refactor_comment_between(box):
    try:
        box.flush()
    # refactor this later, the block is getting long
    except Exception:
        pass
