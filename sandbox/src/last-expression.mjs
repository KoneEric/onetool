// Finds the value of a program without a parser. The text is cut at the ends of lines and after semicolons that
// stand outside every bracket, string, template and comment; each cut gives a text whose tail is wrapped in
// `return (...)`. The caller compiles the texts in turn and keeps the first that is valid JavaScript.

const KEYWORDS_BEFORE_REGEX = new Set([
  "return", "typeof", "case", "do", "else", "in", "of", "instanceof", "new", "void", "delete", "throw", "yield", "await",
]);
const WORD = /[\w$]/;
// A tail that starts like this is a declaration: as an expression it would lose its hoisting.
const DECLARATION = /^\s*(async\s+function|function|class)\b/;
const MOST_CUTS = 64;

function regexAllowed(src, p) {
  if (p < 0) return true;
  const c = src[p];
  if (WORD.test(c)) {
    let s = p;
    while (s >= 0 && WORD.test(src[s])) s--;
    return KEYWORDS_BEFORE_REGEX.has(src.slice(s + 1, p + 1));
  }
  return c !== ")" && c !== "]" && c !== '"' && c !== "'" && c !== "`";
}

function scan(src) {
  const n = src.length;
  const cuts = [];
  const semicolons = new Map(); // position of a `;` -> position of the significant character before it
  const stack = [];
  let lastSig = -1;
  let i = 0;

  const cut = (p) => {
    if (cuts[cuts.length - 1] !== p) cuts.push(p);
  };
  const skipString = (j) => {
    const quote = src[j++];
    while (j < n) {
      const c = src[j];
      if (c === "\\") j += 2;
      else if (c === quote) return j + 1;
      else if (c === "\n") return j;
      else j++;
    }
    return n;
  };
  // From inside a template: to after its closing backquote, or to after a `${`, which opens code again.
  const skipTemplate = (j) => {
    while (j < n) {
      const c = src[j];
      if (c === "\\") j += 2;
      else if (c === "`") return j + 1;
      else if (c === "$" && src[j + 1] === "{") {
        stack.push("${");
        return j + 2;
      } else j++;
    }
    return n;
  };
  const skipRegex = (j) => {
    let inClass = false;
    j++;
    while (j < n) {
      const c = src[j];
      if (c === "\\") j += 2;
      else if (c === "\n") return j;
      else {
        j++;
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
      }
    }
    while (j < n && WORD.test(src[j])) j++;
    return j;
  };

  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      if (!stack.length) cut(i + 1);
      i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      i = close < 0 ? n : close + 2;
    } else if (c === '"' || c === "'") {
      i = skipString(i);
      lastSig = i - 1;
    } else if (c === "`") {
      i = skipTemplate(i + 1);
      lastSig = i - 1;
    } else if (c === "/" && regexAllowed(src, lastSig)) {
      i = skipRegex(i);
      lastSig = i - 1;
    } else if (c === "}" && stack[stack.length - 1] === "${") {
      stack.pop();
      i = skipTemplate(i + 1);
      lastSig = i - 1;
    } else {
      if (c === "(" || c === "[" || c === "{") stack.push(c);
      else if (c === ")" || c === "]" || c === "}") stack.pop();
      else if (c === ";") {
        semicolons.set(i, lastSig);
        if (!stack.length) cut(i + 1);
      }
      lastSig = i;
      i++;
    }
  }

  // The end of the program's code: without comments, white space and final semicolons.
  let end = lastSig + 1;
  while (end > 0 && src[end - 1] === ";" && semicolons.has(end - 1)) end = semicolons.get(end - 1) + 1;
  return { cuts, end };
}

// The texts to try, the one that gives the most to the last expression first. None when the program has no code.
export function* withLastExpression(src) {
  const { cuts, end } = scan(src);
  if (end === 0) return;
  let tried = 0;
  for (let k = cuts.length - 1; k >= 0 && tried < MOST_CUTS; k--) {
    if (cuts[k] >= end) continue;
    const tail = src.slice(cuts[k], end);
    if (DECLARATION.test(tail)) continue;
    tried++;
    yield src.slice(0, cuts[k]) + "\nreturn (\n" + tail + "\n)";
  }
  const whole = src.slice(0, end);
  if (!DECLARATION.test(whole)) yield "return (\n" + whole + "\n)";
}
