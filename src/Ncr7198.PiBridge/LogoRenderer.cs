using StbImageSharp;

namespace Ncr7198.PiBridge;

public sealed record RenderedLogo(byte[] Pixels, int Width, int Height)
{
    public int RasterBands => (Height + 23) / 24;

    // A viewable image of exactly the pixels NcrReceipt.Logo() packs into
    // the printer's raster bytes — not a re-derived approximation, the
    // literal same 0/1 array — so /api/preview can show what the logo will
    // actually look like once dithered to 1-bit, instead of the "[LOGO:
    // WxH]" placeholder this used to be the only option. BMP rather than
    // PNG specifically because a 1bpp BMP needs no compression or CRC
    // checksums to hand-roll, just a header and padded row data, and
    // every browser renders a data:image/bmp <img> src fine.
    public string ToBmpDataUrl()
    {
        var rowBytes = ((Width + 31) / 32) * 4; // 1bpp rows padded to a 4-byte boundary
        var pixelDataSize = rowBytes * Height;
        var fileSize = 14 + 40 + 8 + pixelDataSize;

        using var stream = new MemoryStream(fileSize);
        using var writer = new BinaryWriter(stream);

        // BITMAPFILEHEADER (14 bytes)
        writer.Write((byte)'B');
        writer.Write((byte)'M');
        writer.Write(fileSize);
        writer.Write((short)0);
        writer.Write((short)0);
        writer.Write(14 + 40 + 8); // pixel data offset

        // BITMAPINFOHEADER (40 bytes)
        writer.Write(40);
        writer.Write(Width);
        writer.Write(Height); // positive => stored bottom-up, standard for BMP
        writer.Write((short)1); // planes
        writer.Write((short)1); // bits per pixel
        writer.Write(0); // no compression
        writer.Write(pixelDataSize);
        writer.Write(2835); // ~72 DPI in pixels/meter; cosmetic only
        writer.Write(2835);
        writer.Write(2); // palette colors used
        writer.Write(0); // important colors (0 = all)

        // 2-color palette (BGRA): index 0 white, index 1 black
        writer.Write(new byte[] { 0xFF, 0xFF, 0xFF, 0x00 });
        writer.Write(new byte[] { 0x00, 0x00, 0x00, 0x00 });

        var row = new byte[rowBytes];
        for (var y = Height - 1; y >= 0; y--) // bottom-up
        {
            Array.Clear(row);
            for (var x = 0; x < Width; x++)
            {
                if (Pixels[y * Width + x] != 0) row[x / 8] |= (byte)(0x80 >> (x % 8));
            }
            writer.Write(row);
        }

        writer.Flush();
        return $"data:image/bmp;base64,{Convert.ToBase64String(stream.ToArray())}";
    }
}

public sealed class LogoRenderer
{
    public const int MaximumWidth = 576;
    public const int MaximumSourceBytes = 8 * 1024 * 1024;
    public const int MaximumSourceDimension = 8192;

    public RenderedLogo? Render(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;

        try
        {
            var encoded = ExtractBase64(value.Trim());
            if (encoded.Any(char.IsWhiteSpace))
                throw new PrintValidationException("logo Base64 cannot contain whitespace.");
            if (encoded.Length > ((MaximumSourceBytes + 2) / 3) * 4)
                throw new PrintValidationException($"logo image exceeds the {MaximumSourceBytes / (1024 * 1024)} MB decoded limit.");

            byte[] source;
            try { source = Convert.FromBase64String(encoded); }
            catch (FormatException) { throw new PrintValidationException("logo must contain valid Base64 image data."); }
            if (source.Length > MaximumSourceBytes)
                throw new PrintValidationException($"logo image exceeds the {MaximumSourceBytes / (1024 * 1024)} MB decoded limit.");

            using var stream = new MemoryStream(source, writable: false);
            var image = ImageResult.FromStream(stream, ColorComponents.RedGreenBlueAlpha);
            if (image.Width > MaximumSourceDimension || image.Height > MaximumSourceDimension)
                throw new PrintValidationException($"logo dimensions cannot exceed {MaximumSourceDimension} pixels on either side.");

            var width = Math.Min(image.Width, MaximumWidth);
            var height = image.Width > MaximumWidth
                ? Math.Max(1, (int)Math.Round(image.Height * (MaximumWidth / (double)image.Width)))
                : image.Height;
            var pixels = new byte[checked(width * height)];
            for (var y = 0; y < height; y++)
            {
                var sourceY = height == image.Height ? y : Math.Min(image.Height - 1, (int)((y + 0.5) * image.Height / height));
                for (var x = 0; x < width; x++)
                {
                    var sourceX = width == image.Width ? x : Math.Min(image.Width - 1, (int)((x + 0.5) * image.Width / width));
                    var offset = (sourceY * image.Width + sourceX) * 4;
                    var alpha = image.Data[offset + 3];
                    var red = (image.Data[offset] * alpha + 255 * (255 - alpha)) / 255;
                    var green = (image.Data[offset + 1] * alpha + 255 * (255 - alpha)) / 255;
                    var blue = (image.Data[offset + 2] * alpha + 255 * (255 - alpha)) / 255;
                    var luminance = (299 * red + 587 * green + 114 * blue) / 1000;
                    pixels[y * width + x] = luminance < 160 ? (byte)1 : (byte)0;
                }
            }

            return new RenderedLogo(pixels, width, height);
        }
        catch (PrintValidationException) { throw; }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            throw new PrintValidationException($"logo could not be read as an image: {exception.Message}");
        }
    }

    private static string ExtractBase64(string value)
    {
        if (!value.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return value;

        var comma = value.IndexOf(',');
        if (comma < 0 || !value[..comma].StartsWith("data:image/", StringComparison.OrdinalIgnoreCase) ||
            !value[..comma].EndsWith(";base64", StringComparison.OrdinalIgnoreCase))
            throw new PrintValidationException("logo data URL must be a Base64-encoded image.");
        return value[(comma + 1)..];
    }
}
