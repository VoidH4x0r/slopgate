def build_payload_again(user):
    payload = {}
    payload["id"] = user.id
    payload["name"] = user.name
    if not user.active:
        payload["active"] = False
    return payload
