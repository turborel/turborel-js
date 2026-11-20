/**
 * Tests of how an XML value's serialization is read into its nodes
 * (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Xml } from '../../src/codec/values.js';
import { XML_NAMESPACE, type XmlNode, parseContent } from '../../src/xml/nodes.js';
import { isFailure } from '../support/failures.js';

/**
 * The element `node` is, or a failure.
 *
 * @param node - the node
 * @returns it, as an element
 */
function element(node: XmlNode | undefined): Extract<XmlNode, { kind: 'element' }> {
  if (node?.kind !== 'element') throw new Error(`not an element: ${JSON.stringify(node)}`);
  return node;
}

/** Verifies: [CLIENT XML values] an XML value's nodes are parsed from its text: elements, attributes, text, comments and processing instructions, its whitespace kept. */
test('the nodes of a value', () => {
  const nodes = new Xml(
    '<order no="18"><item>jam &amp; <![CDATA[<bread>]]></item> <!-- two --><?pi do it?></order>tail',
  ).nodes();
  assert.equal(nodes.length, 2);
  const order = element(nodes[0]);
  assert.deepEqual([order.name, order.localName, order.namespace], ['order', 'order', undefined]);
  assert.deepEqual(order.attributes, [{ name: 'no', localName: 'no', value: '18' }]);
  assert.deepEqual(order.children.slice(1), [
    { kind: 'text', text: ' ' },
    { kind: 'comment', text: ' two ' },
    { kind: 'processingInstruction', target: 'pi', data: 'do it' },
  ]);
  assert.deepEqual(element(order.children[0]).children, [{ kind: 'text', text: 'jam & <bread>' }]);
  assert.deepEqual(nodes[1], { kind: 'text', text: 'tail' });
  assert.deepEqual(parseContent(''), []);
  assert.deepEqual(parseContent('<?pi?>'), [{ kind: 'processingInstruction', target: 'pi', data: '' }]);
});

/** Verifies: [CLIENT XML values] namespaces are resolved: the default one for elements alone, a prefix for both, xml bound; declarations are not attributes. */
test('namespaces', () => {
  const [root] = parseContent('<r xmlns="urn:d" xmlns:p="urn:p" a="1" p:b="2" xml:lang="en"><p:c/></r>');
  const r = element(root);
  assert.equal(r.namespace, 'urn:d');
  assert.deepEqual(
    r.attributes.map((a) => [a.localName, a.namespace]),
    [
      ['a', undefined],
      ['b', 'urn:p'],
      ['lang', XML_NAMESPACE],
    ],
  );
  assert.deepEqual(
    [...r.declared],
    [
      ['', 'urn:d'],
      ['p', 'urn:p'],
    ],
  );
  const c = element(r.children[0]);
  assert.deepEqual([c.name, c.localName, c.namespace], ['p:c', 'c', 'urn:p']);
  assert.equal(element(parseContent('<a xmlns=""/>')[0]).namespace, undefined);
});

/** Verifies: [CLIENT XML values] references, line ends and attribute whitespace are read as XML reads them; an XML declaration is passed over. */
test('references, line ends and the declaration', () => {
  const [a] = parseContent('<?xml version="1.1"?><a v="x\ty&#10;z">&#x41;&#66;\r\n&lt;&gt;&apos;&quot;\r</a>');
  const node = element(a);
  assert.equal(node.attributes[0]?.value, 'x y\nz');
  assert.deepEqual(node.children, [{ kind: 'text', text: 'AB\n<>\'"\n' }]);
  assert.equal(element(parseContent('<?xml-stylesheet href="s"?><b/>')[1]).name, 'b');
});

/** Verifies: [CLIENT XML values] text that is not well-formed XML content fails with SQLSTATE 2200N. */
test('malformed content', () => {
  const bad = [
    '<a>',
    '</a>',
    '<a></b>',
    '<a b="1" b="2"/>',
    '<a p:b="1"/>',
    '<p:a/>',
    '<a b=1/>',
    '<a b="<"/>',
    '<a b="1"c="2"/>',
    'x ]]> y',
    '&nope;',
    '&amp',
    '&#0;',
    '&#xFFFFFF;',
    '<!-- a -- b -->',
    '<!-- a',
    '<!DOCTYPE a><a/>',
    '<a/><?xml version="1.0"?>',
    '<a>\u0001</a>',
    '<1/>',
    '<![CDATA[x',
    '<a xmlns:p="urn:p" xmlns:q="urn:p" p:b="1" q:b="2"/>',
    '<?pi',
  ];
  for (const text of bad) assert.throws(() => parseContent(text), isFailure(-301, '2200N'), text);
});
