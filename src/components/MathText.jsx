import { splitMathSource } from '../utils/mathSource';
function findClosing(text, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === openChar) depth += 1;
    else if (text[index] === closeChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function readScript(text, startIndex) {
  if (startIndex >= text.length) return null;

  if (text[startIndex] === "{") {
    const closeIndex = findClosing(text, startIndex, "{", "}");
    if (closeIndex < 0) return null;
    return {
      value: text.slice(startIndex + 1, closeIndex),
      nextIndex: closeIndex + 1,
    };
  }

  let index = startIndex;
  if (text[index] === "+" || text[index] === "-") index += 1;

  const numberStart = index;
  while (index < text.length && /[0-9.]/.test(text[index])) index += 1;
  if (index > numberStart) {
    return {
      value: text.slice(startIndex, index),
      nextIndex: index,
    };
  }

  if (/[A-Za-z가-힣]/.test(text[startIndex])) {
    return {
      value: text[startIndex],
      nextIndex: startIndex + 1,
    };
  }

  return null;
}

const symbols = {times:'×',cdot:'·',div:'÷',pm:'±',pi:'π',alpha:'α',beta:'β',theta:'θ',Delta:'Δ',infty:'∞',rightarrow:'→',Rightarrow:'⇒',in:'∈',notin:'∉',cup:'∪',cap:'∩',approx:'≈',ldots:'…',cdots:'⋯',sum:'∑'};
function normalizeMathSource(value) {
  return String(value ?? "")
    .replace(/\\(left|right)(?![A-Za-z])/g, '')
    .replace(/\\([A-Za-z]+)/g, (whole, name) => symbols[name] || whole)
    .replace(/\\[,;!]/g, ' ')
    .replace(/\\leq?/g, "≤")
    .replace(/\\geq?/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/!=/g, "≠")
    .replace(/\+\/-/g, "±");
}

function renderSegment(source, keyPrefix = "m") {
  if (keyPrefix.length > 600) return String(source);
  const text = normalizeMathSource(source);
  const nodes = [];
  let buffer = "";
  let index = 0;
  let key = 0;

  const flush = () => {
    if (!buffer) return;
    nodes.push(<span key={`${keyPrefix}-t-${key++}`}>{buffer}</span>);
    buffer = "";
  };

  while (index < text.length) {
    const frac = text.slice(index).match(/^\\(?:dfrac|tfrac|frac)\s*\{/);
    if (frac) {
      const topStart=index+frac[0].length-1;
      const topEnd=findClosing(text,topStart,'{','}');
      let bottomStart=topEnd+1;
      while (/\s/.test(text[bottomStart] || '') && bottomStart<text.length) bottomStart++;
      const bottomEnd=text[bottomStart]==='{' ? findClosing(text,bottomStart,'{','}') : -1;
      if(topEnd>=0 && bottomEnd>=0){
        flush();
        nodes.push(<span className="math-fraction" key={`${keyPrefix}-f-${key++}`}><span>{renderSegment(text.slice(topStart+1,topEnd),`${keyPrefix}-fn${key}`)}</span><span>{renderSegment(text.slice(bottomStart+1,bottomEnd),`${keyPrefix}-fd${key}`)}</span></span>);
        index=bottomEnd+1;continue;
      }
    }
    const group=text.slice(index).match(/^\\(?:text|mathrm|mathbf|mathit)\{/);
    if(group){const open=index+group[0].length-1;const end=findClosing(text,open,'{','}');if(end>=0){flush();nodes.push(<span key={`${keyPrefix}-g-${key++}`}>{renderSegment(text.slice(open+1,end),`${keyPrefix}-g${key}`)}</span>);index=end+1;continue;}}
    // Accept bank notation and AI LaTeX, including spaces and indexed roots.
    const root = text.slice(index).match(/^(?:\\sqrt|sqrt)\s*(?:\[([^\]]+)\]\s*)?([({])/);
    if (root) {
      const rootOpenIndex = index + root[0].length - 1;
      const rootOpenChar = root[2];
      const rootCloseChar = rootOpenChar === "(" ? ")" : "}";
      const closeIndex = findClosing(text, rootOpenIndex, rootOpenChar, rootCloseChar);
      if (closeIndex >= 0) {
        flush();
        const inner = text.slice(rootOpenIndex + 1, closeIndex);
        nodes.push(
          <span className="math-root" key={`${keyPrefix}-r-${key++}`}>
            {root[1] && <sup className="math-root-index">{renderSegment(root[1], `${keyPrefix}-ri${key}`)}</sup>}
            <span className="math-root-symbol">√</span>
            <span className="math-radicand">{renderSegment(inner, `${keyPrefix}-r${key}`)}</span>
          </span>
        );
        index = closeIndex + 1;
        continue;
      }
      // 괄호가 닫히지 않은 잘못된 sqrt는 원문 그대로 보여준다.
      buffer += root[0];
      index += root[0].length;
      continue;
    }

    if (text[index] === "^" || text[index] === "_") {
      const script = readScript(text, index + 1);
      if (script) {
        flush();
        const content = renderSegment(script.value, `${keyPrefix}-s${key}`);
        nodes.push(
          text[index] === "^"
            ? <sup key={`${keyPrefix}-sup-${key++}`}>{content}</sup>
            : <sub key={`${keyPrefix}-sub-${key++}`}>{content}</sub>
        );
        index = script.nextIndex;
        continue;
      }
    }

    buffer += text[index];
    index += 1;
  }

  flush();
  return nodes;
}

function MathText({ text = "" }) {
  return <span className="math-text-flow">{splitMathSource(text).map((part,i)=><span key={i} className={part.display?'math-display':undefined}>{renderSegment(part.text,`part${i}`)}</span>)}</span>;
}

export default MathText;
