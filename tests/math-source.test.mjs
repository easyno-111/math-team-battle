import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitMathSource} from '../src/utils/mathSource.js';
test('AI dollar-delimited polynomial and power are separated from Korean prose',()=>{
 const parts=splitMathSource('다항식 $(x+1)(x+2)(x+3)$을 전개했을 때, $x^2$의 계수는?');
 assert.deepEqual(parts.filter(p=>p.math).map(p=>p.text),['(x+1)(x+2)(x+3)','x^2']);
 assert.ok(parts.every(p=>!p.text.includes('$')));
});
test('display and backslash delimiters preserve nested LaTeX',()=>{
 assert.deepEqual(splitMathSource(String.raw`\[\frac{1}{\sqrt{x^{2}+1}}\]`),[{text:String.raw`\frac{1}{\sqrt{x^{2}+1}}`,math:true,display:true}]);
 assert.equal(splitMathSource(String.raw`\(x_1\)`)[0].text,'x_1');
 assert.equal(splitMathSource('$$x^2$$')[0].display,true);
});
test('unmatched or escaped dollar signs remain text',()=>{
 assert.equal(splitMathSource('가격 $50')[0].text,'가격 $50');
 assert.equal(splitMathSource(String.raw`\$5와 \$10`)[0].math,false);
 assert.equal(splitMathSource(null).length,0);
});
