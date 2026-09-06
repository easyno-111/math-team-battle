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

function normalizeMathSource(value) {
  return String(value ?? "")
    .replace(/\\leq?/g, "≤")
    .replace(/\\geq?/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/!=/g, "≠")
    .replace(/\+\/-/g, "±");
}

function renderSegment(source, keyPrefix = "m") {
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
    let rootOpenIndex = -1;
    let rootOpenChar = "";
    let rootCloseChar = "";
    let rootPrefixLength = 0;

    if (text.startsWith("sqrt(", index)) {
      rootOpenIndex = index + 4;
      rootOpenChar = "(";
      rootCloseChar = ")";
      rootPrefixLength = 5;
    } else if (text.startsWith("sqrt{", index)) {
      rootOpenIndex = index + 4;
      rootOpenChar = "{";
      rootCloseChar = "}";
      rootPrefixLength = 5;
    } else if (text.startsWith("\\sqrt{", index)) {
      rootOpenIndex = index + 5;
      rootOpenChar = "{";
      rootCloseChar = "}";
      rootPrefixLength = 6;
    }

    if (rootOpenIndex >= 0) {
      const closeIndex = findClosing(text, rootOpenIndex, rootOpenChar, rootCloseChar);
      if (closeIndex >= 0) {
        flush();
        const inner = text.slice(rootOpenIndex + 1, closeIndex);
        nodes.push(
          <span className="math-root" key={`${keyPrefix}-r-${key++}`}>
            <span className="math-root-symbol" aria-hidden="true">√</span>
            <span className="math-radicand">{renderSegment(inner, `${keyPrefix}-r${key}`)}</span>
          </span>
        );
        index = closeIndex + 1;
        continue;
      }
      // 괄호가 닫히지 않은 잘못된 sqrt는 원문 그대로 보여준다.
      buffer += text.slice(index, index + rootPrefixLength);
      index += rootPrefixLength;
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
  return <span className="math-text-flow">{renderSegment(text)}</span>;
}

export default MathText;
