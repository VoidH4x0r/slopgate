def build_payload(user):
    payload = {}
    payload["id"] = user.id
    payload["name"] = user.name
    if not user.active:
        payload["active"] = False
    return payload
