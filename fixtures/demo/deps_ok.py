import requests_v2


def get_user(user_id):
    data = requests_v2.get(f"/users/{user_id}")
    if data:
        return data.json()
    return None
