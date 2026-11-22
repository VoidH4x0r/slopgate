"""Where can an explanatory comment live and still count?"""


def on_the_except_line_bare():
    try:
        do_work()
    except:  # already logged by the transport layer, ignore here
        pass


def on_the_except_line_typed():
    try:
        do_work()
    except OSError:  # the socket is already closed at shutdown
        pass


def inside_the_handler_bare():
    try:
        do_work()
    except:
        # already logged by the transport layer, ignore here
        pass


def cleanup_word_above(box):
    # the caller's cleanup will run afterwards, so we ignore the failure here
    try:
        box.flush()
    except Exception:
        pass
