#!/usr/bin/env python3
"""Writes connection-points.vssx: a minimal Visio stencil whose only master, a 2in x 1in
rectangle, has connection points at the middle of its left edge, right edge and top edge."""
import pathlib
import zipfile

NS = 'xmlns="http://schemas.microsoft.com/office/visio/2012/main" ' \
     'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
VISIO_REL = 'http://schemas.microsoft.com/visio/2010/relationships'

FILES = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.stencil.main+xml"/>'
        '<Override PartName="/visio/masters/masters.xml" ContentType="application/vnd.ms-visio.masters+xml"/>'
        '<Override PartName="/visio/masters/master1.xml" ContentType="application/vnd.ms-visio.master+xml"/>'
        '</Types>',
    '_rels/.rels': f'<?xml version="1.0" encoding="UTF-8"?><Relationships {REL_NS}>'
        f'<Relationship Id="rId1" Type="{VISIO_REL}/document" Target="visio/document.xml"/></Relationships>',
    'visio/document.xml': f'<?xml version="1.0" encoding="UTF-8"?><VisioDocument {NS}/>',
    'visio/_rels/document.xml.rels': f'<?xml version="1.0" encoding="UTF-8"?><Relationships {REL_NS}>'
        f'<Relationship Id="rId1" Type="{VISIO_REL}/masters" Target="masters/masters.xml"/></Relationships>',
    'visio/masters/masters.xml': f'<?xml version="1.0" encoding="UTF-8"?><Masters {NS}>'
        '<Master ID="2" NameU="Connection Box" Name="Connection Box">'
        '<PageSheet><Cell N="PageWidth" V="2"/><Cell N="PageHeight" V="1"/></PageSheet>'
        '<Rel r:id="rId1"/></Master></Masters>',
    'visio/masters/_rels/masters.xml.rels': f'<?xml version="1.0" encoding="UTF-8"?><Relationships {REL_NS}>'
        f'<Relationship Id="rId1" Type="{VISIO_REL}/master" Target="master1.xml"/></Relationships>',
    'visio/masters/master1.xml': f'<?xml version="1.0" encoding="UTF-8"?><MasterContents {NS}><Shapes>'
        '<Shape ID="1" Type="Shape">'
        '<Cell N="PinX" V="1"/><Cell N="PinY" V="0.5"/><Cell N="Width" V="2"/><Cell N="Height" V="1"/>'
        '<Cell N="LocPinX" V="1"/><Cell N="LocPinY" V="0.5"/>'
        '<Section N="Geometry" IX="0">'
        '<Row T="MoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>'
        '<Row T="LineTo" IX="2"><Cell N="X" V="2"/><Cell N="Y" V="0"/></Row>'
        '<Row T="LineTo" IX="3"><Cell N="X" V="2"/><Cell N="Y" V="1"/></Row>'
        '<Row T="LineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="1"/></Row>'
        '<Row T="LineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>'
        '</Section>'
        '<Section N="Connection">'
        '<Row IX="0"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0.5" F="Height*0.5"/></Row>'
        '<Row IX="1"><Cell N="X" V="2" F="Width*1"/><Cell N="Y" V="0.5" F="Height*0.5"/></Row>'
        '<Row IX="2"><Cell N="X" V="1" F="Width*0.5"/><Cell N="Y" V="1" F="Height*1"/></Row>'
        '</Section>'
        '</Shape></Shapes></MasterContents>',
}

out = pathlib.Path(__file__).with_name('connection-points.vssx')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name, content in FILES.items():
        z.writestr(name, content)
print(f'wrote {out}')
