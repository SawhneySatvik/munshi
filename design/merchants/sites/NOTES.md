# Merchant sites: two directions each (MS-16a)

Open any `index.html` straight from disk; each direction is plain HTML, CSS and drawn SVG with Google Fonts. `?lang=hi`
opens a page in Hindi (the EN / हिंदी toggle does the same and is remembered); `?ribbon=off` shows the merchant's clean
variant without the "Sample data" ribbon. Shots are in `../shots/` at 390×844 and 1280×800. They include the Hindi,
product, packages and booking pages, the booking error and sent states, and a full-page desktop shot per direction with
the footer. There are also two clean variants with the ribbon off: Suit A with the bag reprinted green for "Stitched",
and Salon B. Suit B's shelf on phone has its own shot too.

**Shared by all four.** Every page uses the same slots, which the developer kit will fill: `#ribbon`, `#top` (name,
navigation, language, action), `#hero`, `#offers`, `#index`, `#listing`, `#feature`, the detail page (`product.html`,
`packages.html`, `booking.html`) and `#foot` ("Prices from the shop's books", the privacy policy, "Built with Munshi"). One
script, `kit.js`, runs all four directions. It handles the language toggle, the ribbon variant, the WhatsApp prefill, the
kind and budget filters, the colour and size chips, the salon's service tray and the booking request. A re-skin for the
real merchant only changes the tokens at the top of each `site.css`, plus the photos and the name.

**Data, labels and copy.**
- The names are the placeholders "Suit shop (name pending)" and "Salon (name pending)".
- Every price is illustrative but plausible for Delhi, written in Indian grouping, and labelled "Sample data".
- The product page shows "Includes 5% GST (₹107.14)" on a ₹2,250 piece.
- The 18% rate for apparel pieces above ₹2,500 is not printed anywhere. The research marks that notification as unread,
  so the real build must pick the rate per piece.
- Salon rates include 5% GST.
- "Ask on WhatsApp" opens `wa.me` with a prefilled message and no number, until the shop's number arrives.

**Booking and consent.** The booking form validates its fields and then shows what would be sent, with "Mock-up: nothing
was sent." The WhatsApp updates box is separate, unticked and optional. I read it as consent for reminders and festive
offers, because the campaigns will need that consent; the booking request goes through whether or not it is ticked. If
the founder meant updates about the booking itself, the label is one string to change.

**Art.** The suits, dupattas, folded sets, tresses and the bolster are drawn in SVG and recoloured by CSS variables. Each
drawing is captioned as standing in for the shop's photo.

**A · The carry bag (suit shop).** The site is the shop's printed carry bag. Rope handles and folded suits in tissue
peek out of the top edge. Below them the shop's name is set huge in Rozha One on a flat rani-pink ground, and "what we
sell" is printed on the bag as four working rows: unstitched, semi-stitched, stitched and dupattas, each with its "from"
price. Choosing a kind reprints the whole bag in that kind's colour: rani pink, saffron, parrot green or peacock. The
offers run along a gold-foil band. New arrivals sit "inside the bag" on white, with a 2×2 feature piece on desktop, and
shop-by-budget is set in large type below them. The product page is the suit on a clean card with a gold offer sticker.
Its colour chips recolour the drawing, its size chips include a sold-out 44, the price carries a GST line, and the
WhatsApp button shows its message before you send it. This direction is airy, festive and very Delhi, and strongest as
a lookbook. Its risk is that a flat pink ground with a fat display face is loud; it depends on the merchant's real
colours fitting a bag.

**B · The counter (suit shop).** The site is the inside of the shop: a wall of folded suit pieces seen edge-on, sorted
into four compartments. Each piece is a band of its own print (bandhani dots, leheriya stripes, block print, checks) with
a kraft swing tag carrying its price in marker (Kalam). Tapping a band unfolds the piece on the white gaddi, beside a
striped bolster, with its drawing, fabric and two actions. The offers hang as tags on a red thread. Compartment tabs and
budget chips filter the wall. On desktop the wall comes first, with all nine pieces and every price on the first screen,
and the gaddi strip sits below it; on phone the featured piece comes first, then the shelves. The ground is deep
aubergine, with condensed Anek Devanagari for the shop's voice. This direction is dense and fast to scan, and closest
to how a customer actually shops a suit counter. Its risk is that a dark ground is less festive than A, and that the
marker type on the tags is a strong flavour.

**A · The shade chart (salon).** The menu is a colourist's hair shade chart. Each service is a tress clamped under a
rail, with its price, name and time printed above it, and each tress is as long as the service takes, drawn to scale. A
10-minute threading is a stub and a 3-hour bridal make-up is the longest lock on the chart. Tapping a tress pulls it down
with a copper tick and adds it to a tray at the bottom, which shows the count, the total time and the total price and
links to the booking request. The cover is henna copper (the Karva Chauth mehendi colour), the chart is white, the type
is Biryani, and on desktop index tabs sit down the side. A legend in the Hair heading shows the scale. Packages draw "you pay"
against "you get" as two bars, with the gain in copper, plus an example of the balance printed on a bill. On desktop the
booking page keeps the request so far (services, total time, total price) in a column beside the form. This direction is visual and memorable, and the length
encoding is honest information, not decoration. Its risk is that tresses for skin and nail services are a stretch of
the metaphor.

**B · The rate card (salon).** The site is the laminated rate card stuck beside the mirror, printed at the market print
shop. It has a print-blue header band with the name in Gajraj One, offer stickers in orange, yellow and white, a black
jump bar, and black section bars over rows with dotted leaders to the time and the rate (Khand). The card sits on a
tiled wall. Tapping a row marks it with a yellow highlighter and a drawn tick and adds it to the booking slip at the
bottom. Bridal is a boxed section in blue. On desktop the card reads in three columns with the stickers beside the
heading: at 1280×800 the first screen shows the Hair, Skin and Hands and feet rates, and Grooming and Bridal are one
short scroll down. The booking page keeps
the request so far in a column beside the form. Packages and the booking form are set as more of the same printed card. This direction is the densest and most
familiar: anyone who has sat in a Delhi salon chair can read it instantly. Its risk is that it is the expected look, and
its strength comes from type and print colour rather than imagery.

**Not done here.**
- Nothing is wired to the books.
- No real merchant names, logos, photos or numbers are used.
- No stylist calendar or slots: the booking is a request.
- No icon packs, stock photos or generated images.
