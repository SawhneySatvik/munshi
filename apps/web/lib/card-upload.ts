// A campaign card's upload, in the browser: the picture is scaled down before it is sent, its longest
// side at most 1440 pixels (Instagram's widest), and re-encoded as a JPEG through a canvas, which drops its metadata;
// the image is decoded upright (createImageBitmap applies the photo's orientation). A deployed function takes a request
// body of at most 4.5 MB, so the server refuses an upload over 4 MB (lib/server/card-image.ts), and this refuses it
// first, with the reason on the screen, instead of a request the host would cut off.

/** The largest card upload the server takes, in bytes. */
export const MAX_CARD_UPLOAD = 4 * 1024 * 1024;
const LONGEST = 1440;

/**
 * The picture as it is sent: scaled to fit 1440 pixels and made a JPEG (transparency on white), or the file itself
 * where the browser cannot decode it (the server then says why). Null when what would be sent is still over the cap.
 */
export async function cardForUpload(file: File): Promise<File | null> {
  let out: File = file;
  try {
    const image = await createImageBitmap(file);
    const scale = Math.min(1, LONGEST / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const g = canvas.getContext("2d");
    if (g) {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85));
      if (blob) out = new File([blob], "card.jpg", { type: "image/jpeg" });
    }
    image.close();
  } catch {
    // Not decodable here: sent as it is, and the server's own check refuses it with its reason.
  }
  return out.size > MAX_CARD_UPLOAD ? null : out;
}
