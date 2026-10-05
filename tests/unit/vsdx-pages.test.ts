import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { readZip, looksLikeZip } from '../../public/wasm/vsdx-zip.mjs';
import { parseXml } from '../../public/wasm/vsdx-xml.mjs';
import { convertVsdxPages } from '../../public/wasm/vsdx-diagram.mjs';
import { convertVisio } from '../../public/wasm/converter-core.mjs';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Builds a ZIP in memory; `deflate` exercises the inflate path, otherwise entries are stored.
function makeZip(files: Record<string, string>, deflate = true): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const raw = Buffer.from(text);
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(deflate ? 8 : 0, 8);
    header.writeUInt32LE(crc32(raw), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    locals.push(header, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, ...centrals, end]));
}

const NS = "xmlns='http://schemas.microsoft.com/office/visio/2012/main' xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'";

function cells(values: Record<string, string | number>): string {
  return Object.entries(values)
    .map(([name, value]) => `<Cell N='${name}' V='${value}'/>`)
    .join('');
}

// A box whose RelLineTo path covers the whole shape, as Visio writes a rectangle.
const RECTANGLE = `<Section N='Geometry' IX='0'><Row T='RelMoveTo' IX='1'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row><Row T='RelLineTo' IX='2'><Cell N='X' V='1'/><Cell N='Y' V='0'/></Row><Row T='RelLineTo' IX='3'><Cell N='X' V='1'/><Cell N='Y' V='1'/></Row><Row T='RelLineTo' IX='4'><Cell N='X' V='0'/><Cell N='Y' V='1'/></Row><Row T='RelLineTo' IX='5'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row></Section>`;

function box(id: number, pinX: number, pinY: number, extra = '', body = ''): string {
  return (
    `<Shape ID='${id}' Type='Shape'>` +
    cells({ PinX: pinX, PinY: pinY, Width: 2, Height: 1, LocPinX: 1, LocPinY: 0.5, ...{} }) +
    extra +
    RECTANGLE +
    body +
    `</Shape>`
  );
}

const PAGE_1 =
  `<?xml version='1.0' encoding='utf-8' ?><PageContents ${NS}><Shapes>` +
  box(
    2,
    2,
    3,
    cells({ FillForegnd: '#ff0000', LineColor: '#0000ff', LineWeight: 0.02 }),
    `<Section N='Character'><Row IX='0'><Cell N='Size' V='0.1'/></Row><Row IX='1'><Cell N='Size' V='0.1'/><Cell N='Style' V='1'/></Row></Section>` +
      `<Text>Hello<cp IX='1'/> &amp; bold</Text>`
  ) +
  box(3, 7, 3) +
  // A 1-D connector from the right of box 2 to the left of box 3, bent upwards in the middle.
  `<Shape ID='4' Type='Shape'>` +
  cells({ PinX: 3, PinY: 3, Width: 3, Height: 0, LocPinX: 0, LocPinY: 0, BeginX: 3, BeginY: 3, EndX: 6, EndY: 3, ObjType: 2, LineColor: '#00ff00', LinePattern: 2 }) +
  `<Section N='Geometry' IX='0'><Cell N='NoFill' V='1'/><Row T='MoveTo' IX='1'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row><Row T='LineTo' IX='2'><Cell N='X' V='1.5'/><Cell N='Y' V='1'/></Row><Row T='LineTo' IX='3'><Cell N='X' V='3'/><Cell N='Y' V='0'/></Row></Section></Shape>` +
  // A shape turned a quarter turn counter-clockwise.
  `<Shape ID='5' Type='Shape'>` +
  cells({ PinX: 5, PinY: 1, Width: 2, Height: 1, LocPinX: 1, LocPinY: 0.5, Angle: Math.PI / 2 }) +
  RECTANGLE +
  `</Shape>` +
  // An instance of master 1 dropped at half its size.
  `<Shape ID='10' Type='Group' Master='1'>` +
  cells({ PinX: 5, PinY: 2, Width: 1, Height: 0.5, LocPinX: 0.5, LocPinY: 0.25 }) +
  `</Shape>` +
  `</Shapes><Connects>` +
  `<Connect FromSheet='4' FromCell='BeginX' FromPart='9' ToSheet='2' ToCell='Connections.X1' ToPart='100'/>` +
  `<Connect FromSheet='4' FromCell='EndX' FromPart='12' ToSheet='3' ToCell='Connections.X1' ToPart='100'/>` +
  `</Connects></PageContents>`;

const PAGE_2 =
  `<?xml version='1.0' encoding='utf-8' ?><PageContents ${NS}><Shapes>` + box(2, 5, 2.5) + `</Shapes></PageContents>`;

const MASTER_1 =
  `<?xml version='1.0' encoding='utf-8' ?><MasterContents ${NS}><Shapes><Shape ID='1' Type='Group'>` +
  cells({ PinX: 1, PinY: 0.5, Width: 2, Height: 1, LocPinX: 1, LocPinY: 0.5 }) +
  `</Shape></Shapes></MasterContents>`;

function vsdxFiles(withMasters: boolean): Record<string, string> {
  const files: Record<string, string> = {
    'visio/document.xml': `<VisioDocument ${NS}><StyleSheets/></VisioDocument>`,
    'visio/pages/pages.xml':
      `<Pages ${NS}>` +
      `<Page ID='0' Name='Overview'><PageSheet>${cells({ PageWidth: 10, PageHeight: 5 })}</PageSheet><Rel r:id='rId1'/></Page>` +
      `<Page ID='1' Name='Detail &amp; notes'><PageSheet>${cells({ PageWidth: 10, PageHeight: 5 })}</PageSheet><Rel r:id='rId2'/></Page>` +
      `</Pages>`,
    'visio/pages/_rels/pages.xml.rels':
      `<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>` +
      `<Relationship Id='rId1' Target='page1.xml'/><Relationship Id='rId2' Target='page2.xml'/></Relationships>`,
    'visio/pages/page1.xml': PAGE_1,
    'visio/pages/page2.xml': PAGE_2,
  };
  if (withMasters) {
    files['visio/masters/masters.xml'] =
      `<Masters ${NS}><Master ID='1' Name='Box master' NameU='Box master'>` +
      `<PageSheet>${cells({ PageWidth: 2, PageHeight: 1 })}</PageSheet><Rel r:id='rId1'/></Master></Masters>`;
    files['visio/masters/_rels/masters.xml.rels'] =
      `<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='rId1' Target='master1.xml'/></Relationships>`;
    files['visio/masters/master1.xml'] = MASTER_1;
  }
  return files;
}

// What libvisio would render for the master: a 2x1 inch page, as `data:image/svg+xml,<base64>`.
const MASTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="1in" viewBox="0 0 144 72"><rect width="144" height="72"/></svg>`;
const MASTER_SVG_URI = `data:image/svg+xml,${Buffer.from(MASTER_SVG).toString('base64')}`;

// Parses the attributes of the cell with the given id out of the converted XML.
function cellOf(xml: string, id: string): { style: string; value: string; geometry: Record<string, number>; raw: string } {
  const match = new RegExp(`<mxCell id="${id}"[^>]*>[\\s\\S]*?</mxCell>`).exec(xml);
  if (!match) throw new Error(`no cell ${id}`);
  const raw = match[0];
  const unescape = (text: string) => text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const geometry: Record<string, number> = {};
  const geometryTag = /<mxGeometry ([^>]*)>/.exec(raw)?.[1] ?? '';
  for (const [, key, value] of geometryTag.matchAll(/(\w+)="(-?[\d.]+)"/g)) geometry[key] = Number(value);
  return {
    style: unescape(/style="([^"]*)"/.exec(raw)?.[1] ?? ''),
    value: unescape(/ value="([^"]*)"/.exec(raw)?.[1] ?? ''),
    geometry,
    raw,
  };
}

describe('vsdx package reading', () => {
  it('reads stored and deflated entries', async () => {
    for (const deflate of [false, true]) {
      const bytes = makeZip({ 'a/b.txt': 'hello zip', 'c.txt': 'x'.repeat(5000) }, deflate);
      expect(looksLikeZip(bytes)).toBe(true);
      const zip = await readZip(bytes);
      expect(zip.has('a/b.txt')).toBe(true);
      expect(zip.has('missing')).toBe(false);
      expect(new TextDecoder().decode((await zip.read('a/b.txt'))!)).toBe('hello zip');
      expect((await zip.read('c.txt'))!.length).toBe(5000);
      expect(await zip.read('missing')).toBeNull();
    }
  });

  it('rejects bytes that are not a ZIP package', async () => {
    expect(looksLikeZip(new TextEncoder().encode('plain text'))).toBe(false);
    await expect(readZip(new TextEncoder().encode('plain text, not a zip'))).rejects.toThrow(/ZIP/);
  });

  it('parses XML with entities and keeps text order around markers inside <Text>', () => {
    const root = parseXml(`<?xml version='1.0'?><A x="1 &amp; 2"><!-- c --><Text>a &lt;b&gt;<cp IX='1'/>c</Text><B/></A>`)!;
    expect(root.attrs.x).toBe('1 & 2');
    const text = root.kids.find((kid: any) => kid.name === 'Text') as any;
    expect(text.kids.map((kid: any) => (typeof kid === 'string' ? kid : kid.name))).toEqual(['a <b>', 'cp', 'c']);
  });
});

describe('vsdx pages to draw.io', () => {
  async function convert(withMasters = true) {
    const zip = await readZip(makeZip(vsdxFiles(withMasters)));
    const result = await convertVsdxPages(zip, {
      scale: 100,
      loadMasterSvgs: async () => new Map([['Box master', MASTER_SVG_URI]]),
    });
    expect(result).not.toBeNull();
    return result!;
  }

  it('creates one draw.io page per Visio page, sized in pixels', async () => {
    const { xml, pageCount } = await convert();
    expect(pageCount).toBe(2);
    expect(xml.match(/<diagram /g)).toHaveLength(2);
    expect(xml).toContain('name="Overview"');
    expect(xml).toContain('name="Detail &amp; notes"');
    expect(xml).toContain('pageWidth="1000" pageHeight="500"');
  });

  it('turns a rectangle into a native cell with its fill, line and text', async () => {
    const { xml } = await convert();
    const rectangle = cellOf(xml, 's2');
    // Pin (2,3), 2x1 inches, y flipped on a 5 inch page, 100 px per inch
    expect(rectangle.geometry).toMatchObject({ x: 100, y: 150, width: 200, height: 100 });
    expect(rectangle.style).toContain('fillColor=#ff0000');
    expect(rectangle.style).toContain('strokeColor=#0000ff');
    expect(rectangle.style).toContain('strokeWidth=2');
    expect(rectangle.style).toContain('whiteSpace=wrap');
    expect(rectangle.style).not.toContain('shape=image');
    // second character style (bold) applies only to the run after <cp IX='1'/>
    expect(rectangle.value).toBe('Hello<span style="font-weight:bold"> & bold</span>'.replace(' & ', ' &amp; '));
  });

  it('rotates shapes counter-clockwise like Visio, which is a clockwise draw.io rotation of 270 degrees', async () => {
    const { xml } = await convert();
    expect(cellOf(xml, 's5').style).toContain('rotation=270');
  });

  it('places a master instance by its own transform, scaled to the instance size', async () => {
    const { xml } = await convert();
    const instance = cellOf(xml, 's10');
    // The 2x1 master page maps onto the 1x0.5 instance centred on (5, 2).
    expect(instance.geometry).toMatchObject({ x: 450, y: 275, width: 100, height: 50 });
    expect(instance.style).toContain('shape=image');
    expect(instance.style).toContain(`image=${MASTER_SVG_URI}`);
  });

  it('turns a connector into an edge attached to the shapes it is glued to', async () => {
    const { xml } = await convert();
    const edge = cellOf(xml, 'e4');
    expect(edge.raw).toContain('edge="1"');
    expect(edge.raw).toContain('source="s2"');
    expect(edge.raw).toContain('target="s3"');
    // leaves the right side of box 2 and enters the left side of box 3, both at mid height
    expect(edge.style).toContain('exitX=1;exitY=0.5');
    expect(edge.style).toContain('entryX=0;entryY=0.5');
    expect(edge.style).toContain('strokeColor=#00ff00');
    expect(edge.style).toContain('dashed=1');
    // the bend in the connector's path is kept as a waypoint: (4.5, 4) -> (450, 100)
    expect(edge.raw).toContain('<mxPoint x="450" y="100"/>');
    expect(edge.raw).toContain('<mxPoint x="300" y="200" as="sourcePoint"/>');
    expect(edge.raw).toContain('<mxPoint x="600" y="200" as="targetPoint"/>');
  });

  it('gives every cell a unique id and no edge points at a missing cell', async () => {
    const { xml } = await convert();
    for (const diagram of xml.split('<diagram ').slice(1)) {
      const ids = [...diagram.matchAll(/<mxCell id="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
      for (const [, reference] of diagram.matchAll(/(?:source|target)="([^"]+)"/g)) expect(ids).toContain(reference);
    }
  });

  it('draws a master without a rendered picture from its own geometry instead of dropping it', async () => {
    const zip = await readZip(makeZip(vsdxFiles(true)));
    const { xml } = (await convertVsdxPages(zip, { scale: 100, loadMasterSvgs: async () => new Map() }))!;
    expect(xml).toContain('id="s2"');
    expect(xml).not.toContain(MASTER_SVG_URI);
  });

  it('returns null for a package with no drawing pages (a stencil)', async () => {
    const zip = await readZip(makeZip({ 'visio/masters/masters.xml': `<Masters ${NS}/>` }));
    expect(await convertVsdxPages(zip, { scale: 100, loadMasterSvgs: async () => new Map() })).toBeNull();
  });

  it('is what convertVisio returns for a .vsdx with drawing pages', async () => {
    const xml = new TextDecoder().decode(await convertVisio(makeZip(vsdxFiles(false)), { format: 'drawio', scale: 100 }));
    expect(xml).toContain('name="Overview"');
    expect(xml).not.toContain('Visio Stencils');
  });
});
