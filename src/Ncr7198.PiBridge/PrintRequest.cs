namespace Ncr7198.PiBridge;

public sealed record PrintRequest
{
    public string? PrintId { get; init; }
    public int PrePrintLines { get; init; }
    public string[]? Lines { get; init; }
    public string? Content { get; init; }
    public int PostPrintLines { get; init; } = 4;
    public string Wrap { get; init; } = "none";
    public bool Compressed { get; init; }
    public bool Cut { get; init; } = true;
    public int Copies { get; init; } = 1;
    public string? Logo { get; init; }
    public string LogoPosition { get; init; } = "top";
    // Same shape as Logo/LogoPosition, and rendered through the same
    // LogoRenderer/NcrReceipt.Logo() raster path — a barcode is just
    // another 1-bit image as far as the printer is concerned. Defaults to
    // "bottom" (unlike Logo's "top") since the typical use — a parent
    // case's tag scannable off a child asset's own tag — reads best right
    // above the cut, near the rest of that item's details, rather than
    // competing with a brand logo at the very top.
    public string? Barcode { get; init; }
    public string BarcodePosition { get; init; } = "bottom";
    // Per-request override of BridgeOptions.MaxPaperLengthInches — null
    // (the normal case) just uses the server's configured default. Same
    // "<= 0 means no cap" semantics as the server setting, for the rare
    // print that's a deliberately long, known-in-advance exception rather
    // than something that should permanently raise the default for
    // everyone.
    public double? MaxPaperLengthInches { get; init; }
}

public sealed record RenderedPrintJob(byte[] Bytes, string[] Preview, string Hash, string? PrintId,
    int Copies, bool RequestedCut, bool EffectiveCut, bool CutForced, string? LogoPreviewDataUrl = null,
    string? BarcodePreviewDataUrl = null);

public sealed record PrintResult(string Status, string? PrintId, int Copies,
    bool RequestedCut, bool EffectiveCut, bool CutForced, int Bytes);

public sealed record PrintSubmission(Task<PrintResult> Result, bool IsDuplicate);

public sealed class PrintValidationException(string message) : Exception(message);
public sealed class PrintQueueFullException() : Exception("The print queue is full. Try again shortly.");
public sealed class PrintIdConflictException(string printId)
    : Exception($"printId '{printId}' was already used for a different print job.");
