from openai import OpenAI

client = OpenAI()


def answer(query, role):
    # f-string system prompt built from an untrusted role
    system_prompt = f"You are a {role} assistant. Be concise."
    return client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "system", "content": system_prompt}],
    )


def embed(q):
    return client.embeddings.create(input=q, model="text-embedding-3-small")


@tool
def get_weather(city):
    return {"city": city}


def current(req):
    return get_current_user(req)
