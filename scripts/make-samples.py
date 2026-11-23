"""Generate synthetic PDF invoices, including two image-only scans."""

from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageEnhance, ImageFilter
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
import pypdfium2

OUTPUT = Path(__file__).resolve().parents[1] / 'public' / 'samples'
OUTPUT.mkdir(parents=True, exist_ok=True)

VENDORS = {
    'Northstar Office Supply LLC': ('#214F66', '143 Birch Court, Portland, OR 97204', 'billing@northstar.example'),
    'Harborline Packaging Inc': ('#315755', '58 Tideway Avenue, Edison, NJ 08817', 'billing@harborline.example'),
    'Cedarline Facilities LLC': ('#68473D', '721 Hemlock Road, Madison, WI 53703', 'billing@cedarline.example'),
}


def create_invoice(path, vendor, number, date, po, lines, tax, printed_total=None):
    accent, address, email = VENDORS[vendor]
    accent = HexColor(accent)
    ink = HexColor('#17232E')
    doc = Canvas(str(path), pagesize=letter)
    doc.setTitle(f'Invoice {number} - synthetic sample')
    doc.setFillColor(accent)
    doc.rect(0, 780, 612, 12, fill=True, stroke=False)
    doc.setFont('Helvetica-Bold', 22)
    doc.drawString(48, 733, vendor)
    doc.setFillColor(ink)
    doc.setFont('Helvetica', 11)
    doc.drawString(48, 710, address)
    doc.drawString(48, 693, email)
    doc.setFont('Helvetica-Bold', 32)
    doc.drawRightString(564, 644, 'INVOICE')
    doc.setFont('Helvetica-Bold', 10)
    doc.drawString(48, 639, 'BILL TO')
    doc.setFont('Helvetica', 11)
    doc.drawString(48, 616, 'Maple Bridge Operations')
    doc.drawString(48, 598, '26 Mercer Street, Albany, NY 12207')
    details = [('Invoice number', number), ('Invoice date', date), ('Currency', 'USD')]
    if po:
        details.append(('Purchase order', po))
    for index, (label, value) in enumerate(details):
        y = 617 - index * 19
        doc.drawString(350, y, label)
        doc.setFont('Helvetica-Bold', 11)
        doc.drawRightString(564, y, value)
        doc.setFont('Helvetica', 11)

    doc.setFillColor(accent)
    doc.roundRect(48, 507, 516, 34, 5, fill=True, stroke=False)
    doc.setFillColor(white)
    doc.setFont('Helvetica-Bold', 10)
    doc.drawString(60, 520, 'DESCRIPTION')
    for x, label in [(353, 'QTY'), (451, 'UNIT PRICE'), (552, 'AMOUNT')]:
        doc.drawRightString(x, 520, label)
    for index, (description, quantity, price) in enumerate(lines):
        y = 482 - index * 33
        doc.setFillColor(ink)
        doc.setFont('Helvetica', 12)
        doc.drawString(60, y, description)
        doc.drawRightString(353, y, str(quantity))
        doc.drawRightString(451, y, f'${price:,.2f}')
        doc.drawRightString(552, y, f'${quantity * price:,.2f}')
        doc.setStrokeColor(HexColor('#DFE3E5'))
        doc.line(48, y - 13, 564, y - 13)
    subtotal = sum(quantity * price for _, quantity, price in lines)
    total = printed_total if printed_total is not None else subtotal + tax
    for index, (label, amount) in enumerate([('Subtotal', subtotal), ('Sales tax', tax), ('Invoice total (USD)', total)]):
        y = 445 - len(lines) * 33 - index * 28
        doc.setFont('Helvetica-Bold' if index == 2 else 'Helvetica', 14 if index == 2 else 12)
        doc.drawString(328, y, label)
        doc.drawRightString(552, y, f'${amount:,.2f}')
    doc.setFillColor(HexColor('#465462'))
    doc.setFont('Helvetica', 10)
    doc.drawString(48, 84, 'Payment terms: net 30 days.')
    doc.drawString(48, 63, 'Synthetic case study document. All organizations and contact details are fictional.')
    doc.save()


def scan(source, target):
    pdf = pypdfium2.PdfDocument(str(source))
    page = pdf[0]
    image = page.render(scale=2).to_pil().convert('L')
    page.close()
    pdf.close()
    image = ImageEnhance.Contrast(image).enhance(0.90).filter(ImageFilter.GaussianBlur(0.32))
    background = Image.new('L', image.size, 237)
    image = image.resize((1196, 1548)).rotate(-0.45, resample=Image.Resampling.BICUBIC, fillcolor=237)
    background.paste(image, (16, 20))
    doc = Canvas(str(target), pagesize=letter)
    doc.setTitle('Scanned synthetic invoice')
    doc.drawImage(ImageReader(background), 0, 0, 612, 792)
    doc.save()


northstar, harborline, cedarline = VENDORS
happy = OUTPUT / '01-office-supplies.pdf'
create_invoice(happy, northstar, 'NS-2026-1187', '2026-11-12', 'PO-1042',
               [('Recycled copy paper (case)', 8, 42), ('Black toner cartridge', 2, 62)], 36.80)
scan(happy, OUTPUT / '02-rescanned-copy.pdf')
create_invoice(OUTPUT / '03-packaging-first-shipment.pdf', harborline, 'HP-2026-031', '2026-11-13', 'PO-2081',
               [('Corrugated carton bundle', 20, 32.50)], 50)
create_invoice(OUTPUT / '04-packaging-second-shipment.pdf', harborline, 'HP-2026-032', '2026-11-16', 'PO-2081',
               [('Protective insert pack', 20, 23.50)], 30)
create_invoice(OUTPUT / '05-missing-po.pdf', cedarline, 'CF-2026-089', '2026-11-15', None,
               [('Scheduled facility maintenance', 3, 100)], 24)
with TemporaryDirectory() as temporary:
    source = Path(temporary) / 'mismatch.pdf'
    create_invoice(source, northstar, 'NS-2026-1203', '2026-11-17', 'PO-1042',
                   [('Thermal label roll', 10, 15), ('Shipping pouch case', 3, 50)], 24, printed_total=342)
    scan(source, OUTPUT / '06-scan-total-mismatch.pdf')
