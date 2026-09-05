/**
 * The expression language salary rules are written in.
 *
 * A rule that cannot be expressed as a fixed amount or a percentage needs
 * arithmetic — attendance-based pay, overtime, unpaid-leave deductions, sums
 * across several rules — and that arithmetic comes from the database, written
 * by whoever configures payroll.
 *
 * It is parsed and evaluated here rather than passed to `eval` or `new
 * Function`. Those would hand anybody who can edit a salary rule the ability to
 * run arbitrary code inside the server process: read the environment, reach the
 * database, open sockets. This evaluator can only produce a number. It has no
 * access to anything the caller does not put in the context, no loops, no
 * property access beyond the maps it is given, and no way to reach a global.
 *
 * Grammar:
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/' | '%') unary)*
 *   unary      := ('-' | '+')? primary
 *   primary    := number | name | name '[' expression ']' | name '(' args ')'
 *                 | '(' expression ')'
 */

/** Functions a rule may call. Every one takes and returns plain numbers. */
const FUNCTIONS = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  round: (value, digits = 0) => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  },
  floor: Math.floor,
  ceil: Math.ceil,
};

export class FormulaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FormulaError';
  }
}

/* ------------------------------------------------------------------ lexing */

const NUMBER = /^\d+(\.\d+)?/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

function tokenize(source) {
  const tokens = [];
  let rest = source;

  while (rest.length > 0) {
    if (/^\s/.test(rest)) {
      rest = rest.replace(/^\s+/, '');
      continue;
    }

    const number = NUMBER.exec(rest);
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]) });
      rest = rest.slice(number[0].length);
      continue;
    }

    const name = NAME.exec(rest);
    if (name) {
      tokens.push({ type: 'name', value: name[0] });
      rest = rest.slice(name[0].length);
      continue;
    }

    // A quoted key, as in categories['BASIC'].
    const quote = /^(['"])((?:[^'"\\]|\\.)*)\1/.exec(rest);
    if (quote) {
      tokens.push({ type: 'string', value: quote[2] });
      rest = rest.slice(quote[0].length);
      continue;
    }

    const symbol = rest[0];
    if ('+-*/%()[],'.includes(symbol)) {
      tokens.push({ type: symbol });
      rest = rest.slice(1);
      continue;
    }

    throw new FormulaError(`Unexpected character "${symbol}".`);
  }

  return tokens;
}

/* ----------------------------------------------------------------- parsing */

/**
 * Builds a tree from the tokens.
 *
 * Parsing once and evaluating the tree keeps a bad expression a parse error
 * rather than a half-applied calculation.
 */
function parse(tokens) {
  let position = 0;

  const peek = () => tokens[position];
  const next = () => tokens[position++];

  function expect(type) {
    const token = next();
    if (!token || token.type !== type) {
      throw new FormulaError(`Expected "${type}".`);
    }
    return token;
  }

  function parseExpression() {
    let left = parseTerm();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const operator = next().type;
      left = { kind: 'binary', operator, left, right: parseTerm() };
    }
    return left;
  }

  function parseTerm() {
    let left = parseUnary();
    while (peek() && (peek().type === '*' || peek().type === '/' || peek().type === '%')) {
      const operator = next().type;
      left = { kind: 'binary', operator, left, right: parseUnary() };
    }
    return left;
  }

  function parseUnary() {
    if (peek() && (peek().type === '-' || peek().type === '+')) {
      const operator = next().type;
      return { kind: 'unary', operator, operand: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const token = next();
    if (!token) throw new FormulaError('The expression ended unexpectedly.');

    if (token.type === 'number') return { kind: 'number', value: token.value };

    if (token.type === '(') {
      const inner = parseExpression();
      expect(')');
      return inner;
    }

    if (token.type === 'name') {
      // A lookup: categories['BASIC'] or rules['HRA'].
      if (peek()?.type === '[') {
        next();
        const key = next();
        if (!key || (key.type !== 'string' && key.type !== 'name')) {
          throw new FormulaError(`Expected a key inside ${token.value}[...].`);
        }
        expect(']');
        return { kind: 'lookup', map: token.value, key: String(key.value) };
      }

      // A call: max(a, b).
      if (peek()?.type === '(') {
        next();
        const args = [];
        if (peek()?.type !== ')') {
          args.push(parseExpression());
          while (peek()?.type === ',') {
            next();
            args.push(parseExpression());
          }
        }
        expect(')');
        return { kind: 'call', name: token.value, args };
      }

      return { kind: 'variable', name: token.value };
    }

    throw new FormulaError(`Unexpected "${token.type}" in the expression.`);
  }

  const tree = parseExpression();
  if (position < tokens.length) {
    throw new FormulaError('The expression has trailing characters.');
  }
  return tree;
}

/* -------------------------------------------------------------- evaluating */

function evaluate(node, context) {
  switch (node.kind) {
    case 'number':
      return node.value;

    case 'unary': {
      const value = evaluate(node.operand, context);
      return node.operator === '-' ? -value : value;
    }

    case 'binary': {
      const left = evaluate(node.left, context);
      const right = evaluate(node.right, context);
      switch (node.operator) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          // A rule dividing by a zero-day month should read as nothing earned,
          // not as Infinity quietly becoming the net pay.
          return right === 0 ? 0 : left / right;
        case '%':
          return right === 0 ? 0 : left % right;
        default:
          throw new FormulaError(`Unknown operator "${node.operator}".`);
      }
    }

    case 'variable': {
      const value = context.variables?.[node.name];
      if (typeof value !== 'number') {
        throw new FormulaError(`Unknown value "${node.name}".`);
      }
      return value;
    }

    case 'lookup': {
      const map = context.maps?.[node.map];
      if (!map) throw new FormulaError(`Unknown table "${node.map}".`);
      // Only the table's own keys are readable. Reading through the prototype
      // would let categories['toString'] resolve to a function, and a rule
      // could reach constructor from there.
      if (!Object.hasOwn(map, node.key)) return 0;
      const value = Number(map[node.key]);
      // A key holding something that is not a number is a configuration
      // problem, and contributing zero is the honest answer.
      return Number.isFinite(value) ? value : 0;
    }

    case 'call': {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new FormulaError(`Unknown function "${node.name}".`);
      return fn(...node.args.map((argument) => evaluate(argument, context)));
    }

    default:
      throw new FormulaError('The expression could not be evaluated.');
  }
}

/**
 * Evaluates an expression against a context of plain numbers.
 *
 * `context.variables` are single values such as `wage`; `context.maps` are the
 * tables a rule reads, `categories` and `rules`. The leading "result =" that
 * the reference screens show is accepted and ignored, so an expression can be
 * pasted in either form.
 */
export function evaluateFormula(source, context = {}) {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new FormulaError('The formula is empty.');
  }

  const expression = source.replace(/^\s*result\s*=/, '').trim();
  const value = evaluate(parse(tokenize(expression)), context);

  if (!Number.isFinite(value)) {
    throw new FormulaError('The formula did not produce a usable number.');
  }
  return value;
}

/** Checks an expression without running it, for the salary rule form. */
export function validateFormula(source) {
  try {
    parse(tokenize(String(source ?? '').replace(/^\s*result\s*=/, '')));
    return null;
  } catch (error) {
    return error instanceof FormulaError ? error.message : 'The formula could not be read.';
  }
}
