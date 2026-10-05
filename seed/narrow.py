import os, sys
sys.argv = ["x", "--go"]
os.environ.setdefault("MAX_CALLS", "600")
sys.path.insert(0, ".")
import sweep_providers as sp
# The five people ring about when something has gone wrong, which is when a
# marketplace gets used. Everything else can wait for the directory to prove out.
sp.SERVICES = {
    "plumbing":   ["plumber", "plumbing service"],
    "electrical": ["electrician", "electrical contractor"],
    "ac":         ["ac repair service"],
    "cleaning":   ["house cleaning service"],
    "movers":     ["packers and movers"],
}
sp.main()
