using Ncr7198.PiBridge;
using Xunit;

namespace Ncr7198.PiBridge.Tests;

public sealed class LogoRendererTests
{
    [Fact]
    public void ToBmpDataUrl_RoundTripsExactPixels()
    {
        // 5x3 — deliberately not a multiple of 8 or 32, so both the
        // per-byte bit packing and the 4-byte row padding this hand-rolls
        // (see RenderedLogo.ToBmpDataUrl) actually get exercised, not just
        // the trivial byte-aligned case.
        const int width = 5, height = 3;
        byte[] pixels =
        [
            1, 0, 1, 0, 1,
            0, 1, 0, 1, 0,
            1, 1, 1, 0, 0,
        ];
        var logo = new RenderedLogo(pixels, width, height);

        var dataUrl = logo.ToBmpDataUrl();
        Assert.StartsWith("data:image/bmp;base64,", dataUrl);
        var bytes = Convert.FromBase64String(dataUrl["data:image/bmp;base64,".Length..]);

        Assert.Equal((byte)'B', bytes[0]);
        Assert.Equal((byte)'M', bytes[1]);
        var offBits = BitConverter.ToInt32(bytes, 10);

        Assert.Equal(width, BitConverter.ToInt32(bytes, 18));
        Assert.Equal(height, BitConverter.ToInt32(bytes, 22));
        Assert.Equal((short)1, BitConverter.ToInt16(bytes, 28)); // bits per pixel

        // Decode it back out by hand — bottom-up, row-padded, MSB-first
        // bit packing — and confirm it's the exact same pixels that went
        // in, not just "some bytes came out."
        var rowBytes = ((width + 31) / 32) * 4;
        var decoded = new byte[width * height];
        for (var y = 0; y < height; y++)
        {
            var fileRow = height - 1 - y; // file row 0 is the image's bottom row
            var rowStart = offBits + fileRow * rowBytes;
            for (var x = 0; x < width; x++)
            {
                var bit = (bytes[rowStart + x / 8] >> (7 - x % 8)) & 1;
                decoded[y * width + x] = (byte)bit;
            }
        }

        Assert.Equal(pixels, decoded);
    }

    [Fact]
    public void ToBmpDataUrl_HandlesSinglePixel()
    {
        var logo = new RenderedLogo([1], 1, 1);
        var dataUrl = logo.ToBmpDataUrl();
        Assert.StartsWith("data:image/bmp;base64,", dataUrl);
        // Just confirming this doesn't throw on the smallest possible
        // image — the real interesting coverage is the round-trip test
        // above.
    }
}
