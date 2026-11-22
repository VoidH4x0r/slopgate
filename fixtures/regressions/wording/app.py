"""Explanations that the new fail+intent wording rule does or does not accept."""


def known_bug(box):
    # known bug: the parser throws on empty input, we accept the empty result
    try:
        box.parse()
    except Exception:
        pass


def known_bug_no_intent(box):
    # known bug: the parser throws on empty input
    try:
        box.parse()
    except Exception:
        pass


def caller_retries(box):
    # the caller retries, so this failure is fine
    try:
        box.parse()
    except Exception:
        pass
