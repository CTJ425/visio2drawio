// @ts-check
// Small XML parser for the Visio package parts. A Web Worker has no DOMParser and Node has none
// either, and the Visio XML is plain (no DTD, namespaces only as a default xmlns), so a tokenizer
// is enough. Elements are { name, attrs, kids }; kids hold child elements and, only inside
// <Text>, the text between them (needed to keep the <cp>/<pp> markers in order).

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTRIBUTE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;

/** @type {Record<string, string>} */
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** @param {string} text */
function decodeEntities(text) {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY, (match, body) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body];
    const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

/** @typedef {{ name: string, attrs: Record<string, string>, kids: Array<XmlElement | string> }} XmlElement */

/**
 * @param {string} text
 * @returns {XmlElement | null} the root element
 */
export function parseXml(text) {
  /** @type {XmlElement} */
  const root = { name: '#document', attrs: {}, kids: [] };
  const stack = [root];
  TOKEN.lastIndex = 0;
  let match;
  while ((match = TOKEN.exec(text)) !== null) {
    const top = stack[stack.length - 1];
    const [, cdata, closing, name, attrText, selfClosing, chars] = match;
    if (name) {
      if (closing) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      /** @type {Record<string, string>} */
      const attrs = {};
      if (attrText) {
        ATTRIBUTE.lastIndex = 0;
        let attr;
        while ((attr = ATTRIBUTE.exec(attrText)) !== null) {
          attrs[attr[1]] = decodeEntities(attr[2] ?? attr[3]);
        }
      }
      /** @type {XmlElement} */
      const element = { name, attrs, kids: [] };
      top.kids.push(element);
      if (!selfClosing) stack.push(element);
    } else if (cdata !== undefined) {
      if (top.name === 'Text') top.kids.push(cdata);
    } else if (chars !== undefined && top.name === 'Text') {
      top.kids.push(decodeEntities(chars));
    }
  }
  return /** @type {XmlElement | undefined} */ (root.kids.find((kid) => typeof kid !== 'string')) ?? null;
}

/**
 * @param {XmlElement | null | undefined} element
 * @param {string} name
 * @returns {XmlElement[]}
 */
export function childrenOf(element, name) {
  return element ? /** @type {XmlElement[]} */ (element.kids.filter((kid) => typeof kid !== 'string' && kid.name === name)) : [];
}

/**
 * @param {XmlElement | null | undefined} element
 * @param {string} name
 * @returns {XmlElement | null}
 */
export function childOf(element, name) {
  return childrenOf(element, name)[0] ?? null;
}
