import pytest


# DECOY: pytest fixtures, the builtin input() "prompt", and an f-string that is
# NOT a system/prompt assignment must not register as AI surfaces.
@pytest.fixture
def subject():
    return object()


def test_answer(subject):
    name = input("your name> ")
    print(f"hello {name}")
    assert name is not None
