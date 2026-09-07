namespace Ncr7198.PiBridge;

public sealed class BridgeOptions
{
    public string DevicePath { get; set; } = "/dev/ncr7198";
    public string ListenUrl { get; set; } = "http://0.0.0.0:80";
    public string Transport { get; set; } = "Auto";
    public string DevelopmentOutputDirectory { get; set; } = "printed-jobs";
    public int MaxOutstandingJobs { get; set; } = 3;
    public int PrintIdLifetimeHours { get; set; } = 24;

    // A real MVRK gear-checkout manifest routinely runs well past a short
    // retail receipt's length (17+ inches isn't unusual for a busy show's
    // full checkout list), so the fixed 8" cap this originally shipped with
    // rejected entirely legitimate prints, not just runaway ones. 30" is
    // comfortably above anything seen so far while still catching a truly
    // pathological request (a bug producing thousands of blank lines,
    // say). MVRK-Core's own ReceiptPayload.maxPaperLengthInches can
    // override this per print job if a specific manifest ever needs more,
    // without raising the default for everyone. Set this to 0 (or any
    // non-positive value) via Bridge__MaxPaperLengthInches to remove the
    // cap entirely instead.
    public double MaxPaperLengthInches { get; set; } = 30;
}
