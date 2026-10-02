"""The library parser runs in a worker; progress is reported by our job system."""
class Quiet:
    def __getattr__(self, name):
        return lambda *args, **kwargs: self
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass
st = Quiet()
