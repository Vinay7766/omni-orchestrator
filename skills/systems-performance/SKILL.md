---
name: systems-performance
description: Reason about how code really runs on hardware - memory and caches, CPU, concurrency, I/O and the operating system - to find and fix slowness, high memory use, contention and race conditions. Use whenever code is slow, uses too much memory, stalls under load, behaves differently with more threads or cores, processes large data, or when choosing data structures, concurrency models or I/O strategies where speed or resources matter, even if the user only says "it's slow" or "it crashes under load". Insists on measuring before optimising.
---

# Systems Performance

Most performance problems come from a wrong assumption about where time or
memory goes. Developers guess, optimise the wrong thing, and add complexity
for no gain. This skill replaces guesses with measurements and a working
model of the machine: memory is slower than the CPU, the disk and network are
far slower than memory, and threads share more than they appear to.

## Rule zero: measure first, then change one thing

1. **Reproduce** the problem with a fixed, realistic input and write down the
   baseline number (time, memory, throughput, latency percentile).
2. **Profile** to find where the time or memory actually goes. Don't optimise
   anything that doesn't show up in the profile.
3. **Change one thing**, re-measure with the same input, and keep the change
   only if the number moves meaningfully.
4. **Report honestly**: measured numbers as measured, with the machine and
   input described; anything not measured is labelled an estimate.

Pick the profiler that fits the stack. Examples (not a complete list):
sampling CPU profilers such as `perf` (Linux), Instruments (macOS), Windows
Performance Analyzer or Visual Studio's profiler, `py-spy` (Python), `pprof`
(Go), async-profiler (JVM), browser DevTools (web); memory profilers and heap
snapshots in the same tools; `strace`/`dtrace`/Process Monitor for system
calls and I/O.

## Step 1: Classify the bottleneck

Find out which resource is the limit before choosing a fix:

| Symptom | Likely bound | How to confirm |
|---------|--------------|----------------|
| One core at 100%, others idle | CPU, single-threaded | CPU profile shows a hot function |
| All cores busy, throughput flat as threads increase | Contention or memory bandwidth | Lock profiling; throughput vs thread count |
| CPU low, slow anyway | I/O or waiting (disk, network, locks, sleeps) | Wall-clock vs CPU time; I/O and syscall tracing |
| Memory grows steadily over time | Leak or unbounded cache/queue | Heap snapshots compared over time |
| Fast on small input, collapses on large | Algorithmic complexity or cache misses | Time at 1x, 10x, 100x input |
| Slow only at certain times or loads | Garbage collection, contention, noisy neighbours | GC logs; latency percentiles over time |

## Step 2: Know the order of magnitude of each operation

Approximate figures for current hardware (they vary by machine; use them for
reasoning, never quote them as measurements):

| Operation | Roughly |
|-----------|---------|
| CPU instruction / L1 cache hit | about 1 nanosecond |
| Main memory (RAM) access on a cache miss | about 100 nanoseconds |
| SSD random read | tens of microseconds |
| Network round trip within a data centre | about half a millisecond |
| Network round trip across continents | 100 milliseconds or more |

What follows from this:

- **A loop doing a network or database call per item is almost always the
  problem**, before any CPU work. Batch, cache or move the work closer.
- **Memory access patterns matter as much as instruction counts.** Walking an
  array in order is fast; chasing pointers through scattered objects causes
  cache misses that can cost far more than the arithmetic.
- **Big-O decides behaviour at scale; constants and memory layout decide it at
  realistic sizes.** An O(n log n) algorithm with poor locality can lose to a
  simpler one for the sizes you actually have. Measure both at real sizes.

## Step 3: Memory

- **Allocation is not free.** Allocating many small short-lived objects in a
  hot loop costs time and creates garbage-collection or fragmentation
  pressure. Reuse buffers, preallocate when the size is known, prefer
  contiguous arrays over linked structures in hot paths.
- **Data layout:** keep data that is used together stored together. Smaller
  types and fewer pointers mean more useful data per cache line.
- **Unbounded growth is a bug.** Every cache, queue, buffer and map that grows
  with input needs a limit and an eviction or back-pressure rule.
- **Leaks in managed languages** usually mean something still holds a
  reference: listeners not removed, caches without eviction, closures
  capturing large objects, global collections. Compare heap snapshots to see
  what keeps growing and what retains it.
- **Stream large data** instead of loading it all into memory when only one
  pass is needed.

## Step 4: Concurrency

Concurrency adds speed only when work can truly run in parallel and the
coordination costs less than it saves.

- **Choose the model for the workload:**
  - CPU-heavy work: parallel threads or processes, about one per core.
  - I/O-heavy work (network, disk): asynchronous I/O or a modest pool;
    hundreds of blocked threads waste memory and scheduling time.
  - Mixed: keep CPU work off the I/O event loop so it doesn't block it.
  - Check the runtime's own limits (for example, a global interpreter lock
    means threads won't parallelise CPU work in some runtimes; use processes).
- **Shared mutable state is the source of races.** Prefer passing messages or
  immutable data; when sharing is unavoidable, protect every access to the
  same data with the same lock, and keep critical sections short.
- **Contention:** one hot lock or one shared counter can serialise every
  thread. Symptoms: throughput stops rising, or falls, as threads are added.
  Fixes: shard the data, use per-thread state merged at the end, or lock-free
  structures from a well-tested library (don't write your own).
- **False sharing:** independent variables written by different threads but
  stored in the same cache line slow each other down. Pad or separate them
  when profiling shows it.
- **Deadlocks:** always acquire multiple locks in one consistent global order,
  and never hold a lock while calling unknown code or waiting on I/O.
- **Test concurrency deliberately:** run with more threads than cores, use
  race detectors or thread sanitizers where the platform has them, and add
  tests that hammer shared state. A race that passes once proves nothing.

## Step 5: I/O and the operating system

- **Batch small operations**: one large read or write beats thousands of tiny
  ones; one query returning 1,000 rows beats 1,000 queries.
- **Buffer file I/O**, and avoid flushing or syncing to disk per record unless
  durability requires it (and say so when it does).
- **Set timeouts on every network call** and decide what happens on failure;
  a missing timeout turns a slow dependency into a hung service.
- **Use connection pools** for databases and HTTP clients rather than opening
  a connection per request.
- **Watch resource limits**: open file handles, sockets, threads and process
  memory limits all fail in confusing ways when exhausted.

## Step 6: Verify and report

Before calling the work done:

- [ ] Baseline and result measured with the same input on the same machine
- [ ] The profile after the change shows the bottleneck moved or shrank
- [ ] Tests still pass, including concurrency tests where relevant
- [ ] Memory checked under sustained load, not only a single run
- [ ] The report states what was measured, how, and on what hardware; any
      unmeasured figure is labelled an estimate
- [ ] Added complexity is justified by the measured gain; otherwise revert it

## Credits

Written for OmniOrchestrator (Apache-2.0). It summarises widely taught
systems-performance practice (measure-first methodology, memory hierarchy,
concurrency hazards); latency figures are order-of-magnitude approximations,
not benchmarks. No text is copied from other sources.
