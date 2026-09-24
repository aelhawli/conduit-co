"""Reproducible synthetic construction workload. All large bytes are visible images.

No padding, attachments, hidden streams or duplicated byte filler. Raster sheets
simulate 150-dpi greyscale scans with low-amplitude scanner grain. Not design advice.
"""
from pathlib import Path
import io, json, hashlib, argparse
import numpy as np
from PIL import Image
from reportlab import rl_config
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import pypdfium2 as pdfium

rl_config.useA85 = 0
ROOT=None
W,H=2384,1684
DISC=['Architectural','Electrical','Structural','Hydraulic']

def sheet(c, n, discipline):
    c.setPageSize((W,H)); c.setLineWidth(1); c.setStrokeColorRGB(.1,.15,.2)
    c.rect(45,45,W-90,H-90)
    c.setFont('Helvetica-Bold',26)
    c.drawString(75,H-90,f'SYNTHETIC CONSTRUCTION PACKAGE - {discipline.upper()}')
    c.setFont('Helvetica',16)
    c.drawString(75,H-122,'Fictional civic building / QA only / Not for construction / Dimensions illustrative')
    for row in range(6):
        for col in range(10):
            x,y=100+col*210,260+row*205
            c.setLineWidth(3); c.rect(x,y,192,180)
            c.setFont('Helvetica',10);c.drawString(x+8,y+155,f'{discipline[0]}-{n:03d}-{row*10+col+1:02d}')
            if discipline=='Architectural':
                c.setLineWidth(1);c.arc(x,y,x+65,y+65,0,90)
                for k in range(4):c.rect(x+85,y+20+k*28,80,18)
                c.drawString(x+10,y+115,['Office','Meeting','Services','Store'][(row+col+n)%4])
            elif discipline=='Electrical':
                c.setLineWidth(1)
                for k in range(3):
                    for j in range(3):
                        xx,yy=x+35+k*58,y+30+j*48
                        c.circle(xx,yy,10);c.line(xx-7,yy-7,xx+7,yy+7);c.line(xx+7,yy-7,xx-7,yy+7)
                c.setDash(5,3);c.line(x+30,y+30,x+145,y+126);c.setDash()
            elif discipline=='Structural':
                c.setLineWidth(.7)
                for k in range(25):c.line(x+8+k*7,y+10,x+8+k*7,y+140)
                for k in range(18):c.line(x+8,y+10+k*7,x+182,y+10+k*7)
                for dx in [12,170]:
                    for dy in [12,128]:c.rect(x+dx-6,y+dy-6,12,12,fill=1)
            else:
                c.setLineWidth(2);c.line(x+22,y+30,x+165,y+30);c.line(x+90,y+30,x+90,y+125)
                for k in range(4):c.circle(x+30+k*42,y+75,12);c.line(x+30+k*42,y+30,x+30+k*42,y+63)
                c.drawString(x+12,y+128,'DN50 branch / DN100 stack')
            c.setLineWidth(.4);c.line(x,y-15,x+192,y-15);c.drawString(x+72,y-29,str(6000+(n%4)*500))
    c.setFont('Helvetica',13)
    for k in range(6):c.drawString(85,215-k*23,f'Note {k+1}: Coordinate {discipline.lower()} sheet {n:03d} with schedule; verify interfaces, levels and revisions.')
    c.drawString(W-510,80,f'SHEET {discipline[0]}-{n:03d} | REV QA | A1 | 1:100')
    c.showPage()

def spec(c,n,discipline):
    c.setPageSize((595,842));c.setFont('Helvetica-Bold',16)
    c.drawString(40,790,f'{discipline} specification / schedule')
    c.setFont('Helvetica',10);c.drawString(40,765,f'SYNTHETIC QA ONLY - section {n} - not for construction')
    for j in range(32):
        y=730-j*19;c.line(40,y-4,555,y-4)
        c.drawString(45,y,f'{n}.{j+1:02d}');c.drawString(95,y,f'{discipline} item {j+1}: coordinate drawings and inspect installation.')
    c.showPage()

def scan(n,discipline):
    buf=io.BytesIO();c=canvas.Canvas(buf,pageCompression=1);sheet(c,n,discipline);c.save()
    doc=pdfium.PdfDocument(buf.getvalue());page=doc[0];bitmap=page.render(scale=150/72)
    rgb=bitmap.to_pil();gray=np.asarray(rgb.convert('L')).copy();rgb.close();bitmap.close();page.close();doc.close()
    rng=np.random.default_rng(41000+n+DISC.index(discipline)*10000)
    # Low-amplitude grain represents a scanned print, not arbitrary byte padding.
    gray=np.clip(gray.astype(np.int16)-4+rng.integers(-3,4,gray.shape,dtype=np.int16),0,255).astype(np.uint8)
    image=Image.fromarray(gray);out=io.BytesIO();image.save(out,format='JPEG',quality=95);image.close()
    return out.getvalue()

def package(name,budget,only=None):
    path=ROOT/(name+'.pdf');c=canvas.Canvas(str(path),pageCompression=1)
    c.setTitle(name+' - SYNTHETIC QA ONLY')
    pages=[];total=0;n=1
    while total<budget:
        d=only or DISC[(n-1)%4];raw=scan(n,d)
        if total+len(raw)>budget and n>1:break
        c.setPageSize((W,H));c.drawImage(ImageReader(io.BytesIO(raw)),0,0,W,H);c.showPage()
        pages.append({'page':len(pages)+1,'discipline':d,'kind':'scanned drawing','width':W,'height':H,'image_bytes':len(raw)})
        total+=len(raw)
        if n%4==0:
            sheet(c,n,d);pages.append({'page':len(pages)+1,'discipline':d,'kind':'vector drawing','width':W,'height':H})
            spec(c,n,d);pages.append({'page':len(pages)+1,'discipline':d,'kind':'specification','width':595,'height':842})
        n+=1
    c.save();result={'file':str(path),'bytes':path.stat().st_size,'sha256':hashlib.file_digest(path.open('rb'),'sha256').hexdigest(),'embedded_image_bytes':total,'pages':pages}
    (ROOT/(name+'.json')).write_text(json.dumps(result,indent=2))
    print(json.dumps({k:v for k,v in result.items() if k!='pages'}),flush=True)
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--directory',required=True)
    ROOT=Path(parser.parse_args().directory)
    ROOT.mkdir(parents=True,exist_ok=True)
    package('construction-100MB',99_500_000)
    package('construction-250MB',248_000_000)
    for d in DISC:package('discipline-'+d.lower(),7_000_000,d)
