from mempalace.searcher import search_memories

categories = ["it"]
paging = False
palace_path = "~/.mempalace/palace"   # override in settings.yml
wing = None

def request(query, params):
    params["mempalace_query"] = query
    return params

def response(resp):
    query = resp.search_params.get("mempalace_query", "")
    results = search_memories(query, palace_path=palace_path, wing=wing, top_k=10)
    return [
        {
            "url": f"mempalace://drawer/{r['id']}",
            "title": r.get("room", "Memory"),
            "content": r["text"][:400],
        }
        for r in results
    ]