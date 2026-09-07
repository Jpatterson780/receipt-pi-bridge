using Ncr7198.PiBridge;
using Xunit;

namespace Ncr7198.PiBridge.Tests;

public sealed class DispatcherStatusTests
{
    private static DispatcherReport SampleReport() => new()
    {
        Mode = "idle",
        IntervalMs = 10000,
        IdleIntervalMs = 10000,
        ActiveIntervalMs = 3000,
        ActiveWindowMs = 10800000
    };

    [Fact]
    public void Snapshot_IsNullUntilTheDispatcherReports()
    {
        Assert.Null(new DispatcherStatus().Snapshot());
    }

    [Fact]
    public void Snapshot_ReturnsTheLastReportAsFreshWhenJustReceived()
    {
        var status = new DispatcherStatus();
        status.Record(SampleReport());

        var snapshot = status.Snapshot();

        Assert.NotNull(snapshot);
        Assert.Equal("idle", snapshot!.Report.Mode);
        Assert.Equal(3000, snapshot.Report.ActiveIntervalMs);
        Assert.False(snapshot.Stale);
        Assert.True(snapshot.Age < DispatcherStatus.StaleAfter);
    }

    [Fact]
    public void Record_ReplacesTheEarlierReport()
    {
        var status = new DispatcherStatus();
        status.Record(SampleReport());
        status.Record(SampleReport() with { Mode = "active", IntervalMs = 3000 });

        var snapshot = status.Snapshot();

        Assert.Equal("active", snapshot!.Report.Mode);
        Assert.Equal(3000, snapshot.Report.IntervalMs);
    }

    [Fact]
    public void StaleAfter_ToleratesTwoMissedSixtySecondHeartbeats()
    {
        Assert.True(DispatcherStatus.StaleAfter >= TimeSpan.FromSeconds(120));
    }
}
