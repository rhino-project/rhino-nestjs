/**
 * Minimal readline-based prompt utilities.
 * Pass a custom ReadlineInterface for testing (avoids real stdin/stdout).
 */
import * as readline from 'readline';

export interface ReadlineInterface {
  question(query: string, callback: (answer: string) => void): void;
  close(): void;
}

/** Factory so callers can inject a mock in tests. */
export function createInterface(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): ReadlineInterface {
  return readline.createInterface({ input, output });
}

/** Ask a free-text question. Returns the trimmed answer. */
export function ask(rl: ReadlineInterface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/** Ask a yes/no question. Defaults shown in brackets. Returns boolean. */
export async function confirm(
  rl: ReadlineInterface,
  question: string,
  defaultValue = true,
): Promise<boolean> {
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = await ask(rl, `${question} ${hint}: `);
  if (!answer) return defaultValue;
  return answer.toLowerCase().startsWith('y');
}

/** Present a numbered list, returns the selected value. */
export async function selectFromList(
  rl: ReadlineInterface,
  question: string,
  options: string[],
  defaultIndex = 0,
): Promise<string> {
  process.stdout.write(`${question}\n`);
  options.forEach((opt, i) => {
    process.stdout.write(`  ${i + 1}) ${opt}\n`);
  });
  const answer = await ask(rl, `Enter number (default: ${defaultIndex + 1}): `);
  const num = parseInt(answer, 10);
  if (!answer || isNaN(num) || num < 1 || num > options.length) {
    return options[defaultIndex];
  }
  return options[num - 1];
}
