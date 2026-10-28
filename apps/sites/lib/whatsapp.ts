/** A WhatsApp click-to-chat link with the message typed in. With no number yet, WhatsApp asks whom to send it to. */
export function whatsappLink(number: string | null, text: string): string {
  return `https://wa.me/${number ?? ""}?text=${encodeURIComponent(text)}`;
}
