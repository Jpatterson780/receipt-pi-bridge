namespace Ncr7198.PiBridge;

// The MVRK print dispatcher (MVRK-Core/pi-print-dispatcher) runs alongside the
// bridge on the same Pi and only ever calls outward, so the bridge can't ask it
// anything. Instead the dispatcher POSTs its current polling cadence here at
// startup, on every idle<->active switch, and on a periodic heartbeat. The
// bridge just remembers the last report so /api/health and the web page can
// show whether the dispatcher is running and how fast it is currently polling.

/// <summary>One status report from the dispatcher. All intervals are milliseconds.</summary>
public sealed record DispatcherReport
{
    public string Mode { get; init; } = "unknown";
    public int IntervalMs { get; init; }
    public int IdleIntervalMs { get; init; }
    public int ActiveIntervalMs { get; init; }
    public long ActiveWindowMs { get; init; }
}

/// <summary>The last report plus how long ago it arrived and whether that is too long.</summary>
public sealed record DispatcherSnapshot(DispatcherReport Report, TimeSpan Age, bool Stale);

public sealed class DispatcherStatus
{
    // The dispatcher heartbeats every 60s; allow two misses before calling it stale.
    public static readonly TimeSpan StaleAfter = TimeSpan.FromSeconds(150);

    private readonly object _gate = new();
    private DispatcherReport? _report;
    private DateTimeOffset _receivedAt;

    public void Record(DispatcherReport report)
    {
        lock (_gate)
        {
            _report = report;
            _receivedAt = DateTimeOffset.UtcNow;
        }
    }

    public DispatcherSnapshot? Snapshot()
    {
        lock (_gate)
        {
            if (_report is null) return null;
            var age = DateTimeOffset.UtcNow - _receivedAt;
            return new DispatcherSnapshot(_report, age, age > StaleAfter);
        }
    }
}
