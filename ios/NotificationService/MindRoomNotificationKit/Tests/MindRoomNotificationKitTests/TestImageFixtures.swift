import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum TestImageFixtures {
    static let samplePNG: Data = makeImage(width: 1, height: 1, type: UTType.png.identifier as CFString)
    static let sampleJPEG: Data = makeImage(width: 1, height: 1, type: UTType.jpeg.identifier as CFString)
    static let sampleGIF: Data = makeImage(width: 1, height: 1, type: UTType.gif.identifier as CFString)
    static let sampleWebP: Data = Data(base64Encoded: "UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=")!
    static let large512PNG: Data = makeImage(width: 512, height: 512, type: UTType.png.identifier as CFString)

    /// Minimal valid-header PNG claiming 5000x5000 pixel dimensions (decompression bomb header).
    static let bomb5000x5000PNG = Data([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x13, 0x88, 0x00, 0x00, 0x13, 0x88,
        0x08, 0x02, 0x00, 0x00, 0x00, 0xD2, 0xFA, 0x10,
        0x9C, 0x00, 0x00, 0x00, 0x0B, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9C, 0x63, 0x60, 0x40, 0x05, 0x00,
        0x00, 0x10, 0x00, 0x01, 0x39, 0xBD, 0x8F, 0x65,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
        0xAE, 0x42, 0x60, 0x82,
    ])

    static func imageDimensions(of data: Data) -> (width: Int, height: Int)? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let w = props[kCGImagePropertyPixelWidth] as? NSNumber,
              let h = props[kCGImagePropertyPixelHeight] as? NSNumber else {
            return nil
        }
        return (width: w.intValue, height: h.intValue)
    }

    private static func makeImage(width: Int, height: Int, type: CFString) -> Data {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
        let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: colorSpace,
            bitmapInfo: bitmapInfo.rawValue
        )!
        context.setFillColor(red: 0.2, green: 0.5, blue: 0.8, alpha: 1.0)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let cgImage = context.makeImage()!
        let output = NSMutableData()
        let destination = CGImageDestinationCreateWithData(output, type, 1, nil)!
        CGImageDestinationAddImage(destination, cgImage, nil)
        CGImageDestinationFinalize(destination)
        return output as Data
    }
}
