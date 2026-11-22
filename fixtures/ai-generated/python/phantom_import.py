import ai_sdk


def notify(user_id):
    return ai_sdk.send(user_id)
