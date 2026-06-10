#import <AppKit/AppKit.h>
#import <CoreImage/CoreImage.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 3) {
      fprintf(stderr, "Usage: generate-pi-qr <content> <output>\n");
      return 1;
    }

    NSString *content = [NSString stringWithUTF8String:argv[1]];
    NSString *output = [NSString stringWithUTF8String:argv[2]];
    NSData *data = [content dataUsingEncoding:NSUTF8StringEncoding];
    CIFilter *filter = [CIFilter filterWithName:@"CIQRCodeGenerator"];
    [filter setValue:data forKey:@"inputMessage"];
    [filter setValue:@"H" forKey:@"inputCorrectionLevel"];

    CIImage *image = filter.outputImage;
    CIContext *context = [CIContext contextWithOptions:nil];
    CGImageRef cgImage = [context createCGImage:image fromRect:image.extent];
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithCGImage:cgImage];
    NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    CGImageRelease(cgImage);

    if (![png writeToFile:output atomically:YES]) {
      fprintf(stderr, "Unable to write QR code\n");
      return 1;
    }
  }

  return 0;
}
