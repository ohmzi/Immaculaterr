import requests

def search_movie(api_key, title):
    r = requests.get(
        "https://api.themoviedb.org/3/search/movie",
        params={"api_key": api_key, "query": title},
        timeout=10,
    )
    r.raise_for_status()
    return r.json().get("results", [])

def get_movie(api_key, tmdb_id):
    r = requests.get(
        f"https://api.themoviedb.org/3/movie/{tmdb_id}",
        params={"api_key": api_key},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def search_tv(api_key, title):
    r = requests.get(
        "https://api.themoviedb.org/3/search/tv",
        params={"api_key": api_key, "query": title},
        timeout=10,
    )
    r.raise_for_status()
    return r.json().get("results", [])


def get_tv(api_key, tmdb_id):
    r = requests.get(
        f"https://api.themoviedb.org/3/tv/{tmdb_id}",
        params={"api_key": api_key},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()
