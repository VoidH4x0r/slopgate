"""Future-work words versus genuine explanations."""

import logging


def retried_later(box):
    try:
        box.flush()
    # the caller retries later, so we ignore this error here
    except Exception:
        pass


def cleanup_later(box):
    try:
        box.flush()
    # cleanup happens later in the caller, so ignoring this failure is fine
    except Exception:
        pass


def refactor_later(box):
    try:
        box.flush()
    # refactor this later, the block is getting long
    except Exception:
        pass


def todo_handler(box):
    try:
        box.flush()
    except:  # TODO: add a proper handler
        logging.error("flush failed")
